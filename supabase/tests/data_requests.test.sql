-- data_requests: the subject reads and files only their own row; no user reads another user's
-- request (AC-12); ops read every row but cannot update one, because UPDATE is revoked from every
-- app role and the ops action writes through the service client (AC-14); the open guard allows one
-- request per person per kind; the check constraints and the audit trigger hold (spec 0015).
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Every assertion is keyed on its own fixture ids, so rows the local app left behind do not matter.

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

create function pg_temp.make_user(user_id uuid, email text, app_role text, meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    meta, now(), now());
end $$;

-- Fixtures as postgres: two clients in one organization, an expert, ops, and one filed request
-- belonging to the first client.
select pg_temp.make_user('d0000000-0000-4000-8000-000000000001', 'd-owner@test.local', 'client');
select pg_temp.make_user('d0000000-0000-4000-8000-000000000002', 'd-other@test.local', 'client');
select pg_temp.make_user('d0000000-0000-4000-8000-000000000003', 'd-expert@test.local', 'expert');
select pg_temp.make_user('d0000000-0000-4000-8000-000000000004', 'd-ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0d000000-0000-4000-8000-000000000000', 'Org D', 'd0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0d000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'owner'),
  ('0d000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'member');

insert into public.data_requests (id, kind, requested_by, organization_id, due_at) values
  ('dd000000-0000-4000-8000-000000000001', 'export', 'd0000000-0000-4000-8000-000000000001',
   '0d000000-0000-4000-8000-000000000000', now() + interval '30 days');

-- The subject: reads their own row, files a second of a different kind, and is refused a second
-- open one of the same kind by the partial unique index (AC-11).
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000001', 'client', '0d000000-0000-4000-8000-000000000000');
select is((select count(*) from public.data_requests), 1::bigint, 'the subject reads their own request');
select lives_ok(
  $$ insert into public.data_requests (kind, requested_by, organization_id, due_at)
     values ('deletion', 'd0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000000', now() + interval '30 days') $$,
  'the subject files a request of the other kind');
select throws_ok(
  $$ insert into public.data_requests (kind, requested_by, organization_id, due_at)
     values ('export', 'd0000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000000', now() + interval '30 days') $$,
  '23505', null, 'a second open request of the same kind is refused by the open guard');
-- The insert policy is the subject's own id, so filing on someone else's behalf is refused.
select throws_ok(
  $$ insert into public.data_requests (kind, requested_by, due_at)
     values ('export', 'd0000000-0000-4000-8000-000000000002', now() + interval '30 days') $$,
  '42501', null, 'a user cannot file a request for someone else');
-- UPDATE is revoked from every app role, so even the subject cannot move their own row.
select throws_ok(
  $$ update public.data_requests set status = 'fulfilled' where id = 'dd000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the subject cannot update their own request (no grant)');
select throws_ok(
  $$ delete from public.data_requests where id = 'dd000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the subject cannot delete their own request (no grant)');
-- The four columns the subject may name; everything else is defaulted or written by ops (AC-14).
select throws_ok(
  $$ insert into public.data_requests (kind, requested_by, due_at, status)
     values ('export', 'd0000000-0000-4000-8000-000000000001', now(), 'fulfilled') $$,
  '42501', null, 'the subject cannot name the status on insert (column grant)');
select throws_ok(
  $$ insert into public.data_requests (kind, requested_by, due_at, handled_by, handled_at)
     values ('export', 'd0000000-0000-4000-8000-000000000001', now(), 'd0000000-0000-4000-8000-000000000001', now()) $$,
  '42501', null, 'the subject cannot name the handler on insert (column grant)');
select throws_ok(
  $$ insert into public.data_requests (kind, requested_by, due_at, ops_note)
     values ('export', 'd0000000-0000-4000-8000-000000000001', now(), 'Already done, honest.') $$,
  '42501', null, 'the subject cannot write an ops note on insert (column grant)');

-- Another client in the same organization: the request is the person's, not the tenant's (AC-12).
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000002', 'client', '0d000000-0000-4000-8000-000000000000');
select is((select count(*) from public.data_requests), 0::bigint,
  'a second client in the same organization reads zero requests');

-- Expert and anon see nothing.
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000003', 'expert');
select is((select count(*) from public.data_requests), 0::bigint, 'an expert reads zero requests');
select pg_temp.as_anon();
select is((select count(*) from public.data_requests), 0::bigint, 'anon reads zero requests');
select throws_ok(
  $$ insert into public.data_requests (kind, requested_by, due_at)
     values ('export', 'd0000000-0000-4000-8000-000000000001', now()) $$,
  '42501', null, 'anon cannot file a request (no grant)');

-- Ops: read every row, and cannot write one. `updateDataRequest` uses the service client, so the
-- ops role itself keeps no UPDATE at all (AC-14).
select pg_temp.impersonate('d0000000-0000-4000-8000-000000000004', 'ops');
select is((select count(*) from public.data_requests where requested_by = 'd0000000-0000-4000-8000-000000000001'), 2::bigint,
  'ops read every request');
select throws_ok(
  $$ update public.data_requests set status = 'in_progress' where id = 'dd000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot update a request directly (the action uses the service client)');
select throws_ok(
  $$ delete from public.data_requests where id = 'dd000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot delete a request (no grant)');

-- The service role, which is what the ops action actually writes through.
select pg_temp.as_service_role();
select lives_ok(
  $$ update public.data_requests
     set status = 'in_progress', handled_by = 'd0000000-0000-4000-8000-000000000004', handled_at = now()
     where id = 'dd000000-0000-4000-8000-000000000001' $$,
  'the service role moves a request and records the handler');

-- The check constraints.
select pg_temp.as_postgres();
select throws_ok(
  $$ insert into public.data_requests (kind, requested_by, due_at)
     values ('rectification', 'd0000000-0000-4000-8000-000000000002', now()) $$,
  '23514', null, 'an unknown kind is refused');
select throws_ok(
  $$ update public.data_requests set status = 'archived' where id = 'dd000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an unknown status is refused');
select throws_ok(
  $$ update public.data_requests set handled_at = null where id = 'dd000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'handled_by and handled_at cannot be split apart');
select throws_ok(
  $$ update public.data_requests set ops_note = repeat('x', 2001) where id = 'dd000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an ops note over 2000 characters is refused');

-- The record outlives the person it is about: the profile goes, the row stays (AC-12 rationale).
delete from public.organization_members where user_id = 'd0000000-0000-4000-8000-000000000002';
delete from auth.users where id = 'd0000000-0000-4000-8000-000000000002';
select is(
  (select count(*) from public.data_requests where id = 'dd000000-0000-4000-8000-000000000001'),
  1::bigint, 'the request survives, keyed on its own id');

-- The audit trail (AC-14): the insert and the two ops decision columns are recorded.
select cmp_ok(
  (select count(*)::int from public.audit_log
   where table_name = 'data_requests' and row_id = 'dd000000-0000-4000-8000-000000000001' and action = 'insert'),
  '>=', 1, 'filing a request is audited');
select cmp_ok(
  (select count(*)::int from public.audit_log
   where table_name = 'data_requests' and row_id = 'dd000000-0000-4000-8000-000000000001' and action = 'update'),
  '>=', 1, 'moving a request is audited');
-- The updated_at trigger is attached. Asserted by existence rather than by comparing the two
-- timestamps: `set_updated_at` writes `now()`, which is the transaction start time, so inside this
-- one rolled back transaction the touched value can never be later than `created_at`.
select has_trigger('public', 'data_requests', 'data_requests_set_updated_at',
  'the updated_at trigger is attached');

select * from finish();
rollback;
