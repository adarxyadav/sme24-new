-- check_expert_assignable: an assignment is only ever created for an `active` expert (spec 0012,
-- AC-9). The rule lives in the database rather than the ops action so a deactivation racing an
-- assign cannot leave an assignment on an expert who has just left the network, and so feature 19
-- inherits it without repeating it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

do $$
begin
  if exists (select 1 from public.expert_assignments) then
    raise exception 'this database holds assignments; run `pnpm db:reset` before the tests';
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
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'active@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'invited@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000003', 'inactive@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000004', 'no-profile@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- One expert in each state, plus a user with the expert role and no profile row at all.
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'active@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'invited@test.local', 'invited', null),
  ('e0000000-0000-4000-8000-000000000003', 'inactive@test.local', 'active', now());

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select public.set_expert_status('e0000000-0000-4000-8000-000000000003', 'inactive');

select lives_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001') $$,
  'an active expert can be assigned');

select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'an invited expert who has not onboarded cannot be assigned');

select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000003') $$,
  '23514', null, 'a deactivated expert cannot be assigned');

select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000004') $$,
  '23514', null, 'a user with the expert role but no profile row cannot be assigned');

-- The race the trigger exists for: ops deactivate, then a second ops tab assigns.
select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'inactive');
select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'an assign that lands after a deactivation is refused, not merely discouraged');

-- The service role goes through the check too: a task cannot walk around it.
select pg_temp.as_service_role();
select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'the service role is held to the same rule');

-- A client is refused by RLS before the trigger says anything about the expert. The order matters:
-- the trigger runs before the policy's with check, so it deliberately steps aside for a caller who
-- cannot insert, rather than telling them whether the expert exists and is active.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a client gets the RLS refusal, never the expert''s status');
select throws_ok(
  $$ insert into public.expert_assignments (organization_id, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'and the same refusal whether that expert is active or not');

select * from finish();
rollback;
