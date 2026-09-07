-- expert_ops_notes: the record check notes ops keep on an expert. The whole reason this is a
-- separate table is that no policy mistake on expert_profiles can ever expose it, so the test
-- that matters most is the one proving the expert themselves reads zero rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

do $$
begin
  if exists (select 1 from public.expert_ops_notes) then
    raise exception 'this database holds ops notes; run `pnpm db:reset` before the tests';
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
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'expert-x@test.local', 'active', now());

-- Ops write ------------------------------------------------------------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.expert_ops_notes (expert_id, notes, updated_by)
     values ('e0000000-0000-4000-8000-000000000001', 'References checked, two calls made.',
             'c0000000-0000-4000-8000-000000000001') $$,
  'ops write a note about an expert');
select is((select count(*) from public.expert_ops_notes), 1::bigint, 'and read it back');
select lives_ok(
  $$ update public.expert_ops_notes set notes = 'Second reference confirmed.'
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  'and edit it');
select throws_ok(
  $$ update public.expert_ops_notes set notes = repeat('x', 4001)
     where expert_id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a note longer than 4000 characters is rejected');

-- The expert never sees it ---------------------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.expert_ops_notes), 0::bigint,
  'the expert the note is about reads zero rows');
select is(pg_temp.affected(
  $$ update public.expert_ops_notes set notes = 'Nothing to see' where expert_id = 'e0000000-0000-4000-8000-000000000001' $$),
  0::bigint, 'and cannot edit it');
select is(pg_temp.affected(
  $$ delete from public.expert_ops_notes where expert_id = 'e0000000-0000-4000-8000-000000000001' $$),
  0::bigint, 'and cannot delete it');
select throws_ok(
  $$ insert into public.expert_ops_notes (expert_id, notes) values ('e0000000-0000-4000-8000-000000000001', 'Mine now') $$,
  '42501', null, 'and cannot write one about themselves');

select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.expert_ops_notes), 0::bigint, 'a client reads zero rows');

select pg_temp.as_anon();
select throws_ok(
  $$ select count(*) from public.expert_ops_notes $$,
  '42501', null, 'an anonymous visitor is refused the table outright');

-- Audit: the notes are keyed on expert_id, the other half of the row_id fallback.
select pg_temp.as_postgres();
select is(
  (select count(*) from public.audit_log
   where table_name = 'expert_ops_notes' and row_id = 'e0000000-0000-4000-8000-000000000001'::text),
  2::bigint, 'the insert and the edit are each audited against the expert id');

select * from finish();
rollback;
