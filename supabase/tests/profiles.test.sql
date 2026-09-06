-- profiles: own row plus the rows of the same organization, own full_name and locale only,
-- ops read and update all; handle_new_user copies display data (spec 0002 AC-3, AC-4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- The suite assumes a database freshly reset (`pnpm db:reset`): it inserts fixtures with fixed
-- keys and counts rows globally. Fail with a clear message rather than a bad plan when a probe
-- left rows behind.
do $$
begin
  if exists (select 1 from public.organizations
             where id not in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
     or exists (select 1 from public.companies)
     or exists (select 1 from public.company_kpis)
     or exists (select 1 from public.research_runs)
     or exists (select 1 from public.kpi_definitions where key not in ('ltifr', 'trifr', 'fatalities', 'lost_days_per_incident', 'accident_rate_per_1000_fte', 'absenteeism_rate', 'near_miss_rate', 'iso_45001_certified')) then
    raise exception 'this database holds rows beyond the seed; run `pnpm db:reset` before the tests';
  end if;
end $$;


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

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client', '{"full_name":"Anna A","locale":"en"}');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000002', 'a-member@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client', '{"full_name":"","locale":"fr"}');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'member'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');

-- handle_new_user copies display data from user metadata
select results_eq(
  $$ select full_name, locale from public.profiles where id = 'a0000000-0000-4000-8000-000000000001' $$,
  $$ values ('Anna A', 'en') $$,
  'handle_new_user copies full_name and locale from user metadata');
select results_eq(
  $$ select full_name, locale from public.profiles where id = 'b0000000-0000-4000-8000-000000000001' $$,
  $$ values (null::text, 'en') $$,
  'an empty name becomes null and an unknown locale falls back to en');

-- Owner of A
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq(
  $$ select id from public.profiles order by id $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid), ('a0000000-0000-4000-8000-000000000002'::uuid) $$,
  'a member reads their own row and the rows of their organization');
select lives_ok(
  $$ update public.profiles set full_name = 'Anna Renamed', locale = 'de' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'a user updates their own full_name and locale');
select results_eq(
  $$ select full_name, locale from public.profiles where id = 'a0000000-0000-4000-8000-000000000001' $$,
  $$ values ('Anna Renamed', 'de') $$,
  'the display data update landed');
select throws_ok(
  $$ update public.profiles set role = 'ops' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a user cannot change their own role (column grant)');
select throws_ok(
  $$ update public.profiles set organization_id = '0b000000-0000-4000-8000-000000000000' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a user cannot change their own organization (column grant)');
select throws_ok(
  $$ update public.profiles set locale = 'fr' where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an unknown locale is rejected by the check constraint');
select is(
  pg_temp.affected($$ update public.profiles set full_name = 'Hijack' where id = 'a0000000-0000-4000-8000-000000000002' $$),
  0::bigint, 'a member cannot update another member''s profile (zero rows)');

-- Expert
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('e0000000-0000-4000-8000-000000000001'::uuid) $$,
  'an expert reads only their own row');

-- Anon
select pg_temp.as_anon();
select is((select count(*) from public.profiles), 0::bigint, 'anon reads no profile');

-- Ops
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.profiles where id in ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001')), 5::bigint,
  'ops read every profile');
select lives_ok(
  $$ update public.profiles set full_name = 'Fixed by ops' where id = 'a0000000-0000-4000-8000-000000000002' $$,
  'ops update another user''s display data');
select pg_temp.as_postgres();
select is((select full_name from public.profiles where id = 'a0000000-0000-4000-8000-000000000002'), 'Fixed by ops',
  'the ops update landed');

select * from finish();
rollback;
