-- The directory read boundary (spec 0018, AC-1, invariant 1): the six directory tables are
-- unreadable and unwritable to every app role but ops, so the two definer functions are the only
-- way a raw email or phone leaves Postgres. An expert selecting any of the three restricted
-- tables gets zero rows, cannot write any of the six, a client gets SM403 from every directory
-- function, and ops read directory_imports while an expert gets zero rows from it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

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

create function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.make_user(user_id uuid, email text, app_role text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    '{}', now(), now());
end $$;

-- Fixtures: an active expert, an invited one, a client, ops; two invented companies with three
-- invented contacts, one suppression, one import row. Every value here is made up.
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'invited-expert@test.local', 'expert');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'client@test.local', 'client');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'invited-expert@test.local', 'invited', null);
insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

insert into public.directory_companies (id, name, name_normalised, country, city) values
  ('d0000000-0000-4000-8000-00000000000a', 'Alpha Werke AG', 'alpha werke ag', 'CH', 'Baar'),
  ('d0000000-0000-4000-8000-00000000000b', 'Beta Industries', 'beta industries', 'DE', 'Köln');
insert into public.directory_contacts (id, company_id, first_name, last_name, title, email, phone, mobile, country, city, source_batch, imported_at) values
  ('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a', 'Anna', 'Muster', 'Head of EHS', 'anna.muster@alpha.test', '+41 41 123 45 67', null, 'CH', 'Baar', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000a', 'Beat', 'Beispiel', 'Safety Manager', 'beat.beispiel@alpha.test', null, '+41 79 987 65 43', 'CH', 'Baar', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-00000000000b', 'Carla', 'Probe', 'Operations Director', 'carla.probe@beta.test', '+49 221 555 0100', null, 'DE', 'Köln', 'test batch', now());
insert into public.directory_suppressions (email_hash, reason) values
  (encode(sha256(convert_to('gone@alpha.test', 'UTF8')), 'hex'), 'data_subject_request');
insert into public.directory_imports (source_batch, file_name, rows_read, rows_loaded, countries, excluded_countries, dry_run, finished_at)
  values ('test batch', 'invented.xlsx', 3, 3, '{"CH": 2, "DE": 1}', '{}', false, now());

-- ─── An active expert reads nothing directly (AC-1) ─────────────────────────────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');

select is((select count(*) from public.directory_companies), 0::bigint,
  'an expert selecting directory_companies gets zero rows');
select is((select count(*) from public.directory_contacts), 0::bigint,
  'an expert selecting directory_contacts gets zero rows');
select is((select count(*) from public.directory_suppressions), 0::bigint,
  'an expert selecting directory_suppressions gets zero rows');
select is((select count(*) from public.directory_imports), 0::bigint,
  'an expert selecting directory_imports gets zero rows');
select is((select count(*) from public.directory_unlocks), 0::bigint,
  'an expert with no unlocks sees no unlock rows');
select is((select count(*) from public.directory_credit_entries), 0::bigint,
  'an expert with no ledger rows sees no ledger rows');

-- ─── An active expert writes nothing (AC-1, AC-11) ──────────────────────────────────────────
select throws_ok(
  $$ insert into public.directory_companies (name, name_normalised) values ('X', 'x') $$,
  '42501', null, 'an expert cannot insert into directory_companies');
select throws_ok(
  $$ insert into public.directory_contacts (company_id, email, source_batch, imported_at)
     values ('d0000000-0000-4000-8000-00000000000a', 'new@alpha.test', 'x', now()) $$,
  '42501', null, 'an expert cannot insert into directory_contacts');
select throws_ok(
  $$ insert into public.directory_suppressions (email_hash, reason) values (repeat('a', 64), 'ops') $$,
  '42501', null, 'an expert cannot insert into directory_suppressions');
select throws_ok(
  $$ insert into public.directory_unlocks (expert_id, contact_id)
     values ('e0000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'an expert cannot insert their own unlock');
select throws_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason)
     values ('e0000000-0000-4000-8000-000000000001', 50, 'grant') $$,
  '42501', null, 'an expert cannot insert a ledger row');
select throws_ok(
  $$ insert into public.directory_imports (source_batch, file_name) values ('x', 'x.xlsx') $$,
  '42501', null, 'an expert cannot insert an import row');
select throws_ok(
  $$ update public.directory_contacts set title = 'CEO' $$,
  '42501', null, 'an expert cannot update directory_contacts');
select throws_ok(
  $$ delete from public.directory_contacts $$,
  '42501', null, 'an expert cannot delete from directory_contacts');
select throws_ok(
  $$ delete from public.directory_unlocks $$,
  '42501', null, 'an expert cannot delete an unlock');
select throws_ok(
  $$ update public.directory_credit_entries set delta = 1000 $$,
  '42501', null, 'an expert cannot update a ledger row');

-- ─── A client gets SM403 from every directory function (AC-1) ───────────────────────────────
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');

select throws_ok($$ select * from public.directory_search() $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_search');
select throws_ok($$ select * from public.directory_countries() $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_countries');
select throws_ok($$ select * from public.directory_reveal('dc000000-0000-4000-8000-000000000001') $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_reveal');
select throws_ok($$ select * from public.directory_unlocked_contacts() $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_unlocked_contacts');
select throws_ok($$ select public.directory_credit_balance() $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_credit_balance');
select throws_ok($$ select * from public.directory_ops_summary() $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_ops_summary');
select throws_ok($$ select * from public.directory_remove_contact('x@alpha.test', 'ops') $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_remove_contact');
select is((select count(*) from public.directory_contacts), 0::bigint,
  'a client selecting directory_contacts gets zero rows');
select is((select count(*) from public.directory_companies), 0::bigint,
  'a client selecting directory_companies gets zero rows');
select throws_ok(
  $$ insert into public.directory_companies (name, name_normalised) values ('X', 'x') $$,
  '42501', null, 'a client cannot insert into directory_companies');

-- ─── An invited expert is refused too ───────────────────────────────────────────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select throws_ok($$ select * from public.directory_search() $$, 'SM403', 'forbidden',
  'an invited expert gets SM403 from directory_search');
select throws_ok($$ select * from public.directory_countries() $$, 'SM403', 'forbidden',
  'an invited expert gets SM403 from directory_countries');
select throws_ok($$ select * from public.directory_reveal('dc000000-0000-4000-8000-000000000001') $$, 'SM403', 'forbidden',
  'an invited expert gets SM403 from directory_reveal');
select throws_ok($$ select * from public.directory_remove_contact('x@alpha.test', 'ops') $$, 'SM403', 'forbidden',
  'an invited expert gets SM403 from directory_remove_contact');

-- ─── Anonymous ───────────────────────────────────────────────────────────────────────────────
select pg_temp.as_anon();
select throws_ok($$ select * from public.directory_search() $$, '42501', null,
  'an anonymous visitor cannot execute directory_search');
select is((select count(*) from public.directory_contacts), 0::bigint,
  'an anonymous visitor selecting directory_contacts gets zero rows');

-- ─── Ops read every table, imports included (AC-1) ──────────────────────────────────────────
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.directory_contacts), 3::bigint, 'ops read directory_contacts');
select is((select count(*) from public.directory_companies), 2::bigint, 'ops read directory_companies');
select is((select count(*) from public.directory_suppressions), 1::bigint, 'ops read directory_suppressions');
select is((select count(*) from public.directory_imports), 1::bigint, 'ops read directory_imports');

select * from finish();
rollback;
