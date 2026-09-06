-- kpi_definitions: every signed in user reads, only ops write (spec 0002 AC-3); the data migration
-- of spec 0007 (AC-1) seeds the eight catalogue rows a client reads and cannot write.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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

select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.kpi_definitions where key = 'ltifr'), 1::bigint, 'a client reads the catalogue');
select is((select count(*) from public.kpi_definitions where is_active), 8::bigint, 'the migration seeded eight active KPIs');
select results_eq(
  $$ select key from public.kpi_definitions where is_active order by sort_order $$,
  $$ values ('ltifr'), ('trifr'), ('fatalities'), ('lost_days_per_incident'), ('accident_rate_per_1000_fte'), ('absenteeism_rate'), ('near_miss_rate'), ('iso_45001_certified') $$,
  'the eight KPIs come in the catalogue sort order');
select is((select count(*) from public.kpi_definitions where name ? 'de' and name ? 'en' and description ? 'de' and description ? 'en'), 8::bigint,
  'every seeded KPI carries a German and an English name and description');
select throws_ok(
  $$ insert into public.kpi_definitions (key, name, unit, direction) values ('trir', '{"de":"TRIR","en":"TRIR"}', 'per 200k hours', 'lower_is_better') $$,
  '42501', null, 'a client cannot insert a definition');
select is(pg_temp.affected($$ update public.kpi_definitions set unit = 'x' where key = 'ltifr' $$), 0::bigint,
  'a client cannot update a definition (zero rows)');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.kpi_definitions where key = 'ltifr'), 1::bigint, 'an expert reads the catalogue');

select pg_temp.as_anon();
select is((select count(*) from public.kpi_definitions), 0::bigint, 'anon reads nothing');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.kpi_definitions (key, name, unit, direction) values ('trir', '{"de":"TRIR","en":"TRIR"}', 'per 200k hours', 'lower_is_better') $$,
  'ops insert a definition');
select lives_ok($$ update public.kpi_definitions set is_active = false where key = 'trir' $$, 'ops update a definition');
select throws_ok(
  $$ insert into public.kpi_definitions (key, name, unit, direction) values ('bad', '{"de":"nur Deutsch"}', 'x', 'neutral') $$,
  '23514', null, 'a name without both locales is rejected');
select throws_ok(
  $$ insert into public.kpi_definitions (key, name, unit, direction) values ('bad', '{"de":"x","en":"x"}', 'x', 'sideways') $$,
  '23514', null, 'an unknown direction is rejected');

-- Reference data is not audited (spec 0002, kind G): the ops insert and update above left no row.
select pg_temp.as_postgres();
select is((select count(*) from public.audit_log where table_name = 'kpi_definitions'), 0::bigint,
  'no audit row is written for kpi_definitions');

select * from finish();
rollback;
