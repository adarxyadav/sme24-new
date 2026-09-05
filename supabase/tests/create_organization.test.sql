-- create_organization: one call creates the organization (in the caller's language), the owner
-- membership and the current organization; refuses non clients, existing members and anon
-- (spec 0002 AC-6; spec 0004 AC-9).
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
select pg_temp.make_user('d0000000-0000-4000-8000-000000000001', 'newcomer@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- A client with no membership
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000001', 'client');
create temp table created as select public.create_organization('Neue AG') as id;
select isnt((select id from created), null, 'a client without a membership gets a new organization id');
select pg_temp.as_postgres();
select results_eq(
  $$ select o.name, o.created_by from public.organizations o join created c on c.id = o.id $$,
  $$ values ('Neue AG', 'd0000000-0000-4000-8000-000000000001'::uuid) $$,
  'the organization carries the name and the caller as created_by');
select is(
  (select m.role from public.organization_members m join created c on c.id = m.organization_id where m.user_id = 'd0000000-0000-4000-8000-000000000001'),
  'owner', 'the caller holds the owner membership');
select is(
  (select organization_id from public.profiles where id = 'd0000000-0000-4000-8000-000000000001'),
  (select id from created), 'the caller''s current organization is the new one');
select is((select o.locale from public.organizations o join created c on c.id = o.id), 'en',
  'a caller with the default language creates an English organization');
create function pg_temp.hook(user_id uuid)
returns jsonb language sql as $$
  select public.custom_access_token_hook(jsonb_build_object('user_id', user_id,
    'claims', '{"role":"authenticated","app_metadata":{"provider":"email"}}'::jsonb)) -> 'claims';
$$;
select is(pg_temp.hook('d0000000-0000-4000-8000-000000000001') -> 'app_metadata' ->> 'organization_id', (select id::text from created),
  'the next token issued by the hook carries the new organization_id');

-- Second call and other roles
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000001', 'client', (select id from created));
select throws_ok($$ select public.create_organization('Zweite AG') $$, 'SM409', 'already_member',
  'a second call by the same user raises already_member');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok($$ select public.create_organization('Another') $$, 'SM409', 'already_member',
  'an existing member raises already_member');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select throws_ok($$ select public.create_organization('Expert AG') $$, 'SM403', 'not_a_client',
  'an expert raises not_a_client');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select throws_ok($$ select public.create_organization('Ops AG') $$, 'SM403', 'not_a_client',
  'ops raise not_a_client');
select pg_temp.as_service_role();
select throws_ok($$ select public.create_organization('Service AG') $$, 'SM403', 'not_a_client',
  'the service key has no caller and raises not_a_client');
select pg_temp.as_anon();
select throws_ok($$ select public.create_organization('Anon AG') $$, '42501', null,
  'anon may not execute create_organization');

-- The organization copies the caller's stored language (spec 0004 AC-9)
select pg_temp.as_postgres();
select pg_temp.make_user('d0000000-0000-4000-8000-000000000003', 'newcomer3@test.local', 'client', '{"locale":"de"}');
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000003', 'client');
create temp table created_en as select public.create_organization('Deutsche GmbH') as id;
select pg_temp.as_postgres();
select is((select o.locale from public.organizations o join created_en c on c.id = o.id), 'de',
  'a caller whose profile says de creates a German organization');

-- Name check
select pg_temp.as_postgres();
select pg_temp.make_user('d0000000-0000-4000-8000-000000000002', 'newcomer2@test.local', 'client');
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000002', 'client');
select throws_ok($$ select public.create_organization('') $$, '23514', null,
  'an empty name violates the check constraint');

select * from finish();
rollback;
