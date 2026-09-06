-- benchmark_snapshots (spec 0008, kind T): the task inserts as the service role, members and
-- assigned experts read their organization's rows, no app role holds a write grant (a member
-- insert fails on the grant, not only on a policy), ops read and write through the service
-- client, and every insert leaves an audit row with the service actor (AC-1, AC-15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

-- The minimal insert the task makes, keyed by ids.
create function pg_temp.snapshot_sql(snapshot_id uuid, org_id uuid, company_id uuid)
returns text language sql immutable as $$
  select format($f$ insert into public.benchmark_snapshots (id, organization_id, company_id, trigger_kind, model_version, peer_provisional, kpis_compared, inputs, results, gaps, assumptions)
    values (%L, %L, %L, 'research', 'benchmark-model@1', true, 1, '{}', '[]', '[]', '[]') $f$, snapshot_id, org_id, company_id)
$$;

-- The task, as the service key
select pg_temp.as_service_role();
select lives_ok(pg_temp.snapshot_sql('0e000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a'),
  'the service role inserts a snapshot for company A');
select lives_ok(pg_temp.snapshot_sql('0e000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b'),
  'the service role inserts a snapshot for company B');
select throws_ok(
  $$ insert into public.benchmark_snapshots (organization_id, company_id, trigger_kind, model_version, peer_provisional, kpis_compared, inputs, results, gaps, assumptions)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'manual', 'benchmark-model@1', true, 1, '{}', '[]', '[]', '[]') $$,
  '23514', null, 'an unknown trigger kind is rejected');
select throws_ok(
  $$ insert into public.benchmark_snapshots (organization_id, company_id, trigger_kind, model_version, peer_provisional, kpis_compared, inputs, results, gaps, assumptions)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'research', 'benchmark-model@1', true, 9, '{}', '[]', '[]', '[]') $$,
  '23514', null, 'more than eight compared KPIs is rejected');
select throws_ok(
  $$ insert into public.benchmark_snapshots (organization_id, company_id, trigger_kind, model_version, peer_provisional, kpis_compared, confidence, inputs, results, gaps, assumptions)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'research', 'benchmark-model@1', true, 1, 1.5, '{}', '[]', '[]', '[]') $$,
  '23514', null, 'a confidence above 1 is rejected');

-- A member of A reads their own rows and cannot write (the grant is revoked, so the statement raises)
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.benchmark_snapshots), 1::bigint, 'a member of A sees exactly A''s snapshot');
select is((select count(*) from public.benchmark_snapshots where organization_id = '0b000000-0000-4000-8000-000000000000'), 0::bigint,
  'a member of A sees none of B''s snapshots');
select throws_ok(pg_temp.snapshot_sql('0e000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a'),
  '42501', null, 'a member cannot insert a snapshot in their own organization (the grant is revoked)');
select throws_ok(pg_temp.snapshot_sql('0e000000-0000-4000-8000-000000000004', '0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b'),
  '42501', null, 'a member cannot insert a snapshot in another organization');
select throws_ok($$ update public.benchmark_snapshots set kpis_compared = 2 where id = '0e000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a member cannot update a snapshot');
select throws_ok($$ delete from public.benchmark_snapshots where id = '0e000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a member cannot delete a snapshot');
select throws_ok($$ truncate public.benchmark_snapshots $$, '42501', null, 'a member cannot truncate the table');

select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.benchmark_snapshots where organization_id = '0a000000-0000-4000-8000-000000000000'), 0::bigint,
  'a member of B sees none of A''s snapshots');

-- The assigned expert reads A, not B
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.benchmark_snapshots where organization_id = '0a000000-0000-4000-8000-000000000000'), 1::bigint,
  'an assigned expert reads A''s snapshot');
select is((select count(*) from public.benchmark_snapshots where organization_id = '0b000000-0000-4000-8000-000000000000'), 0::bigint,
  'the expert sees none of B''s snapshots');

select pg_temp.as_anon();
select is((select count(*) from public.benchmark_snapshots), 0::bigint, 'anon reads nothing');

-- Ops read everything; their writes go through the service client (the grant is revoked for every app role).
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.benchmark_snapshots), 2::bigint, 'ops read both snapshots');
select throws_ok(pg_temp.snapshot_sql('0e000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a'),
  '42501', null, 'ops cannot insert directly as the authenticated role; the task and the service client write');

select pg_temp.as_service_role();
select lives_ok($$ update public.benchmark_snapshots set kpis_compared = 2 where id = '0e000000-0000-4000-8000-000000000001' $$,
  'the service role can update (the updated_at trigger exists for the contract; no app path uses it)');

-- Every insert leaves an audit row with the service actor (AC-15).
select pg_temp.as_postgres();
-- Scoped to the two fixture rows: the audit log outlives the companies of earlier local runs.
select is((select count(*) from public.audit_log
           where table_name = 'benchmark_snapshots' and action = 'insert' and actor_role = 'service'
             and row_id::text in ('0e000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000002')), 2::bigint,
  'one audit row per snapshot insert with the service actor');

select * from finish();
rollback;
