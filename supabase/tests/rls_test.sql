-- Yerel RLS testleri: psql -v ON_ERROR_STOP=1 -f auth_stub.sql -f ../schema.sql -f rls_test.sql
\set QUIET on
create or replace function pg_temp.as_user(uid text, email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email)::text, false);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'BAŞARISIZ: %', msg; end if;
  raise notice 'geçti: %', msg;
end $$;
create or replace function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin
  execute sql; return false;
exception when others then return true;
end $$;

set role authenticated;

-- Alice şirket oluşturur
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
select pg_temp.check(public.create_company('Acme', '{"x":1}') is not null, 'create_company RPC kimlik döndürür');
select pg_temp.check((select count(*) from public.memberships where role = 'owner') = 1, 'oluşturan kişi sahip olur');
select pg_temp.check((select created_by from public.companies) = '00000000-0000-0000-0000-00000000000a', 'created_by atanır');

-- Bob göremez
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@example.com');
select pg_temp.check((select count(*) from public.companies) = 0, 'üye olmayan şirketi göremez');
select pg_temp.check(pg_temp.fails($$insert into public.memberships (company_id, user_id, email, role) select id, auth.uid(), 'bob@example.com', 'owner' from public.companies$$)
  or (select count(*) from public.memberships) = 0, 'kendini doğrudan üye yapamaz');
select pg_temp.check(pg_temp.fails($$insert into public.invitations (company_id, email, role) values ((select id from public.companies limit 1), 'bob@example.com', 'owner')$$), 'üye olmayan davet oluşturamaz');

-- Alice Bob'u izleyici olarak davet eder
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
insert into public.invitations (company_id, email, role) select id, 'bob@example.com', 'viewer' from public.companies;

-- Bob daveti kabul eder, okuyabilir ama yazamaz
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@example.com');
select pg_temp.check(public.accept_invitations() = 1, 'davet kabul edilir');
select pg_temp.check((select count(*) from public.companies) = 1, 'izleyici şirketi görür');
update public.companies set data = '{"hack":1}';
select pg_temp.check((select data from public.companies) = '{"x":1}', 'izleyici güncelleyemez');
update public.memberships set role = 'owner' where user_id = auth.uid();
select pg_temp.check((select role from public.memberships where user_id = auth.uid()) = 'viewer', 'izleyici kendi rolünü yükseltemez');
select pg_temp.check((select count(*) from public.invitations) = 0, 'izleyici davetleri göremez');

-- Alice, Bob'u düzenleyici yapar
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
update public.memberships set role = 'editor' where email = 'bob@example.com';

-- Bob düzenler; sürüm artar, geçmiş yazılır; sürüm koşullu güncelleme çakışmayı yakalar
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@example.com');
update public.companies set data = '{"x":2}' where version = 1;
select pg_temp.check((select version from public.companies) = 2, 'sürüm artar');
select pg_temp.check((select count(*) from public.company_history) = 2, 'geçmişe oluşturma ve güncelleme yazılır');
select pg_temp.check((select changed_by from public.company_history where version = 2) = '00000000-0000-0000-0000-00000000000b', 'geçmişte yazar doğru');
select pg_temp.check((select changed_by from public.company_history where version = 1) = '00000000-0000-0000-0000-00000000000a', 'ilk sürümün yazarı oluşturan kişi');
update public.companies set data = '{"x":3}' where version = 1;
select pg_temp.check((select data from public.companies) = '{"x":2}', 'eski sürümle yazma etkisiz kalır');
select pg_temp.check(pg_temp.fails($$insert into public.invitations (company_id, email, role) select id, 'carol@example.com', 'viewer' from public.companies$$), 'düzenleyici davet edemez');
delete from public.companies;
select pg_temp.check((select count(*) from public.companies) = 1, 'düzenleyici şirketi silemez');

-- Carol hiçbir şey göremez
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c', 'carol@example.com');
select pg_temp.check((select count(*) from public.companies) + (select count(*) from public.memberships) + (select count(*) from public.company_history) = 0, 'yabancı hiçbir veri göremez');
select pg_temp.check(public.accept_invitations() = 0, 'daveti olmayan kabul edemez');

-- Son sahip ayrılamaz; şirket silinince her şey temizlenir
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'alice@example.com');
select pg_temp.check(pg_temp.fails($$delete from public.memberships where user_id = auth.uid()$$), 'son sahip ayrılamaz');
select pg_temp.check(pg_temp.fails($$update public.memberships set role = 'viewer' where user_id = auth.uid()$$), 'son sahip rolünü düşüremez');
delete from public.companies;
reset role;
select pg_temp.check((select count(*) from public.companies) + (select count(*) from public.memberships) + (select count(*) from public.company_history) = 0, 'şirket silinince ilişkili kayıtlar silinir');

-- Anonim erişim yok
set role anon;
select pg_temp.check(pg_temp.fails($$select public.create_company('x')$$), 'anonim kullanıcı şirket oluşturamaz');
select pg_temp.check(pg_temp.fails('select * from public.companies'), 'anonim kullanıcı tabloya erişemez');
reset role;
