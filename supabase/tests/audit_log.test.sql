-- audit_log: one row per write on the core tables with the actor, role and organization;
-- append only for anon, authenticated and service_role; ops read, clients do not
-- (spec 0002 AC-3, AC-4, AC-5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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
     or exists (select 1 from public.kpi_definitions) then
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

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000002', 'a-member@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');

-- Writes without a token (fixtures as postgres) are recorded as system
select results_eq(
  $$ select actor_id, actor_role, action from public.audit_log where table_name = 'organizations' and row_id = '0a000000-0000-4000-8000-000000000000' $$,
  $$ values (null::uuid, 'system', 'insert') $$,
  'a fixture insert is recorded once as system with no actor');
select is((select count(*) from public.audit_log where table_name = 'profiles' and row_id = 'a0000000-0000-4000-8000-000000000001' and action = 'insert'), 1::bigint,
  'the profile created by handle_new_user has one insert row');
select is(
  (select organization_id from public.audit_log where table_name = 'profiles' and row_id = 'a0000000-0000-4000-8000-000000000001' and action = 'update'),
  '0a000000-0000-4000-8000-000000000000'::uuid,
  'the membership trigger''s profile update carries the row''s organization');

-- A client member's writes. updated_at does not show up in changed_columns here because now()
-- is constant inside this one transaction; in a real request it changes.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
update public.organizations set name = 'Org A renamed' where id = '0a000000-0000-4000-8000-000000000000';
update public.profiles set full_name = 'Owner A' where id = 'a0000000-0000-4000-8000-000000000001';
-- Owner adds go through the rpc: direct insert is revoked from authenticated so a policy can
-- never be the only gate on who joins an organization.
select public.add_organization_member('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002');
select is((select count(*) from public.audit_log), 0::bigint, 'a client reads no audit row');
select throws_ok($$ insert into public.audit_log (actor_role, table_name, row_id, action) values ('client', 'x', '1', 'insert') $$,
  '42501', null, 'a client cannot insert an audit row');
select throws_ok($$ update public.audit_log set table_name = 'x' $$, '42501', null, 'a client cannot update audit rows');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'a client cannot delete audit rows');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'a client cannot truncate the audit log');

select pg_temp.as_postgres();
select results_eq(
  $$ select actor_id, actor_role, organization_id, changed_columns, old_data ->> 'name', new_data ->> 'name'
     from public.audit_log where table_name = 'organizations' and row_id = '0a000000-0000-4000-8000-000000000000' and action = 'update' $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid, 'client', null::uuid, array['name'], 'Org A', 'Org A renamed') $$,
  'an organization rename is recorded with actor, role, changed columns, old and new data');
select is((select count(*) from public.audit_log where table_name = 'organizations' and row_id = '0a000000-0000-4000-8000-000000000000' and action = 'update'), 1::bigint,
  'exactly one audit row per update');
select results_eq(
  $$ select actor_role, organization_id, changed_columns from public.audit_log
     where table_name = 'profiles' and row_id = 'a0000000-0000-4000-8000-000000000001' and action = 'update' and actor_id = 'a0000000-0000-4000-8000-000000000001' $$,
  $$ values ('client', '0a000000-0000-4000-8000-000000000000'::uuid, array['full_name']) $$,
  'a profile update is recorded with the profile''s organization');
select results_eq(
  $$ select actor_id, actor_role, organization_id from public.audit_log
     where table_name = 'organization_members' and action = 'insert' and new_data ->> 'user_id' = 'a0000000-0000-4000-8000-000000000002' $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid, 'client', '0a000000-0000-4000-8000-000000000000'::uuid) $$,
  'a membership insert is recorded with the organization');

-- changed_columns is exactly the keys whose value differs. now() is constant inside one
-- transaction, so this row is created an hour in the past to let updated_at move on the rename.
insert into public.organizations (id, name, created_by, created_at, updated_at) values
  ('0a000000-0000-4000-8000-000000000001', 'Org A2', 'a0000000-0000-4000-8000-000000000001', now() - interval '1 hour', now() - interval '1 hour');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
update public.organizations set name = 'Org A2 renamed' where id = '0a000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select results_eq(
  $$ select changed_columns from public.audit_log
     where table_name = 'organizations' and row_id = '0a000000-0000-4000-8000-000000000001' and action = 'update' $$,
  $$ values (array['name', 'updated_at']) $$,
  'a rename records exactly {name, updated_at} as changed columns');

-- Ops writes and reads
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
delete from public.organization_members where user_id = 'a0000000-0000-4000-8000-000000000002';
select ok((select count(*) from public.audit_log where organization_id = '0a000000-0000-4000-8000-000000000000') > 0, 'ops read the audit rows');
select results_eq(
  $$ select actor_id, actor_role, action, old_data ->> 'user_id', new_data from public.audit_log
     where table_name = 'organization_members' and action = 'delete' and old_data ->> 'user_id' = 'a0000000-0000-4000-8000-000000000002' $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'::uuid, 'ops', 'delete', 'a0000000-0000-4000-8000-000000000002', null::jsonb) $$,
  'an ops delete is recorded with the old row and no new row');
select throws_ok($$ update public.audit_log set table_name = 'x' $$, '42501', null, 'ops cannot update audit rows');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'ops cannot delete audit rows');

-- Service role (tasks) and anon
select pg_temp.as_service_role();
insert into public.organization_members (organization_id, user_id) values ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002');
select throws_ok($$ update public.audit_log set table_name = 'x' $$, '42501', null, 'service_role cannot update audit rows');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'service_role cannot delete audit rows');
select pg_temp.as_anon();
select is((select count(*) from public.audit_log), 0::bigint, 'anon reads no audit row');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'anon cannot delete audit rows');
-- TRUNCATE is the one DML verb RLS cannot filter: it ignores policies and fires no row trigger,
-- so before the revoke a single request wiped every tenant and left the trail showing nothing.
select throws_ok($$ truncate table public.company_kpis $$, '42501', null, 'anon cannot truncate a tenant table');
select throws_ok($$ truncate table public.profiles $$, '42501', null, 'anon cannot truncate profiles');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok($$ truncate table public.companies $$, '42501', null, 'a client cannot truncate a tenant table');
select pg_temp.as_service_role();
select throws_ok($$ truncate table public.organizations $$, '42501', null, 'the service key cannot truncate a tenant table');

select pg_temp.as_postgres();
select results_eq(
  $$ select actor_id, actor_role from public.audit_log
     where table_name = 'organization_members' and action = 'insert' and new_data ->> 'user_id' = 'a0000000-0000-4000-8000-000000000002' order by id desc limit 1 $$,
  $$ values (null::uuid, 'service') $$,
  'a service key write is recorded as service with no actor');

-- The maintenance path is the only way to change a row, even for the superuser
select throws_ok($$ update public.audit_log set new_data = null where table_name = 'profiles' $$, 'P0001', 'audit_log is append only',
  'the superuser cannot update audit rows outside maintenance');
select throws_ok($$ delete from public.audit_log where table_name = 'profiles' $$, 'P0001', 'audit_log is append only',
  'the superuser cannot delete audit rows outside maintenance');
select set_config('app.audit_maintenance', 'on', true);
select lives_ok($$ update public.audit_log set new_data = new_data - 'full_name' where table_name = 'profiles' $$,
  'the maintenance setting allows a redaction');
select set_config('app.audit_maintenance', 'off', true);
select throws_ok($$ delete from public.audit_log where table_name = 'profiles' $$, 'P0001', 'audit_log is append only',
  'the guard is back once the setting is off');

select * from finish();
rollback;
