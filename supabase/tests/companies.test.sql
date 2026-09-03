-- companies: members read, insert and update inside their organization only; assigned experts
-- read; ops everything; every write audited (spec 0002 AC-3, AC-4, AC-5).
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
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better');

-- Member of A
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq($$ select id from public.companies $$, $$ values ('0c000000-0000-4000-8000-00000000000a'::uuid) $$,
  'a member reads only the companies of their organization');
select is((select count(*) from public.companies where organization_id = '0b000000-0000-4000-8000-000000000000'), 0::bigint,
  'a select against organization B returns zero rows');
select lives_ok(
  $$ insert into public.companies (id, organization_id, name, uid, canton, created_by)
     values ('0c000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', 'Subsidiary A', 'CHE-123.456.789', 'ZH', 'a0000000-0000-4000-8000-000000000002') $$,
  'a member inserts a company into their organization');
select throws_ok(
  $$ insert into public.companies (organization_id, name) values ('0b000000-0000-4000-8000-000000000000', 'Intruder') $$,
  '42501', null, 'an insert naming another organization is rejected');
select lives_ok(
  $$ update public.companies set employees_count = 42 where id = '0c000000-0000-4000-8000-000000000002' $$,
  'a member updates a company of their organization');
select throws_ok(
  $$ update public.companies set organization_id = '0b000000-0000-4000-8000-000000000000' where id = '0c000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'moving a company to another organization is rejected');
select is(pg_temp.affected($$ update public.companies set name = 'Hijacked' where id = '0c000000-0000-4000-8000-00000000000b' $$), 0::bigint,
  'an update on organization B''s company touches zero rows');
select is(pg_temp.affected($$ delete from public.companies where id = '0c000000-0000-4000-8000-000000000002' $$), 0::bigint,
  'members cannot delete (zero rows): archive instead');
select throws_ok(
  $$ insert into public.companies (organization_id, name, canton) values ('0a000000-0000-4000-8000-000000000000', 'Bad canton', 'zh') $$,
  '23514', null, 'a canton must be two upper case letters');
select throws_ok(
  $$ insert into public.companies (organization_id, name, uid) values ('0a000000-0000-4000-8000-000000000000', 'Duplicate', 'CHE-123.456.789') $$,
  '23505', null, 'the same UID twice in one organization is rejected');

-- Expert assigned to A
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select results_eq($$ select id from public.companies order by id $$,
  $$ values ('0c000000-0000-4000-8000-000000000002'::uuid), ('0c000000-0000-4000-8000-00000000000a'::uuid) $$,
  'the assigned expert reads the companies of A and not B');
select throws_ok(
  $$ insert into public.companies (organization_id, name) values ('0a000000-0000-4000-8000-000000000000', 'By expert') $$,
  '42501', null, 'an expert cannot insert a company');

-- Ops
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.companies where organization_id in ('0a000000-0000-4000-8000-000000000000', '0b000000-0000-4000-8000-000000000000')), 3::bigint,
  'ops read the companies of both organizations');
select lives_ok($$ update public.companies set archived_at = now() where id = '0c000000-0000-4000-8000-00000000000b' $$,
  'ops update a company in B');

-- Audit
select pg_temp.as_postgres();
select results_eq(
  $$ select actor_id, actor_role, organization_id, action from public.audit_log
     where table_name = 'companies' and row_id = '0c000000-0000-4000-8000-000000000002' order by id $$,
  $$ values ('a0000000-0000-4000-8000-000000000002'::uuid, 'client', '0a000000-0000-4000-8000-000000000000'::uuid, 'insert'),
            ('a0000000-0000-4000-8000-000000000002'::uuid, 'client', '0a000000-0000-4000-8000-000000000000'::uuid, 'update') $$,
  'the member''s insert and update are each audited once');
select results_eq(
  $$ select actor_id, actor_role, changed_columns from public.audit_log
     where table_name = 'companies' and row_id = '0c000000-0000-4000-8000-00000000000b' and action = 'update' $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'::uuid, 'ops', array['archived_at']) $$,
  'the ops update is audited with the changed column');
select is((select count(*) from public.audit_log where table_name = 'companies' and actor_role = 'system'), 2::bigint,
  'the two fixture inserts are audited as system');

select * from finish();
rollback;
