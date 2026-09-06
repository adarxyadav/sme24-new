-- enquiries: anon, clients and experts see nothing; ops read every row and update only the four
-- workflow columns; only the service key inserts and deletes; the check constraints hold; the
-- audit trigger records ops decisions and not the purge (spec 0009 AC-11).
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- Every assertion is keyed on its own fixture ids, so rows the local app left behind (a real
-- enquiry from the contact page) do not matter.

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

-- Fixtures as postgres: one organization with its owner, an expert assigned to it, ops, and two
-- enquiries (one anonymous, one from the owner).
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');
insert into public.expert_assignments (organization_id, expert_id, status) values
  ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'active');

insert into public.enquiries (id, topic, company_name, contact_name, email, message, locale, ip_hash, organization_id, submitted_by) values
  ('e1000000-0000-4000-8000-000000000001', 'retainer', 'Anon AG', 'Anna Anon', 'anna@test.local',
   'We are looking for an ongoing EHS partner for two sites.', 'de',
   repeat('a', 64), null, null),
  ('e1000000-0000-4000-8000-000000000002', 'general', 'Org A', 'Owner A', 'a-owner@test.local',
   'How is the assessment date agreed after payment?', 'en',
   repeat('b', 64), '0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001');

-- Client (the owner behind the second row): no access at all, not even to their own enquiry.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.enquiries), 0::bigint, 'a client reads zero enquiries, even their own');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', 'Org A', 'Owner A', 'a-owner@test.local', 'A message of twenty characters.', 'en') $$,
  '42501', null, 'a client cannot insert an enquiry (no grant)');
-- The workflow column grant is role wide, so a client's update is filtered to zero rows by RLS.
with attempt as (
  update public.enquiries set status = 'closed'
  where id = 'e1000000-0000-4000-8000-000000000002' returning id)
select is((select count(*) from attempt), 0::bigint, 'a client cannot update an enquiry (zero rows)');
select throws_ok(
  $$ delete from public.enquiries where id = 'e1000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'a client cannot delete an enquiry (no grant)');

-- Assigned expert and anon
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.enquiries), 0::bigint, 'an assigned expert reads zero enquiries');
select pg_temp.as_anon();
select is((select count(*) from public.enquiries), 0::bigint, 'anon reads zero enquiries');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', 'Bot', 'Bot', 'bot@test.local', 'A message of twenty characters.', 'en') $$,
  '42501', null, 'anon cannot insert an enquiry (the action inserts with the service key)');

-- Ops: read everything, change the four workflow columns and nothing else.
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.enquiries where id in ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002')), 2::bigint,
  'ops read every enquiry');
select lives_ok(
  $$ update public.enquiries
     set status = 'contacted', handled_by = 'c0000000-0000-4000-8000-000000000001', handled_at = now(), ops_note = 'Called on Monday.'
     where id = 'e1000000-0000-4000-8000-000000000001' $$,
  'ops set the status, the handler and the note');
select throws_ok(
  $$ update public.enquiries set message = 'rewritten' where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot change the message (column grant)');
select throws_ok(
  $$ update public.enquiries set email = 'other@test.local' where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot change the email (column grant)');
select throws_ok(
  $$ update public.enquiries set ip_hash = null where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot clear the address hash (the purge does)');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', 'Ops', 'Ops', 'ops@test.local', 'A message of twenty characters.', 'en') $$,
  '42501', null, 'ops cannot insert an enquiry (only the service key writes)');
select throws_ok(
  $$ delete from public.enquiries where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot delete an enquiry (only the purge does)');
select throws_ok(
  $$ update public.enquiries set status = 'archived' where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an unknown status is refused');
select throws_ok(
  $$ update public.enquiries set ops_note = repeat('x', 2001) where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a note over 2000 characters is refused');

-- The audit trail: the ops status change wrote an update row with the changed columns
-- (updated_at stays put inside one transaction, where now() is fixed).
select pg_temp.as_postgres();
select results_eq(
  $$ select actor_id, actor_role, organization_id, action, changed_columns
     from public.audit_log
     where table_name = 'enquiries' and row_id = 'e1000000-0000-4000-8000-000000000001' and action = 'update' $$,
  $$ values ('c0000000-0000-4000-8000-000000000001'::uuid, 'ops', null::uuid, 'update',
             array['handled_at', 'handled_by', 'ops_note', 'status']) $$,
  'the ops status change is audited with the actor and the changed columns');

-- Service role: the action inserts, the purge nulls the hash and deletes.
select pg_temp.as_service_role();
select lives_ok(
  $$ insert into public.enquiries (id, topic, company_name, contact_name, email, phone, headcount_band, message, locale, ip_hash)
     values ('e1000000-0000-4000-8000-000000000003', 'general', 'Service AG', 'Sam Service', 'sam@test.local', '+41 44 000 00 00', '50-249',
             'A question about the safety culture assessment.', 'de', repeat('c', 64)) $$,
  'the service key inserts an enquiry');
select is(
  (select status from public.enquiries where id = 'e1000000-0000-4000-8000-000000000003'),
  'new', 'a new enquiry starts as new');
select is(
  (select count(*) from public.audit_log where table_name = 'enquiries' and row_id = 'e1000000-0000-4000-8000-000000000003' and action = 'insert' and actor_role = 'service' and organization_id is null),
  1::bigint, 'the insert is audited as the service actor without an organization');
select lives_ok(
  $$ update public.enquiries set ip_hash = null where id = 'e1000000-0000-4000-8000-000000000003' $$,
  'the service key nulls the address hash (the purge)');
select is(
  (select count(*) from public.audit_log where table_name = 'enquiries' and row_id = 'e1000000-0000-4000-8000-000000000003' and action = 'update'),
  0::bigint, 'the address hash null out is not audited');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('sales', 'X AG', 'X', 'x@test.local', 'A message of twenty characters.', 'en') $$,
  '23514', null, 'an unknown topic is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', 'X AG', 'X', 'Upper@test.local', 'A message of twenty characters.', 'en') $$,
  '23514', null, 'an email that is not lowercased is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', 'X AG', 'X', 'x@test.local', 'Too short.', 'en') $$,
  '23514', null, 'a message under 20 characters is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', 'X AG', 'X', 'x@test.local', repeat('m', 2001), 'en') $$,
  '23514', null, 'a message over 2000 characters is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', '', 'X', 'x@test.local', 'A message of twenty characters.', 'en') $$,
  '23514', null, 'an empty company name is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale)
     values ('general', 'X AG', 'X', 'x@test.local', 'A message of twenty characters.', 'fr') $$,
  '23514', null, 'an unknown locale is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale, ip_hash)
     values ('general', 'X AG', 'X', 'x@test.local', 'A message of twenty characters.', 'en', 'abc') $$,
  '23514', null, 'an address hash that is not 64 characters is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale, headcount_band)
     values ('general', 'X AG', 'X', 'x@test.local', 'A message of twenty characters.', 'en', '10-20') $$,
  '23514', null, 'an unknown headcount band is refused');
select throws_ok(
  $$ insert into public.enquiries (topic, company_name, contact_name, email, message, locale, phone)
     values ('general', 'X AG', 'X', 'x@test.local', 'A message of twenty characters.', 'en', repeat('1', 41)) $$,
  '23514', null, 'a phone over 40 characters is refused');
select lives_ok(
  $$ delete from public.enquiries where id = 'e1000000-0000-4000-8000-000000000003' $$,
  'the service key deletes an enquiry (the purge)');
select cmp_ok(
  (select updated_at from public.enquiries where id = 'e1000000-0000-4000-8000-000000000001'),
  '>=',
  (select created_at from public.enquiries where id = 'e1000000-0000-4000-8000-000000000001'),
  'updated_at is maintained by the trigger');

-- Structure
select pg_temp.as_postgres();
select is_empty(
  $$ select r from unnest(array['anon', 'authenticated', 'service_role']) r
     where has_table_privilege(r, 'public.enquiries', 'TRUNCATE') $$,
  'no app role holds truncate on enquiries');
select is_empty(
  $$ select r || ' ' || p from unnest(array['anon', 'authenticated']) r
     cross join unnest(array['INSERT', 'DELETE']) p
     where has_table_privilege(r, 'public.enquiries', p) $$,
  'anon and authenticated have no insert or delete on enquiries');
select fk_ok('public', 'enquiries', 'organization_id', 'public', 'organizations', 'id',
  'organization_id references organizations (set null on delete, no cascade)');

select * from finish();
rollback;
