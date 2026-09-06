-- organization_members: members see their organization's members, owners manage them, the
-- membership trigger keeps profiles.organization_id in step (spec 0002 AC-3, AC-4, AC-6).
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000002', 'a-member@test.local', 'client');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000003', 'a-newcomer@test.local', 'client');
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

select is((select organization_id from public.profiles where id = 'a0000000-0000-4000-8000-000000000002'),
  '0a000000-0000-4000-8000-000000000000'::uuid, 'the membership trigger sets the current organization');
-- The sync trigger only ever writes the profile of the row's own user (self join or no caller at
-- all), so a membership row inserted for someone else can never rewrite their profile.
select lives_ok(
  $$ insert into public.organization_members (organization_id, user_id)
     values ('0b000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000003') $$,
  'a membership row can still be written directly by the superuser (ops, seed, migrations)');
select is((select organization_id from public.profiles where id = 'a0000000-0000-4000-8000-000000000003'),
  '0b000000-0000-4000-8000-000000000000'::uuid,
  'a superuser insert still syncs the profile, because there is no caller to distrust');
delete from public.organization_members
  where organization_id = '0b000000-0000-4000-8000-000000000000' and user_id = 'a0000000-0000-4000-8000-000000000003';
select is((select organization_id from public.profiles where id = 'a0000000-0000-4000-8000-000000000003'),
  null, 'a user without a membership has no current organization');

-- Owner of A
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.organization_members), 2::bigint, 'owner of A reads the two members of A');
select is((select count(*) from public.organization_members where organization_id = '0b000000-0000-4000-8000-000000000000'), 0::bigint,
  'owner of A reads no member of B');
-- Owner adds go through the rpc; a direct insert is revoked so a policy is never the only gate.
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id) values ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'even an owner cannot insert a membership row directly');
select lives_ok(
  $$ select public.add_organization_member('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000003') $$,
  'owner of A adds a member to A through the rpc');
select throws_ok(
  $$ select public.add_organization_member('0b000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_an_owner', 'owner of A cannot add a member to B');
-- The escalation the rpc exists to stop: a target who did not consent (an ops or expert account,
-- or a client who already belongs somewhere) is refused, so no membership row can drive their
-- profile and mint them an organization claim.
select throws_ok(
  $$ select public.add_organization_member('0a000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_a_client', 'an owner cannot pull the ops account into their organization');
select throws_ok(
  $$ select public.add_organization_member('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_a_client', 'an owner cannot pull an expert into their organization');
select throws_ok(
  $$ select public.add_organization_member('0a000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_a_client', 'an owner cannot pull another organization''s owner in');
select lives_ok(
  $$ update public.organization_members set role = 'owner' where user_id = 'a0000000-0000-4000-8000-000000000002' $$,
  'owner of A promotes a member');
select pg_temp.as_postgres();
select is((select organization_id from public.profiles where id = 'a0000000-0000-4000-8000-000000000003'),
  '0a000000-0000-4000-8000-000000000000'::uuid, 'the newcomer''s current organization is A after the insert');
select is((select role from public.organization_members where user_id = 'a0000000-0000-4000-8000-000000000002'), 'owner',
  'the promotion landed');

-- Plain member of A (the newcomer)
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000003', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ select public.add_organization_member('0a000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_an_owner', 'a plain member cannot add members');
select is(
  pg_temp.affected($$ delete from public.organization_members where user_id = 'a0000000-0000-4000-8000-000000000001' $$),
  0::bigint, 'a plain member cannot remove the owner (zero rows)');

-- Owner removes the newcomer; the trigger clears the profile
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select lives_ok(
  $$ delete from public.organization_members where user_id = 'a0000000-0000-4000-8000-000000000003' $$,
  'owner of A removes the newcomer');
select pg_temp.as_postgres();
select is((select organization_id from public.profiles where id = 'a0000000-0000-4000-8000-000000000003'), null,
  'the removed member''s current organization is cleared');

-- Expert and ops
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.organization_members), 0::bigint, 'an expert reads no membership');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.organization_members where organization_id in ('0a000000-0000-4000-8000-000000000000', '0b000000-0000-4000-8000-000000000000')), 3::bigint,
  'ops read every membership');

select * from finish();
rollback;
