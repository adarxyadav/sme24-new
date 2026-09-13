-- peer_companies (spec 0021, kind G): every signed in user reads the library, only ops and
-- migrations write, nobody deletes through the app roles, anon is blocked, the shape checks hold,
-- and the committed seed migration holds the first curation (AC-2, AC-4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.impersonate(user_id uuid, app_role text, org_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', user_id, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', app_role, 'organization_id', org_id)))::text, true);
end $$;

create function pg_temp.as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.make_user(user_id uuid, email text, app_role text, meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    meta, now(), now());
end $$;

create function pg_temp.affected(statement text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');
insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- The seed (AC-4, as at least counts so adding a peer never breaks it): manufacturing and
-- construction, each company with a headcount, a report and a verified figure.
select cmp_ok((select count(*) from public.peer_companies where industry_section = 'C'), '>=', 3::bigint,
  'the seed holds at least three manufacturers');
select is((select count(*) from public.peer_companies c where not exists (
    select 1 from public.peer_figures f where f.peer_key = c.key and f.verified_at is not null)), 0::bigint,
  'every seeded company has at least one verified figure');
select is((select count(*) from public.peer_companies where headcount <= 0 or report_url = ''), 0::bigint,
  'every seeded company has a headcount and a report');

-- Shape rules (AC-2), as the superuser so no policy hides them.
select throws_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values ('Bad Key', 'Test', 'CH', 'C', 10, 2025, 'https://example.org') $$,
  '23514', null, 'a key outside [a-z0-9-] is rejected');
select throws_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values ('test-co', 'Test', 'ch', 'C', 10, 2025, 'https://example.org') $$,
  '23514', null, 'a lowercase country code is rejected');
select throws_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values ('test-co', 'Test', 'CH', 'ALL', 10, 2025, 'https://example.org') $$,
  '23514', null, 'a section outside A to U is rejected (no ALL: the library never widens)');
select throws_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values ('test-co', 'Test', 'CH', 'C', 0, 2025, 'https://example.org') $$,
  '23514', null, 'a headcount of zero is rejected');
select throws_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url, note) values ('test-co', 'Test', 'CH', 'C', 10, 2025, 'https://example.org', '{"de":"nur Deutsch"}') $$,
  '23514', null, 'a note without both locales is rejected');
select lives_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url, note) values ('test-co', 'Test AG', 'CH', 'C', 10, 2025, 'https://example.org', '{"de":"Notiz","en":"Note"}') $$,
  'a well formed company is accepted');
select throws_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values ('test-co', 'Twice', 'CH', 'C', 10, 2025, 'https://example.org') $$,
  '23505', null, 'a second company under one key is rejected');

-- A client reads and cannot write.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select cmp_ok((select count(*) from public.peer_companies), '>=', 1::bigint, 'a client reads the library');
select throws_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values ('client-co', 'Client', 'CH', 'C', 10, 2025, 'https://example.org') $$,
  '42501', null, 'a client cannot insert a company');
select is(pg_temp.affected($$ update public.peer_companies set name = 'x' where key = 'test-co' $$), 0::bigint,
  'a client cannot update a company (zero rows)');
select is(pg_temp.affected($$ delete from public.peer_companies where key = 'test-co' $$), 0::bigint,
  'a client cannot delete a company (zero rows)');
select throws_ok($$ truncate public.peer_companies $$, '42501', null, 'a client cannot truncate the library');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select cmp_ok((select count(*) from public.peer_companies), '>=', 1::bigint, 'an expert reads the library');

select pg_temp.as_anon();
select is((select count(*) from public.peer_companies), 0::bigint, 'anon reads nothing');

-- Ops insert and update, and still cannot delete: no policy allows it, so a retired company goes
-- out through the generated migration only.
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values ('ops-co', 'Ops AG', 'DE', 'F', 500, 2024, 'https://example.org') $$,
  'ops insert a company');
select lives_ok($$ update public.peer_companies set headcount = 600 where key = 'ops-co' $$, 'ops update a company');
select is(pg_temp.affected($$ delete from public.peer_companies where key = 'ops-co' $$), 0::bigint,
  'ops cannot delete a company through the app role (zero rows)');
select is((select headcount from public.peer_companies where key = 'ops-co'), 600, 'the ops update landed');

-- Reference data is not audited (spec 0002, kind G).
select pg_temp.as_postgres();
select is((select count(*) from public.audit_log where table_name = 'peer_companies'), 0::bigint, 'no audit row is written for peer_companies');
select is((select count(*) from public.peer_companies where key in ('test-co', 'ops-co')), 2::bigint, 'both test rows are still there');

select * from finish();
rollback;
