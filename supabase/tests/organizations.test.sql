-- organizations: members see only their own organization, owners rename it and set its language,
-- nobody inserts directly, ops see everything (spec 0002 AC-3, AC-4; spec 0004 AC-9).
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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

-- Fixtures as postgres: two organizations, an owner and a member of A, an owner of B, an expert, ops.
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

-- Owner of A
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq(
  $$ select id from public.organizations order by id $$,
  $$ values ('0a000000-0000-4000-8000-000000000000'::uuid) $$,
  'owner of A reads exactly organization A');
select is((select count(*) from public.organizations where id = '0b000000-0000-4000-8000-000000000000'), 0::bigint,
  'owner of A reads zero rows of organization B');
select lives_ok(
  $$ update public.organizations set name = 'Org A renamed' where id = '0a000000-0000-4000-8000-000000000000' $$,
  'owner of A renames organization A');
select is((select name from public.organizations where id = '0a000000-0000-4000-8000-000000000000'), 'Org A renamed',
  'the rename is visible to the owner');
select is(
  pg_temp.affected($$ update public.organizations set name = 'B hijacked' where id = '0b000000-0000-4000-8000-000000000000' $$),
  0::bigint, 'owner of A cannot update organization B (zero rows)');
select throws_ok(
  $$ insert into public.organizations (name) values ('Direct insert') $$,
  '42501', null, 'members cannot insert an organization directly (create_organization is the only path)');
select lives_ok(
  $$ update public.organizations set locale = 'en' where id = '0a000000-0000-4000-8000-000000000000' $$,
  'owner of A sets the organization language (spec 0004 AC-9)');
select is((select locale from public.organizations where id = '0a000000-0000-4000-8000-000000000000'), 'en',
  'the language change is visible to the owner');
select throws_ok(
  $$ update public.organizations set archived_at = now() where id = '0a000000-0000-4000-8000-000000000000' $$,
  '23514', null, 'owner of A still cannot archive the organization (archived_at stays pinned)');

-- Member (not owner) of A
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.organizations), 1::bigint, 'member of A reads organization A');
select is(
  pg_temp.affected($$ update public.organizations set name = 'Member rename' where id = '0a000000-0000-4000-8000-000000000000' $$),
  0::bigint, 'a plain member cannot rename the organization (zero rows)');
select is(
  pg_temp.affected($$ update public.organizations set locale = 'de' where id = '0a000000-0000-4000-8000-000000000000' $$),
  0::bigint, 'a plain member cannot change the organization language either (zero rows)');

-- Expert without an assignment, anon
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.organizations), 0::bigint, 'an expert without an assignment reads no organization');
select pg_temp.as_anon();
select is((select count(*) from public.organizations), 0::bigint, 'anon reads no organization');

-- Ops
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.organizations where id in ('0a000000-0000-4000-8000-000000000000', '0b000000-0000-4000-8000-000000000000')), 2::bigint,
  'ops read both organizations');
select lives_ok(
  $$ update public.organizations set archived_at = now() where id = '0b000000-0000-4000-8000-000000000000' $$,
  'ops update organization B');
select throws_ok(
  $$ update public.organizations set locale = 'fr' where id = '0b000000-0000-4000-8000-000000000000' $$,
  '23514', null, 'an unknown language is refused by the check constraint');
select pg_temp.as_postgres();
select isnt((select archived_at from public.organizations where id = '0b000000-0000-4000-8000-000000000000'), null,
  'the ops update landed');

select * from finish();
rollback;
