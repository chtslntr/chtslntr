/* Hisse Defteri — Supabase bağlantısı (giriş, şirketler, ekip, eşzamanlı kayıt).
   config.js içinde Supabase bilgileri yoksa devre dışıdır (Backend.enabled === false). */
(function () {
  'use strict';

  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.99.3/dist/umd/supabase.js';
  const LAST_COMPANY_KEY = 'hisse-defteri:company';
  const cfg = window.HD_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

  let sb = null;
  let user = null;
  let h = {};
  let companies = [];
  let current = null;     // { id, name, role, version }
  let channel = null;
  let pending = null;
  let saveTimer = null;
  let saving = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Supabase kitaplığı yüklenemedi.'));
      document.head.appendChild(s);
    });
  }
  function fail(error) { if (error) throw new Error(error.message || String(error)); }
  function remember(id) { try { localStorage.setItem(LAST_COMPANY_KEY, id); } catch (e) { /* yok say */ } }
  function remembered() { try { return localStorage.getItem(LAST_COMPANY_KEY); } catch (e) { return null; } }

  // ---------- Oturum ----------
  async function start(handlers) {
    h = handlers;
    await loadScript(SUPABASE_JS);
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    sb.auth.onAuthStateChange((event, session) => {
      const u = session ? session.user : null;
      if (u && (!user || user.id !== u.id)) { user = u; setTimeout(afterLogin, 0); }
      if (!u && user) { user = null; teardown(); h.onSignedOut(); }
    });
    const { data, error } = await sb.auth.getSession();
    fail(error);
    if (data.session) { user = data.session.user; await afterLogin(); }
    else h.onSignedOut();
  }

  async function afterLogin() {
    h.onUser(user);
    const { error } = await sb.rpc('accept_invitations');
    if (error) console.warn('Davetler kabul edilemedi:', error.message);
    await refreshCompanies();
  }

  async function signIn(email) {
    const redirect = location.origin + location.pathname;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    fail(error);
  }

  async function signOut() {
    await flush();
    await sb.auth.signOut();
  }

  function teardown() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    current = null; companies = []; pending = null; clearTimeout(saveTimer);
  }

  // ---------- Şirketler ----------
  async function refreshCompanies(preferId) {
    const { data, error } = await sb.from('memberships')
      .select('role, company_id, companies ( id, name )')
      .eq('user_id', user.id);
    fail(error);
    companies = (data || []).filter((m) => m.companies)
      .map((m) => ({ id: m.company_id, name: m.companies.name, role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    h.onCompanies(companies);
    if (!companies.length) { teardown(); h.onNoCompany(); return; }
    const want = preferId || (current && current.id) || remembered();
    const pick = companies.find((c) => c.id === want) || companies[0];
    await openCompany(pick.id);
  }

  async function openCompany(id) {
    await flush();
    const { data, error } = await sb.from('companies').select('id, name, data, version').eq('id', id).single();
    fail(error);
    const meta = companies.find((c) => c.id === id) || {};
    current = { id: data.id, name: data.name, role: meta.role || 'viewer', version: data.version };
    remember(id);
    subscribe(id);
    h.onCompany(data.data, { ...current });
  }

  function subscribe(id) {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('company-' + id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'companies', filter: 'id=eq.' + id }, (payload) => {
        const row = payload.new || {};
        if (!current || current.id !== id || !(row.version > current.version)) return;
        if (pending || saving) return; // kendi kaydımız sürerken gelen değişiklik: çakışma kontrolü kayıtta yapılır
        current.version = row.version;
        current.name = row.name || current.name;
        h.onCompany(row.data, { ...current, external: true });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'companies', filter: 'id=eq.' + id }, () => {
        refreshCompanies().catch((e) => h.onError(e));
      })
      .subscribe();
  }

  async function createCompany(name, data) {
    await flush();
    const { data: id, error } = await sb.rpc('create_company', { p_name: name, p_data: data });
    fail(error);
    await refreshCompanies(id);
    return id;
  }

  async function deleteCompany() {
    if (!current) return;
    const id = current.id;
    pending = null; clearTimeout(saveTimer);
    const { error } = await sb.from('companies').delete().eq('id', id);
    fail(error);
    current = null;
    await refreshCompanies();
  }

  async function leaveCompany() {
    if (!current) return;
    const { error } = await sb.from('memberships').delete().eq('company_id', current.id).eq('user_id', user.id);
    fail(error);
    current = null;
    await refreshCompanies();
  }

  // ---------- Kayıt (iyimser eşzamanlılık: sürüm eşleşmezse çakışma) ----------
  function save(state) {
    if (!current || current.role === 'viewer') return;
    pending = state;
    h.onSaveStatus('pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flush().catch((e) => h.onError(e)); }, 700);
  }

  async function flush() {
    clearTimeout(saveTimer);
    if (!pending || saving || !current) return;
    const st = pending;
    pending = null;
    saving = true;
    h.onSaveStatus('saving');
    try {
      const name = (st.company && st.company.name) || current.name;
      const { data, error } = await sb.from('companies')
        .update({ data: st, name })
        .eq('id', current.id).eq('version', current.version)
        .select('version');
      if (error) { h.onSaveStatus('error', error.message); return; }
      if (!data || !data.length) {
        pending = null;
        h.onSaveStatus('conflict');
        await openCompany(current.id);
        return;
      }
      current.version = data[0].version;
      if (name !== current.name) {
        current.name = name;
        const c = companies.find((x) => x.id === current.id);
        if (c) { c.name = name; h.onCompanies(companies); }
      }
      h.onSaveStatus(pending ? 'pending' : 'saved');
    } finally {
      saving = false;
    }
    if (pending) await flush();
  }

  window.addEventListener('beforeunload', (e) => {
    if (pending || saving) { flush(); e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Ekip ----------
  async function listTeam() {
    if (!current) return { members: [], invites: [] };
    const m = await sb.from('memberships').select('user_id, email, role, created_at').eq('company_id', current.id).order('created_at');
    fail(m.error);
    let invites = [];
    if (current.role === 'owner') {
      const i = await sb.from('invitations').select('id, email, role, created_at').eq('company_id', current.id).order('created_at');
      fail(i.error);
      invites = i.data || [];
    }
    return { members: m.data || [], invites };
  }

  async function invite(email, role) {
    const { error } = await sb.from('invitations').insert({ company_id: current.id, email: email.trim().toLowerCase(), role, invited_by: user.id });
    if (error && error.code === '23505') throw new Error('Bu e-posta için zaten bekleyen bir davet var.');
    fail(error);
  }
  async function cancelInvite(id) { fail((await sb.from('invitations').delete().eq('id', id)).error); }
  async function setRole(userId, role) {
    fail((await sb.from('memberships').update({ role }).eq('company_id', current.id).eq('user_id', userId)).error);
    if (userId === user.id) await refreshCompanies(current.id);
  }
  async function removeMember(userId) {
    fail((await sb.from('memberships').delete().eq('company_id', current.id).eq('user_id', userId)).error);
  }

  async function history(limit) {
    if (!current) return [];
    const { data, error } = await sb.from('company_history').select('version, changed_at, changed_by')
      .eq('company_id', current.id).order('version', { ascending: false }).limit(limit || 20);
    fail(error);
    return data || [];
  }

  window.Backend = {
    enabled,
    start, signIn, signOut,
    openCompany, createCompany, deleteCompany, leaveCompany, refreshCompanies,
    save, flush,
    listTeam, invite, cancelInvite, setRole, removeMember, history,
    get user() { return user; },
    get current() { return current ? { ...current } : null; },
    get companies() { return companies.slice(); },
  };
})();
