-- notifications: a recipient reads their own rows and may set read_at and nothing else; nobody
-- inserts or deletes through the API; ops read no one else's feed; only the service key writes
-- (spec 0006 AC-3, AC-13).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Unlike the tenant suites this file needs no empty table: every assertion is keyed on its own
-- fixture ids, so rows the local app left behind (a welcome email from a sign up) do not matter.

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

-- Fixtures as postgres: two clients in one organization, ops, one delivery, one notification each.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000002', 'a-member@test.local', 'client');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'member');

insert into public.email_deliveries (id, idempotency_key, source_event, template, locale, recipient_email, recipient_id, organization_id) values
  ('d0000000-0000-4000-8000-000000000001', 'welcome/0a000000-0000-4000-8000-000000000000', 'auth.organization_created', 'welcome', 'de',
   'a-owner@test.local', 'a0000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000');
insert into public.notifications (id, recipient_id, organization_id, kind, data, link, delivery_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000',
   'welcome', '{"organizationName":"Org A"}', '/app', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000',
   'welcome', '{"organizationName":"Org A"}', '/app', null);

-- The owner: own rows only, read_at only.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq(
  $$ select id from public.notifications order by id $$,
  $$ values ('e0000000-0000-4000-8000-000000000001'::uuid) $$,
  'a recipient reads exactly their own notifications');
select is((select count(*) from public.notifications where recipient_id = 'a0000000-0000-4000-8000-000000000002'), 0::bigint,
  'a colleague''s notification in the same organization is invisible');
select lives_ok(
  $$ update public.notifications set read_at = now() where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'a recipient marks their own notification read');
select ok((select read_at from public.notifications where id = 'e0000000-0000-4000-8000-000000000001') is not null,
  'the read mark is visible to the recipient');
select throws_ok(
  $$ update public.notifications set kind = 'other' where id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a recipient cannot change kind (column grant)');
select throws_ok(
  $$ update public.notifications set data = '{}'::jsonb where id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a recipient cannot change data (column grant)');
select throws_ok(
  $$ update public.notifications set recipient_id = 'a0000000-0000-4000-8000-000000000002' where id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a recipient cannot hand a notification to someone else (column grant)');
select throws_ok(
  $$ insert into public.notifications (recipient_id, kind) values ('a0000000-0000-4000-8000-000000000001', 'welcome') $$,
  '42501', null, 'a recipient cannot insert a notification, not even for themselves');
select throws_ok(
  $$ delete from public.notifications where id = 'e0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a recipient cannot delete a notification');
select is(
  pg_temp.affected($$ update public.notifications set read_at = now() where id = 'e0000000-0000-4000-8000-000000000002' $$),
  0::bigint, 'marking a colleague''s notification read touches zero rows');

-- Ops and anon read nobody's feed.
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.notifications), 0::bigint, 'ops read no other user''s notifications');
select pg_temp.as_anon();
select is((select count(*) from public.notifications), 0::bigint, 'anon reads no notification');

-- Service role: the task writes the feed.
select pg_temp.as_service_role();
select lives_ok(
  $$ insert into public.notifications (recipient_id, organization_id, kind, data, link)
     values ('a0000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', 'welcome', '{}', '/app') $$,
  'the service key inserts a notification');
select throws_ok(
  $$ insert into public.notifications (recipient_id, kind, link) values ('a0000000-0000-4000-8000-000000000002', 'welcome', 'app') $$,
  '23514', null, 'a link must be a bare app path starting with a slash');
select throws_ok(
  $$ insert into public.notifications (recipient_id, kind, data) values ('a0000000-0000-4000-8000-000000000002', 'welcome', '[]') $$,
  '23514', null, 'data must be a json object');

-- References: the delivery may go, the recipient takes the feed with them.
select pg_temp.as_postgres();
delete from public.email_deliveries where id = 'd0000000-0000-4000-8000-000000000001';
select ok((select delivery_id from public.notifications where id = 'e0000000-0000-4000-8000-000000000001') is null,
  'deleting the delivery leaves the notification with a null delivery_id');
delete from public.profiles where id = 'a0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.notifications where recipient_id = 'a0000000-0000-4000-8000-000000000002'), 0::bigint,
  'deleting the recipient deletes their notifications');

-- Structure
select is_empty(
  $$ select r from unnest(array['anon', 'authenticated', 'service_role']) r
     where has_table_privilege(r, 'public.notifications', 'TRUNCATE') $$,
  'no app role holds truncate on notifications');
select is_empty(
  $$ select r || ' ' || p from unnest(array['anon', 'authenticated']) r
     cross join unnest(array['INSERT', 'DELETE', 'UPDATE']) p
     where has_table_privilege(r, 'public.notifications', p) $$,
  'anon and authenticated have no table level insert, delete or update on notifications');

select * from finish();
rollback;
