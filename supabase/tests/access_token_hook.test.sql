-- custom_access_token_hook: app_metadata.role always, app_metadata.organization_id only for a
-- user with a current organization (spec 0002 AC-2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

create function pg_temp.hook(user_id uuid, incoming jsonb default '{"role":"authenticated","app_metadata":{"provider":"email"}}')
returns jsonb language sql as $$
  select public.custom_access_token_hook(jsonb_build_object('user_id', user_id, 'claims', incoming)) -> 'claims';
$$;

select is(pg_temp.hook('a0000000-0000-4000-8000-000000000001') -> 'app_metadata' ->> 'role', 'client',
  'a client member gets app_metadata.role');
select is(pg_temp.hook('a0000000-0000-4000-8000-000000000001') -> 'app_metadata' ->> 'organization_id',
  '0a000000-0000-4000-8000-000000000000', 'a client member gets app_metadata.organization_id');
select is(pg_temp.hook('a0000000-0000-4000-8000-000000000001') ->> 'role', 'authenticated',
  'the top level role claim stays authenticated');
select is(pg_temp.hook('e0000000-0000-4000-8000-000000000001') -> 'app_metadata' ->> 'role', 'expert',
  'an expert gets app_metadata.role');
select is(pg_temp.hook('e0000000-0000-4000-8000-000000000001') -> 'app_metadata' ? 'organization_id', false,
  'a user without an organization gets no organization_id claim');
select is(
  pg_temp.hook('c0000000-0000-4000-8000-000000000001', '{"role":"authenticated","app_metadata":{"organization_id":"stale"}}') -> 'app_metadata' ? 'organization_id',
  false, 'a stale organization_id in the incoming app_metadata is stripped');
-- The hook owns app_metadata.role and app_metadata.organization_id unconditionally. When no
-- profile row exists it strips both rather than passing the incoming claims through, so a role a
-- user influenced through raw_app_meta_data at sign up cannot reach the token. Unrelated keys
-- (provider) are left alone.
select is(
  pg_temp.hook('ffffffff-ffff-4fff-8fff-ffffffffffff') -> 'app_metadata',
  '{"provider":"email"}'::jsonb, 'an unknown user id keeps its unrelated claims');
select is(
  pg_temp.hook('ffffffff-ffff-4fff-8fff-ffffffffffff',
    '{"role":"authenticated","app_metadata":{"role":"ops","organization_id":"0a000000-0000-4000-8000-000000000000"}}')
    -> 'app_metadata',
  '{}'::jsonb, 'a self supplied role and organization are stripped when there is no profile row');
select is(
  pg_temp.hook('a0000000-0000-4000-8000-000000000001',
    '{"role":"authenticated","app_metadata":{"role":"ops"}}') -> 'app_metadata' ->> 'role',
  'client', 'a self supplied role never overrides the profile role');

select * from finish();
rollback;
