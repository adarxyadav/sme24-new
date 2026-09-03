-- expert_assignments: an expert reaches an organization only through an active row, sees nothing
-- before it exists or after it is ended; members see their organization's assignments; ops manage
-- them; active → ended is the only transition (spec 0002 AC-4, AC-5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'expert2@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');

-- Before any assignment
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.organizations), 0::bigint, 'an expert without an assignment reads no organization');
select is((select count(*) from public.expert_assignments), 0::bigint, 'and no assignment');
select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id) values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'an expert cannot assign themselves');

-- A client cannot create assignments either
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id) values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a member cannot create an assignment');

-- Ops assign the expert to A
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.expert_assignments (id, organization_id, expert_id, assigned_by)
     values ('0e000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001') $$,
  'ops create an active assignment');
select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a second active assignment for the same pair is rejected');

-- With the active assignment
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select results_eq($$ select id from public.organizations $$, $$ values ('0a000000-0000-4000-8000-000000000000'::uuid) $$,
  'the assigned expert reads organization A and nothing else');
select is((select count(*) from public.expert_assignments), 1::bigint, 'the expert reads their own assignment');
select is(pg_temp.affected($$ update public.expert_assignments set status = 'ended' where id = '0e000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'the expert cannot end their own assignment (zero rows)');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is((select count(*) from public.expert_assignments), 0::bigint, 'another expert reads no assignment');
select is((select count(*) from public.organizations), 0::bigint, 'and no organization');

-- Members see who is assigned
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.expert_assignments), 1::bigint, 'a member of A reads the assignment to A');
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.expert_assignments), 0::bigint, 'a member of B reads no assignment to A');

-- Transitions: ending sets ended_at, going back raises
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok($$ update public.expert_assignments set status = 'ended' where id = '0e000000-0000-4000-8000-000000000001' $$,
  'ops end the assignment');
select isnt((select ended_at from public.expert_assignments where id = '0e000000-0000-4000-8000-000000000001'), null,
  'ending sets ended_at');
select throws_ok($$ update public.expert_assignments set status = 'active' where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'ended never goes back to active');

-- After the end
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.organizations), 0::bigint, 'the expert reads nothing after the assignment is ended');

-- Audit
select pg_temp.as_postgres();
select results_eq(
  $$ select actor_id, actor_role, organization_id, action from public.audit_log
     where table_name = 'expert_assignments' and row_id = '0e000000-0000-4000-8000-000000000001' order by id $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'::uuid, 'ops', '0a000000-0000-4000-8000-000000000000'::uuid, 'insert'),
            ('c0000000-0000-4000-8000-000000000001'::uuid, 'ops', '0a000000-0000-4000-8000-000000000000'::uuid, 'update') $$,
  'the insert and the end are each audited once with the ops actor');
select is((select count(*) from public.audit_log where table_name = 'expert_assignments'), 2::bigint, 'no other audit row for the table');

-- A new assignment after the end: the unique index only covers active rows, and an ended_at
-- given by the caller is kept rather than overwritten with now()
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.expert_assignments (id, organization_id, expert_id, assigned_by)
     values ('0e000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001') $$,
  'ops assign the same expert to A again once the old assignment is ended');
select lives_ok(
  $$ update public.expert_assignments set status = 'ended', ended_at = '2026-01-01T00:00:00Z' where id = '0e000000-0000-4000-8000-000000000002' $$,
  'ops end it with an explicit ended_at');
select is((select ended_at from public.expert_assignments where id = '0e000000-0000-4000-8000-000000000002'), '2026-01-01T00:00:00Z'::timestamptz,
  'an ended_at given by the caller is kept');

select * from finish();
rollback;
