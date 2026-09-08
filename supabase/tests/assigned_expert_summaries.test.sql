-- assigned_expert_summaries: the one definer view in public (spec 0013). It bypasses the RLS that
-- hides expert_profiles from a client, so its where clause is the entire access boundary and every
-- rule in it is proved here: a client sees an expert only while an active assignment to their own
-- organization exists, and only the public half of the profile.
--
-- The owner assertion matters as much as the rows: a definer view runs with its owner's rights, so
-- a future migration that recreated it under a different owner would silently change who it can
-- read as. Postgres is the expected owner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert-x@test.local', 'expert',
  '{"full_name":"Xenia Expert"}');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'expert-y@test.local', 'expert',
  '{"full_name":"Yves Expert"}');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');

insert into public.expert_profiles (
  expert_id, email, status, headline, bio, competencies, industries, standards, languages,
  regions, availability, phone, years_experience, onboarded_at
) values
  ('e0000000-0000-4000-8000-000000000001', 'expert-x@test.local', 'active', 'Safety engineer',
   'Fifteen years in manufacturing.', array['compliance'], array['C'], array['iso_45001'],
   array['de'], array['ZH'], 'available', '+41 44 000 00 00', 15, now()),
  ('e0000000-0000-4000-8000-000000000002', 'expert-y@test.local', 'active', 'Culture specialist',
   'Safety culture programmes.', array['safety_culture'], array['F'], array['iso_31000'],
   array['fr'], array['VD'], 'limited', '+41 21 000 00 00', 9, now());

-- The owner of the definer view --------------------------------------------------------------
select is(
  (select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'assigned_expert_summaries'),
  'postgres'::name,
  'the view is owned by postgres, so its definer rights are the ones it was written for');

-- Before any assignment --------------------------------------------------------------------
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assigned_expert_summaries), 0::bigint,
  'a client with no assigned expert sees no row');

-- Ops assign X to organization A -------------------------------------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
insert into public.expert_assignments (id, organization_id, expert_id, assigned_by) values
  ('0e000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000',
   'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');

select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq(
  $$ select expert_id, full_name, headline from public.assigned_expert_summaries $$,
  $$ values ('e0000000-0000-4000-8000-000000000001'::uuid, 'Xenia Expert', 'Safety engineer') $$,
  'the client sees the expert assigned to them, by name and headline');
select is((select count(*) from public.expert_profiles), 0::bigint,
  'while the underlying table still shows them nothing: the view is the only way in');

-- The private half of the profile is not in the view at all.
select hasnt_column('public', 'assigned_expert_summaries', 'phone',
  'the view carries no phone number');
select hasnt_column('public', 'assigned_expert_summaries', 'availability',
  'nor the availability');
select hasnt_column('public', 'assigned_expert_summaries', 'years_experience',
  'nor the years of experience');
select hasnt_column('public', 'assigned_expert_summaries', 'email',
  'nor the email address');

-- The other tenant ------------------------------------------------------------------------------
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assigned_expert_summaries), 0::bigint,
  'a client of another organization sees nothing of that assignment');

-- The expert sees their own summary row (the ops page and their own profile read it).
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.assigned_expert_summaries), 1::bigint,
  'the expert sees their own summary row');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is((select count(*) from public.assigned_expert_summaries), 0::bigint,
  'another expert sees nothing of it');

-- Ending the assignment closes the window ------------------------------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.assigned_expert_summaries), 1::bigint, 'ops see every row');
update public.expert_assignments set status = 'ended' where id = '0e000000-0000-4000-8000-000000000001';

select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assigned_expert_summaries), 0::bigint,
  'the card disappears the moment the assignment is ended');

-- A deactivated expert disappears too, even with the assignment still active ---------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
insert into public.expert_assignments (id, organization_id, expert_id, assigned_by) values
  ('0e000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000',
   'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assigned_expert_summaries), 1::bigint,
  'a new assignment brings the card back');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select public.set_expert_status('e0000000-0000-4000-8000-000000000001', 'inactive');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assigned_expert_summaries), 0::bigint,
  'deactivating the expert hides them even while the assignment row is still active');

select pg_temp.as_anon();
select throws_ok(
  $$ select count(*) from public.assigned_expert_summaries $$,
  '42501', null, 'an anonymous visitor is refused the view outright');

select * from finish();
rollback;
