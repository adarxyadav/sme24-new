-- benchmark_assumptions (spec 0008, kind G): the seven stored constants of the cost model; every
-- signed in user reads, only ops and migrations write, the seed holds exactly the seven keys, all
-- provisional, with the multipliers in order (AC-1, AC-2, AC-15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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

-- The seed (AC-2)
select results_eq(
  $$ select key from public.benchmark_assumptions order by key $$,
  $$ values ('cost_per_absence_day_chf'), ('direct_cost_per_case_chf'), ('hours_per_fte'), ('indirect_multiplier'), ('indirect_multiplier_high'), ('indirect_multiplier_low'), ('lost_days_per_incident_default') $$,
  'the seed holds exactly the seven assumption keys');
select is((select count(*) from public.benchmark_assumptions where not provisional), 0::bigint, 'every seeded assumption is provisional');
select ok(
  (select value from public.benchmark_assumptions where key = 'indirect_multiplier_low') <= (select value from public.benchmark_assumptions where key = 'indirect_multiplier')
  and (select value from public.benchmark_assumptions where key = 'indirect_multiplier') <= (select value from public.benchmark_assumptions where key = 'indirect_multiplier_high'),
  'the three multipliers are in order');

-- Shape rules (AC-1)
select throws_ok(
  $$ insert into public.benchmark_assumptions (key, value, unit, label, source_name, effective_from) values ('x', 1, 'u', '{"de":"nur Deutsch"}', 's', '2026-01-01') $$,
  '23514', null, 'a label without both locales is rejected');
select throws_ok(
  $$ insert into public.benchmark_assumptions (key, value, unit, label, source_name, effective_from, note) values ('x', 1, 'u', '{"de":"a","en":"b"}', 's', '2026-01-01', '{"en":"only English"}') $$,
  '23514', null, 'a note without both locales is rejected');
select throws_ok(
  $$ insert into public.benchmark_assumptions (key, value, unit, label, source_name, effective_from) values ('hours_per_fte', 1, 'u', '{"de":"a","en":"b"}', 's', '2026-01-01') $$,
  '23505', null, 'a second row per key is rejected');

-- A client reads and cannot write
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.benchmark_assumptions), 7::bigint, 'a client reads the seven assumptions');
select throws_ok(
  $$ insert into public.benchmark_assumptions (key, value, unit, label, source_name, effective_from) values ('x', 1, 'u', '{"de":"a","en":"b"}', 's', '2026-01-01') $$,
  '42501', null, 'a client cannot insert an assumption');
select is(pg_temp.affected($$ update public.benchmark_assumptions set value = 999 where key = 'hours_per_fte' $$), 0::bigint,
  'a client cannot update an assumption (zero rows)');
select is(pg_temp.affected($$ delete from public.benchmark_assumptions $$), 0::bigint, 'a client cannot delete an assumption (zero rows)');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.benchmark_assumptions), 7::bigint, 'an expert reads the assumptions');

select pg_temp.as_anon();
select is((select count(*) from public.benchmark_assumptions), 0::bigint, 'anon reads nothing');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.benchmark_assumptions (key, value, unit, label, source_name, effective_from) values ('test_key', 1, 'u', '{"de":"a","en":"b"}', 's', '2026-01-01') $$,
  'ops insert an assumption');
select lives_ok($$ update public.benchmark_assumptions set provisional = false where key = 'test_key' $$, 'ops update an assumption');

select pg_temp.as_postgres();
select is((select count(*) from public.audit_log where table_name = 'benchmark_assumptions'), 0::bigint, 'no audit row is written for benchmark_assumptions');

select * from finish();
rollback;
