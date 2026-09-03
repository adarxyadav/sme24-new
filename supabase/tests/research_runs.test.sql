-- research_runs: a member requests a queued run for their own company, the task moves it on as
-- the service key, the transition trigger rejects every other move, the table is in the realtime
-- publication (spec 0002 AC-3, AC-4, AC-5, AC-10).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

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
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better');

-- Member of A requests a run
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select lives_ok(
  $$ insert into public.research_runs (id, organization_id, company_id, requested_by)
     values ('0d000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002') $$,
  'a member requests a run for their company');
select is((select status from public.research_runs where id = '0d000000-0000-4000-8000-000000000001'), 'queued', 'a new run is queued');
select throws_ok(
  $$ insert into public.research_runs (organization_id, company_id, requested_by, status)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'running') $$,
  '42501', null, 'a member cannot insert a run that is not queued');
select throws_ok(
  $$ insert into public.research_runs (organization_id, company_id, requested_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a member cannot name someone else as requester');
select throws_ok(
  $$ insert into public.research_runs (organization_id, company_id, requested_by)
     values ('0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a member cannot insert into another organization');
select throws_ok(
  $$ insert into public.research_runs (organization_id, company_id, requested_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a member cannot request a run for another organization''s company');
select is(pg_temp.affected($$ update public.research_runs set status = 'running' where id = '0d000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'a member cannot progress a run (zero rows)');
select is(pg_temp.affected($$ delete from public.research_runs where id = '0d000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'a member cannot delete a run (zero rows)');

-- The task, as the service key
select pg_temp.as_service_role();
select lives_ok($$ update public.research_runs set status = 'running', started_at = now(), trigger_run_id = 'run_1' where id = '0d000000-0000-4000-8000-000000000001' $$,
  'queued → running');
select throws_ok($$ update public.research_runs set status = 'queued' where id = '0d000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'running → queued raises');
select lives_ok($$ update public.research_runs set status = 'succeeded', finished_at = now() where id = '0d000000-0000-4000-8000-000000000001' $$,
  'running → succeeded');
select throws_ok($$ update public.research_runs set status = 'running' where id = '0d000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'succeeded → running raises');
select throws_ok($$ update public.research_runs set status = 'succeeded' where id = '0d000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a repeat of the same end state raises');
select lives_ok($$ update public.research_runs set summary = '{"sources": 3}' where id = '0d000000-0000-4000-8000-000000000001' $$,
  'other columns of a finished run stay editable');
insert into public.research_runs (id, organization_id, company_id) values
  ('0d000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a');
select throws_ok($$ update public.research_runs set status = 'succeeded' where id = '0d000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'queued → succeeded raises');
select lives_ok($$ update public.research_runs set status = 'failed', error_code = 'no_sources' where id = '0d000000-0000-4000-8000-000000000002' $$,
  'queued → failed');

-- The full transition matrix (AC-10). Each attempt starts from a fresh run inserted in the from
-- state (an insert does not fire the update trigger) and removes it again; a raise rolls the
-- attempt back inside the function, so the table is unchanged afterwards either way.
create function pg_temp.try_transition(from_state text, to_state text)
returns text language plpgsql as $$
declare run_id uuid;
begin
  insert into public.research_runs (organization_id, company_id, status)
  values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', from_state)
  returning id into run_id;
  update public.research_runs set status = to_state where id = run_id;
  delete from public.research_runs where id = run_id;
  return 'ok';
exception when others then
  return sqlstate;
end $$;
create temp table transitions as
  select f.s as from_state, t.s as to_state, pg_temp.try_transition(f.s, t.s) as outcome
  from unnest(array['queued', 'running', 'succeeded', 'empty', 'failed']) f(s)
  cross join unnest(array['queued', 'running', 'succeeded', 'empty', 'failed']) t(s);
select results_eq(
  $$ select from_state, to_state from transitions where outcome = 'ok' order by 1, 2 $$,
  $$ values ('queued', 'failed'), ('queued', 'running'), ('running', 'empty'), ('running', 'failed'), ('running', 'succeeded') $$,
  'exactly five transitions are allowed: queued → running | failed, running → succeeded | empty | failed');
select is((select count(*) from transitions where outcome = '23514'), 20::bigint,
  'every other pair, including a repeat of the same state, raises 23514');

-- Expert and ops
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.research_runs), 2::bigint, 'the assigned expert reads the runs of A');
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.research_runs), 0::bigint, 'a member of B reads no run of A');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.research_runs where organization_id = '0a000000-0000-4000-8000-000000000000'), 2::bigint, 'ops read the runs');

-- Realtime and audit
select pg_temp.as_postgres();
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'research_runs'), 1::bigint,
  'research_runs is in the supabase_realtime publication');
select results_eq(
  $$ select actor_role, action, new_data ->> 'status' from public.audit_log
     where table_name = 'research_runs' and row_id = '0d000000-0000-4000-8000-000000000001' order by id $$,
  $$ values ('client', 'insert', 'queued'), ('service', 'update', 'running'), ('service', 'update', 'succeeded'), ('service', 'update', 'succeeded') $$,
  'the request and each task update are audited with their actor role');

select * from finish();
rollback;
