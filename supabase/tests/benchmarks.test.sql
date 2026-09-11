-- benchmarks (spec 0008, kind G): every signed in user reads the peer table, only ops and
-- migrations write, the quartile order and the section and band rules hold, and the committed
-- seed migration holds the provisional first set (AC-1, AC-2, AC-15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Shared shape (spec 0002, Policy tests): everything below runs in one transaction and is rolled
-- back at the end, so nothing survives. Impersonation switches the role and the JWT claims the
-- way PostgREST does; `pg_temp.as_postgres()` returns to the superuser between scenarios.
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

create function pg_temp.as_service_role()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

create function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A minimal auth user; the profiles trigger creates the profile from app_metadata.role.
create function pg_temp.make_user(user_id uuid, email text, app_role text, meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    meta, now(), now());
end $$;

-- Runs a write as the current role and returns the number of rows it touched: the way to show
-- that a policy filtered every row (zero rows, no error) rather than raised.
create function pg_temp.affected(statement text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

-- Fixtures: two organizations with an owner each, an expert assigned to A, ops, a company in each.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000002', 'a-member@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'member'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');
-- Every expert here needs an `active` expert_profiles row: the check_expert_assignable trigger
-- (spec 0012) refuses an assignment on an expert who is not active. The trigger's own cases live
-- in expert_assignable.test.sql; here the rows are only fixture setup.
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'active', now());

insert into public.expert_assignments (organization_id, expert_id, assigned_by) values
  ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
insert into public.companies (id, organization_id, name, created_by) values
  ('0c000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', 'Company A', 'a0000000-0000-4000-8000-000000000001'),
  ('0c000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', 'Company B', 'b0000000-0000-4000-8000-000000000001');
insert into public.kpi_definitions (key, name, unit, direction) values
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better')
on conflict (key) do nothing;

-- The seed (AC-2): the generated migration seeded the provisional first set.
select cmp_ok((select count(*) from public.benchmarks where kpi_key = 'accident_rate_per_1000_fte' and industry_section = 'ALL' and size_band = 'all'), '>=', 1::bigint,
  'the seed holds an ALL and all row for the accident rate');
-- The two flags (spec 0016, AC-2, AC-3): `provisional` means not yet read from its named source,
-- `is_assumption` means no published source exists. Every peer row has been read from its named
-- source (the spec 0016 amendment of 2026-09-12, AC-29), and no peer row is a declared assumption.
select is((select count(*) from public.benchmarks where provisional), 0::bigint, 'no seeded peer row is provisional');
select is((select count(*) from public.benchmarks where source_key is null or basis is null), 0::bigint,
  'every seeded peer row names its source classification and its basis');
select is((select count(*) from public.benchmarks where kpi_key = 'accident_rate_per_1000_fte' and size_band = 'all'), 22::bigint,
  'one Suva accident rate row per section plus ALL');
-- The size band rows (the spec 0016 amendment, AC-27, D4): one scaled estimate per (section, band)
-- whose Eurostat band holds at least 100 accidents and 5 000 employed persons, 37 in all.
select is((select count(*) from public.benchmarks where kpi_key = 'accident_rate_per_1000_fte' and size_band <> 'all'), 37::bigint,
  'one scaled accident rate row per section and band that clears the floor');
-- A band row is derived from its section's Suva row of the same year, so it can never outlive it.
select is((select count(*) from public.benchmarks b where b.kpi_key = 'accident_rate_per_1000_fte' and b.size_band <> 'all'
    and not exists (select 1 from public.benchmarks a where a.kpi_key = b.kpi_key and a.industry_section = b.industry_section
      and a.size_band = 'all' and a.period_year = b.period_year)), 0::bigint,
  'every accident rate band row has the section row of the same year it was scaled from');
select is((select count(*) from public.benchmarks where kpi_key = 'fatalities'), 22::bigint, 'one Eurostat fatality rate row per section plus ALL');
select is((select count(*) from public.benchmarks where kpi_key = 'lost_days_per_incident'), 21::bigint,
  'one Eurostat lost days row per section plus ALL, none for section U (three accidents)');
select is((select count(*) from public.benchmarks where kpi_key = 'absenteeism_rate'), 20::bigint,
  'one BFS absence rate row per published section group member plus ALL, none for P and U');
select is((select count(*) from public.benchmarks where is_assumption), 0::bigint, 'no seeded peer row is a declared assumption');
select is((select count(*) from public.benchmarks where provisional and is_assumption), 0::bigint,
  'no peer row is both provisional and a declared assumption');

-- Shape rules (AC-1), as the superuser so no policy hides them.
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('ltifr', 'C', 'all', 2022, 3, 2, 4, 'test') $$,
  '23514', null, 'p25 above the median is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('ltifr', 'X', 'all', 2022, 1, 2, 3, 'test') $$,
  '23514', null, 'an unknown section is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('ltifr', 'C', 'huge', 2022, 1, 2, 3, 'test') $$,
  '23514', null, 'an unknown size band is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('accident_rate_per_1000_fte', 'ALL', 'all', 2024, 1, 2, 3, 'test') $$,
  '23505', null, 'a second row per KPI, section, band and year is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('unknown_kpi', 'C', 'all', 2022, 1, 2, 3, 'test') $$,
  '23503', null, 'an unknown KPI key is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name, source_note) values ('ltifr', 'C', 'all', 2022, 1, 2, 3, 'test', '{"de":"nur Deutsch"}') $$,
  '23514', null, 'a source note without both locales is rejected');
-- The two curation columns (spec 0016, AC-1). `basis` is the caveat the client actually sees, so
-- the database holds the same both-or-neither rule `source_note` has: the CSV parser's refinement
-- only guards the seed path, and a hand written migration or a later ops UI writes straight here.
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name, basis) values ('ltifr', 'C', 'all', 2022, 1, 2, 3, 'test', '{"de":"nur Deutsch"}') $$,
  '23514', null, 'a basis without both locales is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name, basis) values ('ltifr', 'C', 'all', 2022, 1, 2, 3, 'test', '{"en":"English only"}') $$,
  '23514', null, 'a basis with only the English locale is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name, basis) values ('ltifr', 'C', 'all', 2022, 1, 2, 3, 'test', '"a sentence"') $$,
  '23514', null, 'a basis that is not an object is rejected');
-- Both columns are optional and default to null (AC-1); since the peer data refresh (the spec 0016
-- amendment of 2026-09-12, AC-24 to AC-28) every seeded row fills both, so the client always sees
-- what the figure describes. Rows this file inserts under the source name 'test' are excluded.
select is(
  (select count(*) from public.benchmarks where (source_key is null or basis is null) and source_name <> 'test'), 0::bigint,
  'every seeded peer row fills both curation columns');
select lives_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name, source_key, basis) values ('ltifr', 'D', 'all', 2022, 1, 2, 3, 'test', 'Suva class 22A', '{"de":"Mittelwert einer Suva-Klasse","en":"The mean of one Suva class"}') $$,
  'a source key and a basis with both locales are accepted');

-- A client reads and cannot write
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select cmp_ok((select count(*) from public.benchmarks), '>=', 1::bigint, 'a client reads the peer table');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('ltifr', 'C', 'all', 2022, 1, 2, 3, 'test') $$,
  '42501', null, 'a client cannot insert a peer row');
select is(pg_temp.affected($$ update public.benchmarks set median = 999 where kpi_key = 'accident_rate_per_1000_fte' $$), 0::bigint,
  'a client cannot update a peer row (zero rows)');
select is(pg_temp.affected($$ delete from public.benchmarks $$), 0::bigint, 'a client cannot delete a peer row (zero rows)');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select cmp_ok((select count(*) from public.benchmarks), '>=', 1::bigint, 'an expert reads the peer table');

select pg_temp.as_anon();
select is((select count(*) from public.benchmarks), 0::bigint, 'anon reads nothing');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('ltifr', 'C', 'all', 2022, 1, 2, 3, 'test') $$,
  'ops insert a peer row');
select lives_ok($$ update public.benchmarks set provisional = false where kpi_key = 'ltifr' and industry_section = 'C' $$, 'ops update a peer row');

-- Reference data is not audited (spec 0002, kind G).
select pg_temp.as_postgres();
select is((select count(*) from public.audit_log where table_name = 'benchmarks'), 0::bigint, 'no audit row is written for benchmarks');

select * from finish();
rollback;
