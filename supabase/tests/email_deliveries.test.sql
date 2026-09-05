-- email_deliveries: ops read every row, no app role writes, only the service key inserts and
-- updates; the idempotency key and the provider id are unique; the table is in the Realtime
-- publication (spec 0006 AC-3, AC-13).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

do $$
begin
  if exists (select 1 from public.email_deliveries) or exists (select 1 from public.notifications) then
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

create function pg_temp.make_user(user_id uuid, email text, app_role text, meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    meta, now(), now());
end $$;

-- Fixtures as postgres: one organization with its owner, an expert, ops, and two deliveries.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

insert into public.email_deliveries (id, idempotency_key, source_event, template, locale, recipient_email, recipient_id, organization_id, status) values
  ('d0000000-0000-4000-8000-000000000001', 'welcome/0a000000-0000-4000-8000-000000000000', 'auth.organization_created', 'welcome', 'de',
   'a-owner@test.local', 'a0000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', 'sent'),
  ('d0000000-0000-4000-8000-000000000002', 'ops.test_email/1', 'ops.test_email', 'welcome', 'en',
   'ops@test.local', 'c0000000-0000-4000-8000-000000000001', null, 'queued');

-- Client (the recipient of the first row): no access at all.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.email_deliveries), 0::bigint, 'a client reads zero deliveries, even their own');
select throws_ok(
  $$ insert into public.email_deliveries (idempotency_key, source_event, template, locale, recipient_email)
     values ('client/1', 'auth.organization_created', 'welcome', 'de', 'a-owner@test.local') $$,
  '42501', null, 'a client cannot insert a delivery (no grant)');
select throws_ok(
  $$ update public.email_deliveries set status = 'failed' where id = 'd0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot update a delivery (no grant)');
select throws_ok(
  $$ delete from public.email_deliveries where id = 'd0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot delete a delivery (no grant)');

-- Expert and anon
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.email_deliveries), 0::bigint, 'an expert reads zero deliveries');
select pg_temp.as_anon();
select is((select count(*) from public.email_deliveries), 0::bigint, 'anon reads zero deliveries');

-- Ops: read everything, write nothing.
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.email_deliveries), 2::bigint, 'ops read every delivery');
select throws_ok(
  $$ insert into public.email_deliveries (idempotency_key, source_event, template, locale, recipient_email)
     values ('ops/1', 'ops.test_email', 'welcome', 'en', 'ops@test.local') $$,
  '42501', null, 'ops cannot insert a delivery (only the service key writes)');
select throws_ok(
  $$ update public.email_deliveries set status = 'sending' where id = 'd0000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'ops cannot update a delivery (the retry goes through the task)');

-- Service role: the task and the webhook.
select pg_temp.as_service_role();
select lives_ok(
  $$ insert into public.email_deliveries (id, idempotency_key, source_event, template, locale, recipient_email)
     values ('d0000000-0000-4000-8000-000000000003', 'raw/1', 'ops.test_email', 'welcome', 'en', 'someone@test.local') $$,
  'the service key inserts a raw address delivery');
select lives_ok(
  $$ update public.email_deliveries set status = 'sending', attempts = attempts + 1, last_run_id = 'run_1'
     where id = 'd0000000-0000-4000-8000-000000000003' $$,
  'the service key moves a row to sending');
select lives_ok(
  $$ update public.email_deliveries set status = 'sent', provider_message_id = 'msg_1', sent_at = now(), transport = 'resend'
     where id = 'd0000000-0000-4000-8000-000000000003' $$,
  'the service key records the provider id');
select throws_ok(
  $$ insert into public.email_deliveries (idempotency_key, source_event, template, locale, recipient_email)
     values ('raw/1', 'ops.test_email', 'welcome', 'en', 'someone@test.local') $$,
  '23505', null, 'a second row with the same idempotency key is refused');
select throws_ok(
  $$ update public.email_deliveries set provider_message_id = 'msg_1' where id = 'd0000000-0000-4000-8000-000000000001' $$,
  '23505', null, 'a provider message id is unique');
select lives_ok(
  $$ update public.email_deliveries set provider_message_id = null where id = 'd0000000-0000-4000-8000-000000000001' $$,
  'many rows may have no provider message id (SMTP rows)');
select throws_ok(
  $$ update public.email_deliveries set status = 'lost' where id = 'd0000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'an unknown status is refused');
select throws_ok(
  $$ update public.email_deliveries set locale = 'fr' where id = 'd0000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'an unknown locale is refused');
select throws_ok(
  $$ update public.email_deliveries set data = '[]'::jsonb where id = 'd0000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'data must be a json object');
select throws_ok(
  $$ update public.email_deliveries set transport = 'pigeon' where id = 'd0000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'an unknown transport is refused');
select cmp_ok(
  (select updated_at from public.email_deliveries where id = 'd0000000-0000-4000-8000-000000000003'),
  '>=',
  (select created_at from public.email_deliveries where id = 'd0000000-0000-4000-8000-000000000003'),
  'updated_at is maintained by the trigger');

-- Structure
select pg_temp.as_postgres();
select is_empty(
  $$ select r from unnest(array['anon', 'authenticated', 'service_role']) r
     where has_table_privilege(r, 'public.email_deliveries', 'TRUNCATE') $$,
  'no app role holds truncate on email_deliveries');
select is_empty(
  $$ select r || ' ' || p from unnest(array['anon', 'authenticated']) r
     cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) p
     where has_table_privilege(r, 'public.email_deliveries', p) $$,
  'anon and authenticated have no insert, update or delete on email_deliveries');
select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'email_deliveries'),
  'email_deliveries is in the Realtime publication');
select fk_ok('public', 'email_deliveries', 'organization_id', 'public', 'organizations', 'id',
  'organization_id references organizations (set null on delete, no cascade)');

select * from finish();
rollback;
