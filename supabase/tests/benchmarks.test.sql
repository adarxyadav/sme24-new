-- benchmarks (spec 0008, kind G): every signed in user reads the peer table, only ops and
-- migrations write, the quartile order and the section and band rules hold, and the committed
-- seed migration holds the provisional first set (AC-1, AC-2, AC-15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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
select is((select count(*) from public.benchmarks where not provisional), 0::bigint, 'every seeded peer row is provisional');

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
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('accident_rate_per_1000_fte', 'ALL', 'all', 2022, 1, 2, 3, 'test') $$,
  '23505', null, 'a second row per KPI, section, band and year is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name) values ('unknown_kpi', 'C', 'all', 2022, 1, 2, 3, 'test') $$,
  '23503', null, 'an unknown KPI key is rejected');
select throws_ok(
  $$ insert into public.benchmarks (kpi_key, industry_section, size_band, period_year, p25, median, p75, source_name, source_note) values ('ltifr', 'C', 'all', 2022, 1, 2, 3, 'test', '{"de":"nur Deutsch"}') $$,
  '23514', null, 'a source note without both locales is rejected');

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
