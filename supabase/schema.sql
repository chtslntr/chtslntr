-- Hisse Defteri — Supabase veritabanı şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştırıp "Run".
-- Birden fazla kez çalıştırılabilir (idempotent).

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

-- Her şirketin ortaklık tablosu tek bir JSON belgesi olarak tutulur.
-- "version" eşzamanlı düzenlemelerde üzerine yazmayı önlemek içindir.
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  data        jsonb not null default '{}'::jsonb,
  version     integer not null default 1,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null
);

create table if not exists public.memberships (
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('owner', 'editor', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  role        text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (company_id, email)
);

-- Değişiklik geçmişi: her sürümün içeriği, yazarı ve zamanı
create table if not exists public.company_history (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  version     integer not null,
  data        jsonb not null,
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists company_history_company_idx on public.company_history (company_id, version desc);

-- ---------------------------------------------------------------------------
-- Yardımcı fonksiyonlar (RLS içinde özyinelemeyi önlemek için SECURITY DEFINER)
-- ---------------------------------------------------------------------------

create or replace function public.company_role(cid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.memberships where company_id = cid and user_id = auth.uid()
$$;

create or replace function public.has_company_role(cid uuid, roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.company_role(cid) = any (roles), false)
$$;

-- ---------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------

-- Şirketi oluşturan kişi otomatik olarak "owner" olur.
create or replace function public.on_company_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.memberships (company_id, user_id, email, role)
  values (new.id, auth.uid(), coalesce(lower(auth.jwt() ->> 'email'), ''), 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists company_created on public.companies;
create trigger company_created after insert on public.companies
  for each row execute function public.on_company_created();

-- Her güncellemede sürümü artır ve zaman damgasını yaz.
create or replace function public.on_company_updated()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.version    := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists company_updated on public.companies;
create trigger company_updated before update on public.companies
  for each row execute function public.on_company_updated();

-- Oluşturma ve içerik değişikliklerinde yeni sürümü geçmişe yaz.
create or replace function public.log_company_version()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.data is distinct from old.data then
    insert into public.company_history (company_id, version, data, changed_by, changed_at)
    values (new.id, new.version, new.data, new.updated_by, new.updated_at);
  end if;
  return null;
end;
$$;

drop trigger if exists company_versioned on public.companies;
create trigger company_versioned after insert or update on public.companies
  for each row execute function public.log_company_version();

-- Son sahibin silinmesini / rolünün düşürülmesini engelle.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.companies where id = old.company_id)
     and not exists (
       select 1 from public.memberships
       where company_id = old.company_id and role = 'owner' and user_id <> old.user_id
     ) then
    raise exception 'Şirketin en az bir sahibi olmalı.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists memberships_last_owner on public.memberships;
create trigger memberships_last_owner before update or delete on public.memberships
  for each row execute function public.protect_last_owner();

-- ---------------------------------------------------------------------------
-- RPC: şirket oluştur (sahiplik kaydıyla birlikte) ve kimliğini döndür
-- ---------------------------------------------------------------------------

create or replace function public.create_company(p_name text, p_data jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'Oturum açılmamış.';
  end if;
  insert into public.companies (name, data, created_by)
  values (p_name, coalesce(p_data, '{}'::jsonb), auth.uid())
  returning id into cid;
  return cid;
end;
$$;

revoke all on function public.create_company(text, jsonb) from public, anon;
grant execute on function public.create_company(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: oturum açan kullanıcıya gelen davetleri kabul et
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitations()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  me_email text := lower(auth.jwt() ->> 'email');
  n integer;
begin
  if auth.uid() is null or me_email is null then
    return 0;
  end if;
  insert into public.memberships (company_id, user_id, email, role)
  select company_id, auth.uid(), me_email, role
  from public.invitations where email = me_email
  on conflict (company_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from public.invitations where email = me_email;
  return n;
end;
$$;

revoke all on function public.accept_invitations() from public, anon;
grant execute on function public.accept_invitations() to authenticated;

-- ---------------------------------------------------------------------------
-- Satır bazlı güvenlik (RLS)
-- ---------------------------------------------------------------------------

alter table public.companies       enable row level security;
alter table public.memberships     enable row level security;
alter table public.invitations     enable row level security;
alter table public.company_history enable row level security;

-- companies
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.has_company_role(id, array['owner', 'editor', 'viewer']));

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (public.has_company_role(id, array['owner', 'editor']))
  with check (public.has_company_role(id, array['owner', 'editor']));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete to authenticated
  using (public.has_company_role(id, array['owner']));

-- memberships
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (public.has_company_role(company_id, array['owner', 'editor', 'viewer']));

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_company_role(company_id, array['owner']))
  with check (public.has_company_role(company_id, array['owner']));

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_company_role(company_id, array['owner']) or user_id = auth.uid());
-- Not: üyelik ekleme yalnızca tetikleyici ve accept_invitations() üzerinden yapılır.

-- invitations
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_company_role(company_id, array['owner']));

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.has_company_role(company_id, array['owner']) and invited_by = auth.uid());

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.has_company_role(company_id, array['owner']));

-- company_history (salt okunur)
drop policy if exists history_select on public.company_history;
create policy history_select on public.company_history for select to authenticated
  using (public.has_company_role(company_id, array['owner', 'editor', 'viewer']));

-- Tablo yetkileri
revoke all on public.companies, public.memberships, public.invitations, public.company_history from anon;
grant select, insert, update, delete on public.companies to authenticated;
grant select, update, delete on public.memberships to authenticated;
grant select, insert, delete on public.invitations to authenticated;
grant select on public.company_history to authenticated;

-- ---------------------------------------------------------------------------
-- Gerçek zamanlı güncellemeler (başka bir ekip üyesi kaydettiğinde ekran yenilenir)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'companies'
     ) then
    alter publication supabase_realtime add table public.companies;
  end if;
end $$;
