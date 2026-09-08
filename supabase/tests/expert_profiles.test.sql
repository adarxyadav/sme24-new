-- expert_profiles: an expert reads and updates only their own row and only the granted columns;
-- ops read and write every row; a client sees none of the table at all. status and photo_path
-- move only through their definer functions, and the state machine in set_expert_status admits
-- exactly the transitions of spec 0013, from exactly the callers allowed to make them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- The suite assumes a database freshly reset (`pnpm db:reset`): it inserts fixtures with fixed
-- keys and counts rows globally. Fail with a clear message rather than a bad plan when a probe
-- left rows behind. The seeded expert@example.com row is expected and skipped by id.
do $$
begin
  if exists (select 1 from public.expert_profiles
             where expert_id <> '22222222-2222-4222-8222-222222222222') then
    raise exception 'this database holds expert profiles beyond the seed; run `pnpm db:reset` before the tests';
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
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert-x@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'expert-y@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- Two experts: X has onboarded, Y is still invited. The invite path writes these rows with the
-- service client, which is what the fixture stands in for.
insert into public.expert_profiles (expert_id, email, status, headline, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'expert-x@test.local', 'active', 'Safety engineer', now()),
  ('e0000000-0000-4000-8000-000000000002', 'expert-y@test.local', 'invited', null, null);

-- Who reads what -----------------------------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select results_eq(
  $$ select expert_id from public.expert_profiles $$,
  $$ values ('e0000000-0000-4000-8000-000000000001'::uuid) $$,
  'an expert reads their own row and no other');

select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.expert_profiles), 0::bigint,
  'a client reads no row of the table, not even of an expert assigned to them later');

-- anon holds no grant on the table at all, so it is refused before RLS is even consulted. That
-- is stronger than the zero rows a policy would give, and it is what the by hand revoke buys.
select pg_temp.as_anon();
select throws_ok(
  $$ select count(*) from public.expert_profiles $$,
  '42501', null, 'an anonymous visitor is refused the table outright');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.expert_profiles), 3::bigint,
  'ops read every row: the two fixtures and the seeded expert');

-- The granted columns ------------------------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select lives_ok(
  $$ update public.expert_profiles set headline = 'Safety engineer, machinery',
       competencies = array['compliance'], regions = array['ZH'], languages = array['de']
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  'an expert updates the granted columns of their own row');
select is((select headline from public.expert_profiles where expert_id = 'e0000000-0000-4000-8000-000000000001'),
  'Safety engineer, machinery', 'and the value is stored');

select throws_ok(
  $$ update public.expert_profiles set status = 'inactive' where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'an expert cannot write status directly: it is outside the column grant');
select throws_ok(
  $$ update public.expert_profiles set photo_path = 'e0000000-0000-4000-8000-000000000001/photo.jpg'
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor photo_path');
select throws_ok(
  $$ update public.expert_profiles set email = 'someone-else@test.local' where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor the email the invite recorded');
select throws_ok(
  $$ update public.expert_profiles set onboarded_at = null where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor the onboarding stamp');

select is(pg_temp.affected(
  $$ update public.expert_profiles set headline = 'Not mine' where expert_id = 'e0000000-0000-4000-8000-000000000002' $$),
  0::bigint, 'an expert updating another expert''s row touches zero rows');

select throws_ok(
  $$ insert into public.expert_profiles (expert_id, email) values ('e0000000-0000-4000-8000-000000000001', 'dup@test.local') $$,
  '42501', null, 'an expert cannot insert a profile row');
select is(pg_temp.affected(
  $$ delete from public.expert_profiles where expert_id = 'e0000000-0000-4000-8000-000000000001' $$),
  0::bigint, 'and cannot delete their own row (no delete policy)');

-- Ops write the same granted columns through their own policy, sharing the one grant.
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ update public.expert_profiles set availability = 'limited', years_experience = 20
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  'ops update the granted columns of any expert');
select throws_ok(
  $$ update public.expert_profiles set status = 'inactive' where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'but ops cannot write status directly either: the function is the only path');

-- The catalogue check constraints ---------------------------------------------------------------
select throws_ok(
  $$ update public.expert_profiles set competencies = array['compliance', 'not_a_competency']
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a competency outside the catalogue is rejected');
select throws_ok(
  $$ update public.expert_profiles set industries = array['A', 'ZZ']
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an industry outside the NOGA sections is rejected');
select throws_ok(
  $$ update public.expert_profiles set standards = array['ohsas_18001']
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a standard outside the catalogue is rejected');
select throws_ok(
  $$ update public.expert_profiles set languages = array['rm'] where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a language outside the catalogue is rejected');
select throws_ok(
  $$ update public.expert_profiles set regions = array['ZH', 'XX'] where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a canton outside the 26 is rejected');
select throws_ok(
  $$ update public.expert_profiles set availability = 'maybe' where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an availability outside the three values is rejected');

-- set_expert_status: the state machine -------------------------------------------------------
-- The expert's one move is finishing their own onboarding.
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select lives_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000002', 'active') $$,
  'the invited expert activates their own row through onboarding');
select isnt((select onboarded_at from public.expert_profiles where expert_id = 'e0000000-0000-4000-8000-000000000002'),
  null, 'and onboarded_at is stamped');
select lives_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000002', 'active') $$,
  'a second submit is a no op rather than an error');
select throws_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000002', 'inactive') $$,
  'invalid_transition', 'an expert cannot deactivate themselves');
select throws_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'inactive') $$,
  'forbidden', 'and cannot touch another expert''s status at all');

-- Ops run the rest of the machine.
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select throws_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'invited') $$,
  'invalid_transition', 'active never goes back to invited');
select lives_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'inactive') $$,
  'ops deactivate an active expert');
select isnt((select deactivated_at from public.expert_profiles where expert_id = 'e0000000-0000-4000-8000-000000000001'),
  null, 'and deactivated_at is stamped');
select lives_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'active') $$,
  'ops reactivate an expert who had onboarded');
select is((select deactivated_at from public.expert_profiles where expert_id = 'e0000000-0000-4000-8000-000000000001'),
  null, 'and the deactivation stamp is cleared');
select throws_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'invited') $$,
  'invalid_transition', 'an onboarded expert cannot be sent back to invited');

-- An expert deactivated before onboarding goes back to invited, not to active.
select pg_temp.as_postgres();
select pg_temp.make_user('e0000000-0000-4000-8000-000000000003', 'never-onboarded@test.local', 'expert');
insert into public.expert_profiles (expert_id, email, status) values
  ('e0000000-0000-4000-8000-000000000003', 'never-onboarded@test.local', 'invited');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000003', 'inactive') $$,
  'ops deactivate an expert who never onboarded');
select throws_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000003', 'active') $$,
  'invalid_transition', 'and cannot activate them directly: they never onboarded');
select lives_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000003', 'invited') $$,
  'they go back to invited instead');

select throws_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'retired') $$,
  'invalid_transition', 'a status outside the three is refused before anything is read');

-- A client cannot reach the function at all.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'inactive') $$,
  'forbidden', 'a client cannot move an expert''s status');

-- set_expert_photo -----------------------------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select lives_ok(
  $$ select public.set_expert_photo('e0000000-0000-4000-8000-000000000001/photo.jpg') $$,
  'an expert records their own photo path');
select throws_ok(
  $$ select public.set_expert_photo('e0000000-0000-4000-8000-000000000002/photo.jpg') $$,
  'invalid_path', 'and cannot point the path at another expert''s folder');
select throws_ok(
  $$ select public.set_expert_photo('e0000000-0000-4000-8000-000000000001/../secret.jpg') $$,
  'invalid_path', 'nor walk out of it');
select lives_ok(
  $$ select public.set_expert_photo(null) $$, 'and clears it again with null');

-- Audit ------------------------------------------------------------------------------------------
-- The whole point of auditing this table: expert_id is the key, so row_id has to come from it.
select pg_temp.as_postgres();
select is(
  (select count(*) from public.audit_log
   where table_name = 'expert_profiles' and row_id = 'e0000000-0000-4000-8000-000000000001'::text),
  (select count(*) from public.audit_log
   where table_name = 'expert_profiles' and row_id = 'e0000000-0000-4000-8000-000000000001'::text and row_id is not null),
  'every expert_profiles audit row carries the expert id as row_id, never null');
select cmp_ok(
  (select count(*) from public.audit_log where table_name = 'expert_profiles'), '>', 0::bigint,
  'writes to expert_profiles are audited');

select * from finish();
rollback;
