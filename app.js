/* Hisse Defteri — basit bir cap table (ortaklık tablosu) yöneticisi.
   Tüm veriler tarayıcının localStorage alanında tutulur. */
(function () {
  'use strict';

  const STORAGE_KEY = 'hisse-defteri:v1';
  const THEME_KEY = 'hisse-defteri:theme';

  const CATEGORIES = {
    founder: { label: 'Kurucular', single: 'Kurucu', color: '--cat-founder' },
    investor: { label: 'Yatırımcılar', single: 'Yatırımcı', color: '--cat-investor' },
    employee: { label: 'Çalışanlar', single: 'Çalışan', color: '--cat-employee' },
    other: { label: 'Diğer', single: 'Diğer', color: '--cat-other' },
  };
  const CLASS_KINDS = { common: 'Adi pay', preferred: 'İmtiyazlı pay', option: 'Opsiyon' };
  const CURRENCY_SYMBOL = { TRY: '₺', USD: '$', EUR: '€' };

  // ---------- Durum ----------
  const uid = () => Math.random().toString(36).slice(2, 10);

  function emptyState() {
    return {
      company: { name: 'Şirketim A.Ş.', currency: 'TRY', optionPool: 0 },
      classes: [
        { id: 'common', name: 'Adi pay', kind: 'common' },
        { id: 'options', name: 'Çalışan opsiyonu', kind: 'option' },
      ],
      stakeholders: [],
      issuances: [],
    };
  }

  function demoState() {
    const s = emptyState();
    s.company = { name: 'Örnek Teknoloji A.Ş.', currency: 'TRY', optionPool: 1000000 };
    s.classes.push({ id: 'seed', name: 'Seed İmtiyazlı', kind: 'preferred', liqMultiple: 1, participating: false, seniority: 1 });
    const add = (name, category) => { const id = uid(); s.stakeholders.push({ id, name, category, email: '' }); return id; };
    const ayse = add('Ayşe Yılmaz', 'founder');
    const mehmet = add('Mehmet Demir', 'founder');
    const melek = add('Melek Yatırım Ortaklığı', 'investor');
    const fon = add('Anadolu Seed Fonu', 'investor');
    const zeynep = add('Zeynep Kaya', 'employee');
    const can = add('Can Öztürk', 'employee');
    const iss = (stakeholderId, classId, shares, price, date, note, vesting) =>
      s.issuances.push({ id: uid(), stakeholderId, classId, shares, price, date, note, vesting: vesting || null });
    const v4 = (start) => ({ start, months: 48, cliff: 12 });
    iss(ayse, 'common', 4000000, 0.01, '2023-02-01', 'Kuruluş', v4('2023-02-01'));
    iss(mehmet, 'common', 3500000, 0.01, '2023-02-01', 'Kuruluş', v4('2023-02-01'));
    iss(melek, 'common', 500000, 1, '2023-09-15', 'Melek yatırım');
    iss(fon, 'seed', 1250000, 4, '2024-06-10', 'Seed turu');
    iss(zeynep, 'options', 300000, 1, '2024-08-01', 'ESOP hibesi', v4('2024-08-01'));
    iss(can, 'options', 150000, 1, '2025-01-15', 'ESOP hibesi', v4('2025-01-15'));
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* depolama erişilemiyor */ }
    return demoState();
  }
  function normalize(s) {
    const base = emptyState();
    return {
      company: Object.assign(base.company, s.company || {}),
      classes: Array.isArray(s.classes) ? s.classes : base.classes,
      stakeholders: Array.isArray(s.stakeholders) ? s.stakeholders : [],
      issuances: Array.isArray(s.issuances) ? s.issuances : [],
    };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* yok say */ }
  }

  let state = load();

  // ---------- Biçimlendirme ----------
  const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtN = (n) => nf.format(Math.round(n || 0));
  const fmtPct = (x) => (isFinite(x) ? nf2.format(x * 100) : '0,00') + '%';
  const sym = () => CURRENCY_SYMBOL[state.company.currency] || '';
  function fmtMoney(n, precise) {
    const v = n || 0;
    if (!precise && Math.abs(v) >= 1e6) {
      return sym() + new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(v / 1e6) + ' Mn';
    }
    return sym() + (precise ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 4 }).format(v) : nf.format(Math.round(v)));
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Hesaplamalar ----------
  function classById(id) { return state.classes.find((c) => c.id === id); }
  function stakeholderById(id) { return state.stakeholders.find((s) => s.id === id); }

  function compute() {
    const rows = state.stakeholders.map((s) => ({ s, common: 0, preferred: 0, option: 0, invested: 0 }));
    const byId = Object.fromEntries(rows.map((r) => [r.s.id, r]));
    let optionsGranted = 0;
    for (const i of state.issuances) {
      const r = byId[i.stakeholderId];
      const c = classById(i.classId);
      if (!r || !c) continue;
      r[c.kind] += i.shares;
      if (c.kind === 'option') optionsGranted += i.shares;
      else r.invested += i.shares * (i.price || 0);
    }
    for (const r of rows) {
      r.outstanding = r.common + r.preferred;
      r.total = r.outstanding + r.option;
    }
    const outstanding = rows.reduce((a, r) => a + r.outstanding, 0);
    const poolUnallocated = Math.max(0, (state.company.optionPool || 0) - optionsGranted);
    const fullyDiluted = outstanding + optionsGranted + poolUnallocated;
    const invested = rows.reduce((a, r) => a + r.invested, 0);

    // Son fiyatlı pay ihracı → zımni değerleme
    const priced = state.issuances
      .filter((i) => classById(i.classId)?.kind !== 'option' && i.price > 0)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const lastPrice = priced.length ? priced[0].price : 0;

    const byCategory = { founder: 0, investor: 0, employee: 0, other: 0 };
    for (const r of rows) byCategory[r.s.category in byCategory ? r.s.category : 'other'] += r.total;

    return { rows, outstanding, optionsGranted, poolUnallocated, fullyDiluted, invested, lastPrice,
      valuation: lastPrice * fullyDiluted, byCategory };
  }

  // ---------- Çizim: Özet ----------
  function renderKpis(c) {
    const items = [
      ['Tam seyreltilmiş pay', fmtN(c.fullyDiluted)],
      ['Çıkarılmış pay', fmtN(c.outstanding)],
      ['Son pay fiyatı', c.lastPrice ? fmtMoney(c.lastPrice, true) : '—'],
      ['Zımni değerleme', c.lastPrice ? fmtMoney(c.valuation) : '—'],
      ['Toplam yatırım', fmtMoney(c.invested)],
    ];
    document.getElementById('kpis').innerHTML = items.map(([l, v]) =>
      `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join('');
  }

  function renderCategoryChart(c) {
    const el = document.getElementById('categoryChart');
    if (!c.fullyDiluted) { el.innerHTML = '<p class="muted">Henüz pay kaydı yok. “İşlemler” sekmesinden ekleyin.</p>'; return; }
    const segs = Object.entries(CATEGORIES).map(([k, meta]) => ({ key: k, label: meta.label, color: `var(${meta.color})`, value: c.byCategory[k] }));
    segs.push({ key: 'pool', label: 'Ayrılmamış havuz', color: 'var(--cat-pool)', value: c.poolUnallocated });
    renderStack(el, segs, c.fullyDiluted,
      (s) => `<div class="t-row"><span>Pay</span><span>${fmtN(s.value)}</span></div><div class="t-row"><span>Oran</span><span>${fmtPct(s.pct)}</span></div>`);
  }

  function renderStack(el, segs, total, tipRows) {
    const visible = segs.filter((s) => s.value > 0).map((s) => ({ ...s, pct: total ? s.value / total : 0 }));
    if (!visible.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="stack" role="img" aria-label="${visible.map((s) => `${s.label} ${fmtPct(s.pct)}`).join(', ')}">
        ${visible.map((s) => `<div class="seg" data-key="${s.key}" style="flex:${s.value} 1 0;background:${s.color}"></div>`).join('')}
      </div>
      <div class="stack-labels">
        ${visible.map((s) => `<div style="flex:${s.value} 1 0">${s.pct >= 0.08 ? fmtPct(s.pct) : ''}</div>`).join('')}
      </div>
      <div class="legend">${visible.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.label}<b>${fmtPct(s.pct)}</b></span>`).join('')}</div>`;
    el.querySelectorAll('.seg').forEach((g) => {
      const p = visible.find((q) => q.key === g.dataset.key);
      bindTooltip(g, () => `<div class="t-title"><span class="swatch" style="background:${p.color}"></span>${p.label}</div>${tipRows(p)}`);
    });
  }

  function renderCapTable(c) {
    const t = document.getElementById('capTable');
    const rows = c.rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    if (!rows.length && !c.poolUnallocated) { t.innerHTML = '<tbody><tr><td class="empty">Henüz kayıt yok.</td></tr></tbody>'; return; }
    const body = rows.map((r) => `
      <tr>
        <td><span class="swatch" style="background:var(${(CATEGORIES[r.s.category] || CATEGORIES.other).color})"></span>${esc(r.s.name)}</td>
        <td><span class="pill">${(CATEGORIES[r.s.category] || CATEGORIES.other).single}</span></td>
        <td class="num">${fmtN(r.common)}</td>
        <td class="num">${fmtN(r.preferred)}</td>
        <td class="num">${fmtN(r.option)}</td>
        <td class="num">${fmtPct(c.outstanding ? r.outstanding / c.outstanding : 0)}</td>
        <td class="num">${fmtPct(r.total / c.fullyDiluted)}</td>
        <td class="num">${fmtMoney(r.invested)}</td>
      </tr>`).join('');
    const pool = c.poolUnallocated ? `
      <tr>
        <td><span class="swatch" style="background:var(--cat-pool)"></span>Ayrılmamış opsiyon havuzu</td>
        <td><span class="pill">Havuz</span></td>
        <td class="num">—</td><td class="num">—</td>
        <td class="num">${fmtN(c.poolUnallocated)}</td>
        <td class="num">—</td>
        <td class="num">${fmtPct(c.poolUnallocated / c.fullyDiluted)}</td>
        <td class="num">—</td>
      </tr>` : '';
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    t.innerHTML = `
      <thead><tr>
        <th>Hissedar</th><th>Kategori</th><th class="num">Adi pay</th><th class="num">İmtiyazlı</th>
        <th class="num">Opsiyon</th><th class="num">% Çıkarılmış</th><th class="num">% Tam seyreltilmiş</th><th class="num">Yatırım</th>
      </tr></thead>
      <tbody>${body}${pool}</tbody>
      <tfoot><tr>
        <td>Toplam</td><td></td>
        <td class="num">${fmtN(sum('common'))}</td><td class="num">${fmtN(sum('preferred'))}</td>
        <td class="num">${fmtN(sum('option') + c.poolUnallocated)}</td>
        <td class="num">${fmtPct(c.outstanding ? 1 : 0)}</td><td class="num">${fmtPct(1)}</td>
        <td class="num">${fmtMoney(c.invested)}</td>
      </tr></tfoot>`;
  }

  // ---------- Çizim: Hissedarlar ----------
  function renderStakeholders(c) {
    const t = document.getElementById('stakeholderTable');
    if (!state.stakeholders.length) { t.innerHTML = '<tbody><tr><td class="empty">Henüz hissedar yok.</td></tr></tbody>'; return; }
    const byId = Object.fromEntries(c.rows.map((r) => [r.s.id, r]));
    t.innerHTML = `
      <thead><tr><th>Ad</th><th>Kategori</th><th>E-posta</th><th class="num">Toplam pay</th><th class="num">% Tam seyreltilmiş</th><th></th></tr></thead>
      <tbody>${state.stakeholders.map((s) => `
        <tr>
          <td>${esc(s.name)}</td>
          <td>
            <select data-cat="${s.id}">
              ${Object.entries(CATEGORIES).map(([k, m]) => `<option value="${k}" ${k === s.category ? 'selected' : ''}>${m.single}</option>`).join('')}
            </select>
          </td>
          <td class="muted">${esc(s.email) || '—'}</td>
          <td class="num">${fmtN(byId[s.id].total)}</td>
          <td class="num">${fmtPct(c.fullyDiluted ? byId[s.id].total / c.fullyDiluted : 0)}</td>
          <td class="num"><button class="btn icon danger" data-del-stakeholder="${s.id}">Sil</button></td>
        </tr>`).join('')}</tbody>`;
  }

  // ---------- Çizim: İşlemler ----------
  function renderLedger(c) {
    const f = document.getElementById('issuanceForm');
    const prevS = f.stakeholderId.value, prevC = f.classId.value;
    f.stakeholderId.innerHTML = state.stakeholders.length
      ? state.stakeholders.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
      : '<option value="">Önce hissedar ekleyin</option>';
    f.classId.innerHTML = state.classes.map((k) => `<option value="${k.id}">${esc(k.name)} (${CLASS_KINDS[k.kind]})</option>`).join('');
    if (prevS && stakeholderById(prevS)) f.stakeholderId.value = prevS;
    if (prevC && classById(prevC)) f.classId.value = prevC;
    if (!f.date.value) f.date.value = new Date().toISOString().slice(0, 10);

    document.getElementById('poolHint').textContent = state.company.optionPool
      ? `Opsiyon havuzu: ${fmtN(state.company.optionPool)} pay · dağıtılan ${fmtN(c.optionsGranted)} · kalan ${fmtN(c.poolUnallocated)}`
      : 'Opsiyon havuzu tanımlı değil (Ayarlar sekmesinden belirleyebilirsiniz).';

    const t = document.getElementById('ledgerTable');
    const list = [...state.issuances].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (!list.length) { t.innerHTML = '<tbody><tr><td class="empty">Henüz işlem yok.</td></tr></tbody>'; return; }
    t.innerHTML = `
      <thead><tr><th>Tarih</th><th>Hissedar</th><th>Pay sınıfı</th><th class="num">Adet</th><th class="num">Pay başı fiyat</th><th class="num">Tutar</th><th>Vesting</th><th>Not</th><th></th></tr></thead>
      <tbody>${list.map((i) => {
        const s = stakeholderById(i.stakeholderId), k = classById(i.classId);
        return `<tr>
          <td>${esc(i.date)}</td>
          <td>${esc(s ? s.name : '?')}</td>
          <td>${esc(k ? k.name : '?')}</td>
          <td class="num">${fmtN(i.shares)}</td>
          <td class="num">${i.price ? fmtMoney(i.price, true) : '—'}</td>
          <td class="num">${i.price ? fmtMoney(i.shares * i.price, true) : '—'}</td>
          <td class="muted">${i.vesting && i.vesting.months ? `${i.vesting.months} ay / ${i.vesting.cliff || 0} ay cliff` : '—'}</td>
          <td class="muted">${esc(i.note) || ''}</td>
          <td class="num"><button class="btn icon danger" data-del-issuance="${i.id}">Sil</button></td>
        </tr>`;
      }).join('')}</tbody>`;
  }

  // ---------- Tur simülasyonu ----------
  function simulate(c) {
    const f = document.getElementById('roundForm');
    const pre = parseFloat(f.preMoney.value) || 0;
    const inv = parseFloat(f.investment.value) || 0;
    const r = Calc.simulateRound({ fullyDiluted: c.fullyDiluted, poolUnallocated: c.poolUnallocated,
      preMoney: pre, investment: inv, poolTarget: (parseFloat(f.poolTarget.value) || 0) / 100 });
    if (!r) return null;
    return { pre, inv, post: r.post, P: r.poolAdded, price: r.price, I: r.newShares, totalAfter: r.totalAfter,
      name: f.name.value || 'Yeni tur', investor: f.investor.value || 'Yeni Yatırımcı' };
  }

  function renderRound(c) {
    const r = simulate(c);
    const sum = document.getElementById('roundSummary');
    const t = document.getElementById('roundTable');
    if (!r) { sum.innerHTML = ''; t.innerHTML = '<tbody><tr><td class="empty">Simülasyon için pay kaydı ve değerleme gerekli.</td></tr></tbody>'; return; }
    sum.innerHTML = [
      ['Yatırım sonrası değerleme', fmtMoney(r.post)],
      ['Pay başı fiyat', fmtMoney(r.price, true)],
      ['Yeni yatırımcı payı', fmtN(r.I) + ' · ' + fmtPct(r.I / r.totalAfter)],
      ['Havuza eklenen', fmtN(r.P)],
    ].map(([l, v]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join('');

    const line = (name, before, after) => {
      const bp = before / c.fullyDiluted, ap = after / r.totalAfter, d = ap - bp;
      return `<tr><td>${name}</td>
        <td class="num">${fmtN(before)}</td><td class="num">${fmtPct(bp)}</td>
        <td class="num">${fmtN(after)}</td><td class="num">${fmtPct(ap)}</td>
        <td class="num ${d > 0.00005 ? 'delta-pos' : d < -0.00005 ? 'delta-neg' : ''}">${d > 0 ? '+' : ''}${nf2.format(d * 100)} puan</td>
        <td class="num">${fmtMoney(after * r.price)}</td></tr>`;
    };
    const rows = c.rows.filter((x) => x.total > 0).sort((a, b) => b.total - a.total)
      .map((x) => line(esc(x.s.name), x.total, x.total)).join('');
    t.innerHTML = `
      <thead><tr><th>Hissedar</th><th class="num">Önce pay</th><th class="num">Önce %</th><th class="num">Sonra pay</th><th class="num">Sonra %</th><th class="num">Değişim</th><th class="num">Değer (tur fiyatıyla)</th></tr></thead>
      <tbody>
        ${rows}
        ${line('Opsiyon havuzu (ayrılmamış)', c.poolUnallocated, c.poolUnallocated + r.P)}
        ${line(`<b>${esc(r.investor)}</b> <span class="pill">${esc(r.name)}</span>`, 0, r.I)}
      </tbody>
      <tfoot><tr><td>Toplam</td><td class="num">${fmtN(c.fullyDiluted)}</td><td class="num">${fmtPct(1)}</td><td class="num">${fmtN(r.totalAfter)}</td><td class="num">${fmtPct(1)}</td><td></td><td class="num">${fmtMoney(r.post)}</td></tr></tfoot>`;
  }

  function applyRound() {
    const c = compute();
    const r = simulate(c);
    if (!r || !r.I) { toast('Uygulanacak bir tur yok.'); return; }
    if (!confirm(`${r.name} turu tabloya işlenecek: ${r.investor} için ${fmtN(r.I)} pay ve havuza ${fmtN(r.P)} pay eklenecek. Devam edilsin mi?`)) return;
    const className = `${r.name} İmtiyazlı`;
    let cls = state.classes.find((k) => k.name === className);
    if (!cls) { cls = { id: uid(), name: className, kind: 'preferred', liqMultiple: 1, participating: false, seniority: 1 + state.classes.filter((k) => k.kind === 'preferred').length }; state.classes.push(cls); }
    let inv = state.stakeholders.find((s) => s.name === r.investor);
    if (!inv) { inv = { id: uid(), name: r.investor, category: 'investor', email: '' }; state.stakeholders.push(inv); }
    state.issuances.push({ id: uid(), stakeholderId: inv.id, classId: cls.id, shares: r.I, price: Math.round(r.price * 10000) / 10000,
      date: new Date().toISOString().slice(0, 10), note: r.name });
    state.company.optionPool = (state.company.optionPool || 0) + r.P;
    commit('Tur tabloya işlendi.');
    switchTab('overview');
  }

  // ---------- Ayarlar ----------
  function renderSettings() {
    const f = document.getElementById('companyForm');
    if (document.activeElement?.form !== f) {
      f.name.value = state.company.name;
      f.currency.value = state.company.currency;
      f.optionPool.value = state.company.optionPool || 0;
    }
    const used = new Set(state.issuances.map((i) => i.classId));
    document.getElementById('classTable').innerHTML = `
      <thead><tr><th>Sınıf</th><th>Tür</th><th class="num">Tasfiye tercihi (×)</th><th>Katılım</th><th class="num">Kıdem</th><th></th></tr></thead>
      <tbody>${state.classes.map((k) => `<tr><td>${esc(k.name)}</td><td><span class="pill">${CLASS_KINDS[k.kind]}</span></td>
        ${k.kind === 'preferred' ? `
          <td class="num"><input class="cell" type="number" min="0" step="0.25" value="${k.liqMultiple ?? 1}" data-class-field="liqMultiple" data-class-id="${k.id}" aria-label="Tasfiye tercihi çarpanı"></td>
          <td><select class="cell" data-class-field="participating" data-class-id="${k.id}" aria-label="Katılım">
            <option value="0" ${!k.participating ? 'selected' : ''}>Katılımsız</option>
            <option value="1" ${k.participating ? 'selected' : ''}>Katılımlı</option></select></td>
          <td class="num"><input class="cell" type="number" min="1" step="1" value="${k.seniority || 1}" data-class-field="seniority" data-class-id="${k.id}" aria-label="Kıdem"></td>`
        : '<td class="num muted">—</td><td class="muted">—</td><td class="num muted">—</td>'}
        <td class="num">${used.has(k.id) ? '<span class="muted small">Kullanımda</span>' : `<button class="btn icon danger" data-del-class="${k.id}">Sil</button>`}</td></tr>`).join('')}</tbody>`;
  }

  // ---------- Vesting ----------
  function today() { const d = new Date(); return Calc.addMonths(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 0); }

  function renderVesting() {
    const asOf = document.getElementById('vestAsOf').value || today();
    const list = state.issuances.filter((i) => i.vesting && i.vesting.months)
      .map((i) => ({ i, s: stakeholderById(i.stakeholderId), k: classById(i.classId), vested: Calc.vestedShares(i, asOf) }))
      .filter((x) => x.s && x.k)
      .sort((a, b) => (a.s.name > b.s.name ? 1 : -1));
    const tot = list.reduce((a, x) => a + x.i.shares, 0), ves = list.reduce((a, x) => a + x.vested, 0);
    document.getElementById('vestKpis').innerHTML = [
      ['Vesting\'e tabi pay', fmtN(tot)],
      ['Hak edilmiş', fmtN(ves)],
      ['Hak edilmemiş', fmtN(tot - ves)],
      ['Genel ilerleme', fmtPct(tot ? ves / tot : 0)],
    ].map(([l, v]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join('');
    const t = document.getElementById('vestTable');
    if (!list.length) { t.innerHTML = '<tbody><tr><td class="empty">Vesting tanımlı işlem yok. İşlemler sekmesinde “Vesting uygula” seçeneğini kullanın.</td></tr></tbody>'; return; }
    t.innerHTML = `
      <thead><tr><th>Hissedar</th><th>Pay sınıfı</th><th>Başlangıç</th><th class="num">Süre / Cliff</th><th class="num">Toplam</th><th class="num">Hak edilmiş</th><th class="num">Kalan</th><th>İlerleme</th><th>Sonraki hak ediş</th><th>Bitiş</th></tr></thead>
      <tbody>${list.map((x) => {
        const p = x.vested / x.i.shares;
        const next = Calc.nextVestDate(x.i, asOf);
        const cliffPending = Calc.monthsBetween(x.i.vesting.start, asOf) < (x.i.vesting.cliff || 0);
        return `<tr>
          <td>${esc(x.s.name)}</td><td>${esc(x.k.name)}</td><td>${esc(x.i.vesting.start)}</td>
          <td class="num">${x.i.vesting.months} ay / ${x.i.vesting.cliff || 0} ay</td>
          <td class="num">${fmtN(x.i.shares)}</td><td class="num">${fmtN(x.vested)}</td><td class="num">${fmtN(x.i.shares - x.vested)}</td>
          <td><span class="progress" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${p * 100}%"></div></span> <span class="small muted">${fmtPct(p)}</span></td>
          <td>${next ? esc(next) + (cliffPending ? ' <span class="pill">cliff</span>' : '') : '<span class="tag-ok">Tamamlandı</span>'}</td>
          <td>${esc(Calc.vestingEnd(x.i))}</td>
        </tr>`;
      }).join('')}</tbody>`;
  }

  // ---------- Çıkış analizi ----------
  function renderExit(c) {
    const f = document.getElementById('exitForm');
    const exit = Math.max(0, parseFloat(f.value.value) || 0);
    const vestedOnly = f.vestedOnly.checked;
    const asOf = today();
    const positions = state.issuances
      .filter((i) => stakeholderById(i.stakeholderId) && classById(i.classId))
      .map((i) => ({ iss: i, classId: i.classId, price: i.price || 0,
        shares: vestedOnly && classById(i.classId).kind === 'option' ? Calc.vestedShares(i, asOf) : i.shares }))
      .filter((p) => p.shares > 0);
    const kpis = document.getElementById('exitKpis'), chart = document.getElementById('exitChart');
    const t = document.getElementById('exitTable'), tc = document.getElementById('exitClassTable');
    if (!positions.length) {
      kpis.innerHTML = ''; chart.innerHTML = '';
      t.innerHTML = tc.innerHTML = '<tbody><tr><td class="empty">Hesaplama için pay kaydı gerekli.</td></tr></tbody>';
      return;
    }
    const r = Calc.waterfall(positions, state.classes, exit);
    const prefTotal = r.prefPaid.reduce((a, b) => a + b, 0);

    // Hissedar bazında topla
    const per = new Map();
    positions.forEach((p, idx) => {
      const id = p.iss.stakeholderId;
      const row = per.get(id) || { s: stakeholderById(id), shares: 0, payout: 0, invested: 0, pref: 0 };
      row.shares += p.shares; row.payout += r.payouts[idx]; row.pref += r.prefPaid[idx];
      if (classById(p.classId).kind !== 'option') row.invested += p.shares * p.price;
      per.set(id, row);
    });
    const rows = [...per.values()].sort((a, b) => b.payout - a.payout);

    kpis.innerHTML = [
      ['Adi pay başı değer', fmtMoney(r.pps, true)],
      ['Tasfiye tercihi ödemeleri', fmtMoney(prefTotal)],
      ['Adi paylara kalan', fmtMoney(exit - prefTotal - r.unallocated)],
      ['Kurucuların payı', fmtMoney(rows.filter((x) => x.s.category === 'founder').reduce((a, x) => a + x.payout, 0))],
    ].map(([l, v]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join('');

    // Kategori grafiği (Özet ile aynı bileşen)
    const byCat = {};
    rows.forEach((x) => { const k = x.s.category in CATEGORIES ? x.s.category : 'other'; byCat[k] = (byCat[k] || 0) + x.payout; });
    renderStack(chart, Object.entries(CATEGORIES).map(([k, m]) => ({ key: k, label: m.label, color: `var(${m.color})`, value: byCat[k] || 0 })), exit,
      (s) => `<div class="t-row"><span>Tutar</span><span>${fmtMoney(s.value)}</span></div><div class="t-row"><span>Oran</span><span>${fmtPct(s.pct)}</span></div>`);

    t.innerHTML = `
      <thead><tr><th>Hissedar</th><th>Kategori</th><th class="num">Pay</th><th class="num">Tercih ödemesi</th><th class="num">Toplam alacak</th><th class="num">% Satış bedeli</th><th class="num">Yatırım</th><th class="num">Getiri (×)</th></tr></thead>
      <tbody>${rows.map((x) => `<tr>
        <td><span class="swatch" style="background:var(${(CATEGORIES[x.s.category] || CATEGORIES.other).color})"></span>${esc(x.s.name)}</td>
        <td><span class="pill">${(CATEGORIES[x.s.category] || CATEGORIES.other).single}</span></td>
        <td class="num">${fmtN(x.shares)}</td>
        <td class="num">${x.pref ? fmtMoney(x.pref) : '—'}</td>
        <td class="num"><b>${fmtMoney(x.payout)}</b></td>
        <td class="num">${fmtPct(exit ? x.payout / exit : 0)}</td>
        <td class="num">${x.invested ? fmtMoney(x.invested) : '—'}</td>
        <td class="num">${x.invested >= 1 ? nf2.format(x.payout / x.invested) + '×' : '—'}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td>Toplam</td><td></td><td></td><td class="num">${fmtMoney(prefTotal)}</td><td class="num">${fmtMoney(exit - r.unallocated)}</td><td class="num">${fmtPct(exit ? (exit - r.unallocated) / exit : 0)}</td><td></td><td></td></tr></tfoot>`;

    tc.innerHTML = `
      <thead><tr><th>Pay sınıfı</th><th>Tür</th><th class="num">Pay</th><th>Koşullar</th><th>Karar</th><th class="num">Toplam alacak</th></tr></thead>
      <tbody>${state.classes.filter((k) => positions.some((p) => p.classId === k.id)).map((k) => {
        const shares = positions.filter((p) => p.classId === k.id).reduce((a, p) => a + p.shares, 0);
        let terms = '—', decision = '—';
        if (k.kind === 'preferred') {
          terms = `${nf2.format(k.liqMultiple ?? 1)}× · ${k.participating ? 'katılımlı' : 'katılımsız'} · kıdem ${k.seniority || 1}`;
          decision = k.participating ? 'Tercih + katılım' : r.convert[k.id] ? 'Adi paya dönüşür' : 'Tercih tutarını alır';
        } else if (k.kind === 'option') {
          const itm = positions.filter((p, idx) => p.classId === k.id && r.inTheMoney.has(idx)).length;
          const all = positions.filter((p) => p.classId === k.id).length;
          decision = itm === all ? 'Kullanılır' : itm ? 'Kısmen kullanılır' : 'Para dışında';
        }
        return `<tr><td>${esc(k.name)}</td><td><span class="pill">${CLASS_KINDS[k.kind]}</span></td><td class="num">${fmtN(shares)}</td>
          <td class="muted">${terms}</td><td>${decision}</td><td class="num">${fmtMoney(r.byClass[k.id] || 0)}</td></tr>`;
      }).join('')}</tbody>`;
  }

  // ---------- Genel ----------
  function render() {
    const c = compute();
    document.getElementById('companyLabel').textContent = state.company.name;
    renderKpis(c);
    renderCategoryChart(c);
    renderCapTable(c);
    renderStakeholders(c);
    renderLedger(c);
    renderRound(c);
    renderVesting();
    renderExit(c);
    renderSettings();
  }
  function commit(msg) { save(); render(); if (msg) toast(msg); }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  const tip = document.getElementById('tooltip');
  function bindTooltip(el, html) {
    el.addEventListener('mousemove', (e) => {
      tip.innerHTML = html(); tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    try { localStorage.setItem('hisse-defteri:tab', name); } catch (e) { /* yok say */ }
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportCsv() {
    const c = compute();
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Hissedar', 'Kategori', 'Adi pay', 'İmtiyazlı pay', 'Opsiyon', '% Çıkarılmış', '% Tam seyreltilmiş', 'Yatırım'].map(q).join(';')];
    for (const r of c.rows.filter((x) => x.total > 0)) {
      lines.push([r.s.name, (CATEGORIES[r.s.category] || CATEGORIES.other).single, r.common, r.preferred, r.option,
        (c.outstanding ? r.outstanding / c.outstanding * 100 : 0).toFixed(4), (r.total / c.fullyDiluted * 100).toFixed(4), r.invested.toFixed(2)].map(q).join(';'));
    }
    if (c.poolUnallocated) lines.push(['Ayrılmamış opsiyon havuzu', 'Havuz', 0, 0, c.poolUnallocated, 0, (c.poolUnallocated / c.fullyDiluted * 100).toFixed(4), 0].map(q).join(';'));
    download('ortaklik-tablosu.csv', '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }

  // ---------- Olaylar ----------
  function bind() {
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    document.getElementById('stakeholderForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      state.stakeholders.push({ id: uid(), name: f.name.value.trim(), category: f.category.value, email: f.email.value.trim() });
      f.reset();
      commit('Hissedar eklendi.');
    });

    document.getElementById('issuanceForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.stakeholderId.value) { toast('Önce bir hissedar ekleyin.'); return; }
      const shares = parseInt(f.shares.value, 10);
      if (!(shares > 0)) return;
      const cls = classById(f.classId.value);
      if (cls?.kind === 'option') {
        const c = compute();
        if (shares > c.poolUnallocated && !confirm(`Bu hibe havuzda kalan ${fmtN(c.poolUnallocated)} payı aşıyor. Havuz otomatik büyütülsün mü?`)) return;
        if (shares > c.poolUnallocated) state.company.optionPool += shares - c.poolUnallocated;
      }
      const vesting = f.hasVesting.checked && parseInt(f.vestMonths.value, 10) > 0
        ? { start: f.vestStart.value || f.date.value, months: parseInt(f.vestMonths.value, 10), cliff: Math.max(0, parseInt(f.vestCliff.value, 10) || 0) }
        : null;
      state.issuances.push({ id: uid(), stakeholderId: f.stakeholderId.value, classId: f.classId.value, shares,
        price: parseFloat(f.price.value) || 0, date: f.date.value, note: f.note.value.trim(), vesting });
      f.shares.value = ''; f.price.value = ''; f.note.value = ''; f.vestStart.value = '';
      commit('İşlem kaydedildi.');
    });

    const issForm = document.getElementById('issuanceForm');
    const syncVest = () => {
      issForm.querySelectorAll('.vest-field').forEach((el) => { el.hidden = !issForm.hasVesting.checked; });
    };
    issForm.classId.addEventListener('change', () => {
      issForm.hasVesting.checked = classById(issForm.classId.value)?.kind === 'option';
      syncVest();
    });
    issForm.hasVesting.addEventListener('change', syncVest);
    issForm.hasVesting.checked = classById(issForm.classId.value)?.kind === 'option';
    syncVest();

    document.getElementById('roundForm').addEventListener('input', () => renderRound(compute()));
    document.getElementById('exitForm').addEventListener('input', () => renderExit(compute()));
    document.getElementById('exitForm').addEventListener('submit', (e) => e.preventDefault());
    const asOf = document.getElementById('vestAsOf');
    asOf.value = today();
    asOf.addEventListener('input', () => renderVesting());
    document.getElementById('applyRound').addEventListener('click', applyRound);

    document.getElementById('companyForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      state.company.name = f.name.value.trim() || state.company.name;
      state.company.currency = f.currency.value;
      state.company.optionPool = Math.max(0, parseInt(f.optionPool.value, 10) || 0);
      f.querySelector('button').blur();
      commit('Şirket bilgileri kaydedildi.');
    });

    document.getElementById('classForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const kind = f.kind.value;
      state.classes.push(Object.assign({ id: uid(), name: f.name.value.trim(), kind },
        kind === 'preferred' ? { liqMultiple: 1, participating: false, seniority: 1 } : {}));
      f.reset();
      commit('Pay sınıfı eklendi.');
    });

    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.delIssuance && confirm('Bu işlem silinsin mi?')) {
        state.issuances = state.issuances.filter((i) => i.id !== t.dataset.delIssuance);
        commit('İşlem silindi.');
      } else if (t.dataset.delStakeholder) {
        const id = t.dataset.delStakeholder;
        const n = state.issuances.filter((i) => i.stakeholderId === id).length;
        if (!confirm(n ? `Bu hissedarın ${n} işlemi de silinecek. Emin misiniz?` : 'Bu hissedar silinsin mi?')) return;
        state.stakeholders = state.stakeholders.filter((s) => s.id !== id);
        state.issuances = state.issuances.filter((i) => i.stakeholderId !== id);
        commit('Hissedar silindi.');
      } else if (t.dataset.delClass) {
        state.classes = state.classes.filter((k) => k.id !== t.dataset.delClass);
        commit('Pay sınıfı silindi.');
      }
    });
    document.body.addEventListener('change', (e) => {
      const cf = e.target.dataset?.classField;
      if (cf) {
        const k = classById(e.target.dataset.classId);
        if (!k) return;
        if (cf === 'participating') k.participating = e.target.value === '1';
        else if (cf === 'liqMultiple') k.liqMultiple = Math.max(0, parseFloat(e.target.value) || 0);
        else if (cf === 'seniority') k.seniority = Math.max(1, parseInt(e.target.value, 10) || 1);
        commit('Pay sınıfı güncellendi.');
        return;
      }
      const id = e.target.dataset?.cat;
      if (!id) return;
      const s = stakeholderById(id);
      if (s) { s.category = e.target.value; commit('Kategori güncellendi.'); }
    });

    document.getElementById('exportCsv').addEventListener('click', exportCsv);
    document.getElementById('exportJson').addEventListener('click', () =>
      download('hisse-defteri-yedek.json', JSON.stringify(state, null, 2), 'application/json'));
    document.getElementById('importJson').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { state = normalize(JSON.parse(await file.text())); commit('Veriler içe aktarıldı.'); }
      catch (err) { toast('Dosya okunamadı.'); }
      e.target.value = '';
    });
    document.getElementById('loadDemo').addEventListener('click', () => {
      if (confirm('Mevcut verilerin yerine örnek veri yüklensin mi?')) { state = demoState(); commit('Örnek veri yüklendi.'); }
    });
    document.getElementById('resetAll').addEventListener('click', () => {
      if (confirm('Tüm veriler silinecek. Emin misiniz?')) { state = emptyState(); commit('Tüm veriler silindi.'); }
    });

    document.getElementById('themeToggle').addEventListener('click', () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch (err) { /* yok say */ }
    });
  }

  // ---------- Başlat ----------
  try {
    const th = localStorage.getItem(THEME_KEY);
    if (th) document.documentElement.dataset.theme = th;
    const tab = localStorage.getItem('hisse-defteri:tab');
    if (tab && document.getElementById('tab-' + tab)) switchTab(tab);
  } catch (e) { /* yok say */ }
  bind();
  render();
})();
