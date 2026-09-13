-- peer_figures (spec 0021, kind G): every signed in user reads, only ops and migrations write,
-- nobody deletes through the app roles, anon is blocked, the checks and the verified pair hold,
-- the cascade takes a retired company's figures, and the committed seed holds the first curation
-- with no unverified figure, the third launch gate query (AC-2, AC-4, AC-14).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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
insert into public.kpi_definitions (key, name, unit, direction) values
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better'),
  ('trifr', '{"de":"TRIFR","en":"TRIFR"}', 'per 1M hours', 'lower_is_better'),
  ('lost_days_per_incident', '{"de":"Tage","en":"Days"}', 'days', 'lower_is_better'),
  ('iso_45001_certified', '{"de":"ISO","en":"ISO"}', 'yes or no', 'higher_is_better'),
  ('fatalities', '{"de":"Tote","en":"Fatalities"}', 'count', 'lower_is_better')
on conflict (key) do nothing;
insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values
  ('test-co', 'Test AG', 'CH', 'C', 100, 2025, 'https://example.org');

-- The seed (AC-4, AC-14): at least three verified LTIFR figures in manufacturing, none unverified.
select cmp_ok((select count(*) from public.peer_figures f join public.peer_companies c on c.key = f.peer_key
    where c.industry_section = 'C' and f.kpi_key = 'ltifr' and f.verified_at is not null), '>=', 3::bigint,
  'the seed holds at least three verified LTIFR figures in manufacturing');
select is((select count(*) from public.peer_figures where verified_at is null), 0::bigint,
  'no seeded figure is unverified (the third launch gate query)');
select is((select count(*) from public.peer_figures where unit_as_published = 'per_200k_hours' and value <> value_as_published * 5), 0::bigint,
  'every per 200 000 hours figure is stored times five');
select is((select count(*) from public.peer_figures where unit_as_published in ('per_million_hours', 'days') and value <> value_as_published), 0::bigint,
  'per million hours and days figures are stored as published');

-- Shape rules (AC-2), as the superuser so no policy hides them.
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('nobody', 'ltifr', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org') $$,
  '23503', null, 'a figure of an unknown company is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'fatalities', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org') $$,
  '23514', null, 'a KPI outside the four is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 1, 1, 'per_hour', 'employees', 'https://example.org') $$,
  '23514', null, 'an unknown unit is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 1, 1, 'per_million_hours', 'everyone', 'https://example.org') $$,
  '23514', null, 'an unknown basis is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url, verified_at) values ('test-co', 'ltifr', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org', now()) $$,
  '23514', null, 'a verified_at without a verified_by is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url, verified_by) values ('test-co', 'ltifr', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org', 'A. Curator') $$,
  '23514', null, 'a verified_by without a verified_at is rejected');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 1.5, 1.5, 'per_million_hours', 'employees', 'https://example.org') $$,
  'an unverified figure is accepted as work in progress');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url, verified_at, verified_by) values ('test-co', 'ltifr', 2024, 1.2, 1.2, 'per_million_hours', 'employees_and_contractors', 'https://example.org', now(), 'A. Curator') $$,
  'the same company, KPI and year under the other basis is a second row');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 2, 2, 'per_million_hours', 'employees', 'https://example.org') $$,
  '23505', null, 'a second figure per company, KPI, year and basis is rejected');

-- A client reads and cannot write.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select cmp_ok((select count(*) from public.peer_figures), '>=', 2::bigint, 'a client reads the figures');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'trifr', 2024, 3, 3, 'per_million_hours', 'employees', 'https://example.org') $$,
  '42501', null, 'a client cannot insert a figure');
select is(pg_temp.affected($$ update public.peer_figures set value = 0 where peer_key = 'test-co' $$), 0::bigint,
  'a client cannot update a figure (zero rows)');
select is(pg_temp.affected($$ delete from public.peer_figures where peer_key = 'test-co' $$), 0::bigint,
  'a client cannot delete a figure (zero rows)');
select throws_ok($$ truncate public.peer_figures $$, '42501', null, 'a client cannot truncate the figures');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select cmp_ok((select count(*) from public.peer_figures), '>=', 2::bigint, 'an expert reads the figures');

select pg_temp.as_anon();
select is((select count(*) from public.peer_figures), 0::bigint, 'anon reads nothing');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'trifr', 2024, 16, 3.2, 'per_200k_hours', 'employees', 'https://example.org') $$,
  'ops insert a figure');
select lives_ok($$ update public.peer_figures set verified_at = now(), verified_by = 'Ops Curator' where peer_key = 'test-co' and kpi_key = 'trifr' $$,
  'ops verify a figure by filling both columns');
select is(pg_temp.affected($$ delete from public.peer_figures where peer_key = 'test-co' $$), 0::bigint,
  'ops cannot delete a figure through the app role (zero rows)');

-- The cascade (AC-2): retiring a company through the migration path takes its figures.
select pg_temp.as_postgres();
select is((select count(*) from public.peer_figures where peer_key = 'test-co'), 3::bigint, 'the three test figures are there');
delete from public.peer_companies where key = 'test-co';
select is((select count(*) from public.peer_figures where peer_key = 'test-co'), 0::bigint, 'a retired company takes its figures with it');
select is((select count(*) from public.audit_log where table_name in ('peer_figures', 'peer_companies')), 0::bigint,
  'no audit row is written for the peer library');

select * from finish();
rollback;
