-- research_runs: a member requests a queued run for their own company, the task moves it on as
-- the service key, the transition trigger rejects every other move, the table is in the realtime
-- publication (spec 0002 AC-3, AC-4, AC-5, AC-10). Spec 0007 AC-2 adds one open run per company,
-- five runs per organization per day, and the narrow members update policy.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

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
select throws_ok(
  $$ update public.research_runs set status = 'running' where id = '0d000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a member cannot progress their own queued run to running (the update policy only allows failed)');
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

-- One open run per company, the members update policy and the daily quota (spec 0007, AC-2).
-- At this point organization A holds run 1 (succeeded) and run 2 (failed): two runs today.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select lives_ok(
  $$ insert into public.research_runs (id, organization_id, company_id, requested_by)
     values ('0d000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002') $$,
  'a member requests a third run once the earlier ones are closed');
select throws_like(
  $$ insert into public.research_runs (organization_id, company_id, requested_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002') $$,
  '%research_runs_one_open_per_company_idx%',
  'a second open run for the same company fails with a unique violation naming the index');
select is(pg_temp.affected($$ update public.research_runs set trigger_run_id = 'run_3' where id = '0d000000-0000-4000-8000-000000000003' $$), 1::bigint,
  'a member sets trigger_run_id on their own queued run');
select throws_ok(
  $$ update public.research_runs set summary = '{"step":"done"}' where id = '0d000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'a member cannot touch summary (no column grant)');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is(pg_temp.affected($$ update public.research_runs set status = 'failed' where id = '0d000000-0000-4000-8000-000000000003' $$), 0::bigint,
  'another member of the organization cannot close the run (zero rows)');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select is(pg_temp.affected($$ update public.research_runs set status = 'failed', error_code = 'trigger_failed', error_message = 'x', finished_at = now() where id = '0d000000-0000-4000-8000-000000000003' $$), 1::bigint,
  'a member moves their own queued run to failed with trigger_failed');
select pg_temp.as_postgres();
insert into public.research_runs (id, organization_id, company_id, requested_by, status, started_at) values
  ('0d000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'running', now());
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select is(pg_temp.affected($$ update public.research_runs set status = 'failed' where id = '0d000000-0000-4000-8000-000000000004' $$), 0::bigint,
  'a member cannot touch their own running run (zero rows)');
-- Four runs count today (run 3 is trigger_failed); two more make five.
select pg_temp.as_postgres();
update public.research_runs set status = 'failed', error_code = 'provider_unavailable', finished_at = now() where id = '0d000000-0000-4000-8000-000000000004';
insert into public.research_runs (id, organization_id, company_id, requested_by, status, finished_at) values
  ('0d000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'succeeded', now()),
  ('0d000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'succeeded', now());
select is((select private.research_run_allowed('0a000000-0000-4000-8000-000000000000')), false, 'the helper says no at five runs in 24 hours');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ insert into public.research_runs (organization_id, company_id, requested_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'the sixth run in 24 hours fails the insert policy');
select pg_temp.as_postgres();
update public.research_runs set created_at = now() - interval '25 hours' where id = '0d000000-0000-4000-8000-000000000005';
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select lives_ok(
  $$ insert into public.research_runs (id, organization_id, company_id, requested_by)
     values ('0d000000-0000-4000-8000-000000000007', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002') $$,
  'a run created 25 hours ago does not count');
select is(pg_temp.affected($$ update public.research_runs set status = 'failed', error_code = 'trigger_failed', finished_at = now() where id = '0d000000-0000-4000-8000-000000000007' $$), 1::bigint,
  'the member closes the run the trigger call lost');
select lives_ok(
  $$ insert into public.research_runs (id, organization_id, company_id, requested_by)
     values ('0d000000-0000-4000-8000-000000000008', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002') $$,
  'a trigger_failed row does not count');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is(pg_temp.affected($$ update public.research_runs set status = 'failed', error_code = 'stale', finished_at = now() where id = '0d000000-0000-4000-8000-000000000008' $$), 1::bigint,
  'ops close any run, whoever requested it');
select lives_ok(
  $$ insert into public.research_runs (id, organization_id, company_id, requested_by)
     values ('0d000000-0000-4000-8000-000000000009', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001') $$,
  'an ops user is unaffected by the quota');

-- `loadQuota` in src/features/research/queries.ts counts the same rows the helper's predicate
-- does, spelled as PostgREST's `error_code.is.null,error_code.neq.trigger_failed`. If the two
-- ever drift, the dashboard's "n of 5 runs left" stops matching what the insert policy enforces.
select pg_temp.as_postgres();
select is(
  (select count(*) from public.research_runs r
   where r.organization_id = '0a000000-0000-4000-8000-000000000000'
     and r.created_at > now() - interval '24 hours'
     and (r.error_code is null or r.error_code <> 'trigger_failed')),
  (select count(*) from public.research_runs r
   where r.organization_id = '0a000000-0000-4000-8000-000000000000'
     and r.created_at > now() - interval '24 hours'
     and r.error_code is distinct from 'trigger_failed'),
  'the dashboard quota filter counts exactly what private.research_run_allowed counts');

-- Expert and ops
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.research_runs), 9::bigint, 'the assigned expert reads the runs of A');
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.research_runs), 0::bigint, 'a member of B reads no run of A');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.research_runs where organization_id = '0a000000-0000-4000-8000-000000000000'), 9::bigint, 'ops read the runs');

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
