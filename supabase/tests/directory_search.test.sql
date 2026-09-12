-- directory_search and directory_countries (spec 0018, AC-4): the mask rules on invented rows,
-- the keyset order and cursor, the page depth cap, the three filters, the validation refusals,
-- and that raw values appear only for an unlocked row (the caller paid) or for ops.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- The suite assumes a database freshly reset (`pnpm db:reset`). A hand run `pnpm directory:import`
-- against the local stack leaves tens of thousands of rows behind, which sort ahead of the
-- invented ones and make these assertions fail for a reason that has nothing to do with the code.
do $$
begin
  if exists (select 1 from public.directory_contacts)
     or exists (select 1 from public.directory_companies)
     or exists (select 1 from public.directory_imports)
     or exists (select 1 from public.directory_unlocks)
     or exists (select 1 from public.directory_credit_entries)
     or exists (select 1 from public.directory_suppressions) then
    raise exception 'this database holds rows beyond the seed; run `pnpm db:reset` before the tests';
  end if;
end $$;

create function pg_temp.impersonate(user_id uuid, app_role text, org_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', user_id, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', app_role, 'organization_id', org_id)))::text, true);
end $$;

create function pg_temp.make_user(user_id uuid, email text, app_role text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    '{}', now(), now());
end $$;

select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'other-expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'other-expert@test.local', 'active', now());

-- Three invented companies, ordered alpha < beta < gamma by name_normalised, five contacts.
insert into public.directory_companies (id, name, name_normalised, country, city) values
  ('d0000000-0000-4000-8000-00000000000a', 'Alpha Werke AG', 'alpha werke ag', 'CH', 'Baar'),
  ('d0000000-0000-4000-8000-00000000000b', 'Beta 50% Industries', 'beta 50% industries', 'DE', 'Köln'),
  ('d0000000-0000-4000-8000-00000000000c', 'Gamma Logistics', 'gamma logistics', 'AT', 'Linz');
insert into public.directory_contacts (id, company_id, first_name, last_name, title, email, phone, mobile, country, city, source_batch, imported_at) values
  ('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a', 'Anna', 'Muster', 'Head of EHS', 'anna.muster@alpha.test', '+41 41 123 45 67', '079 123 45 67', 'CH', 'Baar', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000a', 'Beat', 'Beispiel', 'Safety Manager', 'bb@alpha.test', null, null, 'CH', 'Baar', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-00000000000b', 'Carla', 'Probe', 'Operations Director', 'carla.probe@beta.test', '+49 221 555 0100', null, 'DE', 'Köln', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-00000000000b', 'Dora', 'Test', 'EHS Coordinator', 'dora@beta.test', null, null, 'DE', 'Köln', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-00000000000c', 'Emil', 'Fiktiv', 'Plant Manager', 'emil@gamma.test', '+43 732 1234', null, 'AT', 'Linz', 'test batch', now());
-- The active expert has already unlocked Anna (the row is inserted as postgres; the paid path is
-- proved in directory_reveal.test.sql).
insert into public.directory_unlocks (expert_id, contact_id) values
  ('e0000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001');

-- ─── The masks (AC-4) ────────────────────────────────────────────────────────────────────────
select is(private.mask_email('anna.muster@alpha.test'), 'a••••••••••@alpha.test',
  'mask_email keeps the first character, one bullet fewer than the local part, and the domain');
select is(private.mask_email('bb@alpha.test'), 'b•••@alpha.test',
  'mask_email uses at least three bullets on a short local part');
select is(private.mask_phone('+41 41 123 45 67'), '+41 •• ••• •• 67',
  'mask_phone keeps the first four and last two characters and every non digit');
select is(private.mask_phone(null), null, 'mask_phone passes null through');

-- ─── An active expert searches, masked, in keyset order ─────────────────────────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');

select results_eq(
  $$ select company_name, last_name from public.directory_search() $$,
  $$ values ('Alpha Werke AG', 'Muster'), ('Alpha Werke AG', 'Beispiel'), ('Beta 50% Industries', 'Probe'),
            ('Beta 50% Industries', 'Test'), ('Gamma Logistics', 'Fiktiv') $$,
  'an empty query returns the whole directory ordered by company name then contact id');
select results_eq(
  $$ select email_masked, phone_masked, mobile_masked, unlocked, email, phone, mobile
     from public.directory_search(q => 'beta') where last_name = 'Probe' $$,
  $$ values ('c••••••••••@beta.test', '+49 ••• ••• ••00', null::text, false, null::text, null::text, null::text) $$,
  'a locked row carries only masked values and null raw columns');
select results_eq(
  $$ select unlocked, email, phone, mobile from public.directory_search() where last_name = 'Muster' $$,
  $$ values (true, 'anna.muster@alpha.test', '+41 41 123 45 67', '079 123 45 67') $$,
  'an unlocked row carries the raw values for the expert who paid');
select results_eq(
  $$ select last_name from public.directory_search(q => 'alpha werke') $$,
  $$ values ('Muster'), ('Beispiel') $$,
  'q is a case insensitive contains match on the company name');
select results_eq(
  $$ select last_name from public.directory_search(q => '50%') $$,
  $$ values ('Probe'), ('Test') $$,
  'a LIKE metacharacter in q is matched literally');
select results_eq(
  $$ select last_name from public.directory_search(title => 'ehs') $$,
  $$ values ('Muster'), ('Test') $$,
  'title is a case insensitive contains match on the contact title');
select results_eq(
  $$ select last_name from public.directory_search(country => 'AT') $$,
  $$ values ('Fiktiv') $$,
  'country is an exact alpha 2 match');
select results_eq(
  $$ select last_name from public.directory_search(page_size => 2) $$,
  $$ values ('Muster'), ('Beispiel') $$,
  'page_size limits the page');
select results_eq(
  $$ select last_name from public.directory_search(page_size => 2,
       after_name => 'alpha werke ag', after_id => 'dc000000-0000-4000-8000-000000000002', after_page => 1) $$,
  $$ values ('Probe'), ('Test') $$,
  'the keyset cursor continues after the last row of the previous page');
select is((select count(*) from public.directory_search(page_size => 500)), 5::bigint,
  'page_size is clamped to 25 (every row fits here, none is refused)');
select throws_ok(
  $$ select * from public.directory_search(after_name => 'a', after_id => 'dc000000-0000-4000-8000-000000000001', after_page => 41) $$,
  'SM429', 'page_depth', 'a cursor past page 40 is refused with SM429');
select lives_ok(
  $$ select * from public.directory_search(after_name => 'a', after_id => 'dc000000-0000-4000-8000-000000000001', after_page => 40) $$,
  'page 40 itself is still served');
select throws_ok($$ select * from public.directory_search(q => 'a') $$, 'SM400', 'validation',
  'a one character query is refused');
select throws_ok($$ select * from public.directory_search(title => repeat('x', 101)) $$, 'SM400', 'validation',
  'a title over 100 characters is refused');
select throws_ok($$ select * from public.directory_search(country => 'Switzerland') $$, 'SM400', 'validation',
  'a country that is not an alpha 2 code is refused');
select results_eq(
  $$ select country, contacts from public.directory_countries() $$,
  $$ values ('AT', 1::bigint), ('CH', 2::bigint), ('DE', 2::bigint) $$,
  'directory_countries lists the codes present with a count each');

-- ─── Another expert does not inherit the first one's unlock ─────────────────────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select results_eq(
  $$ select unlocked, email from public.directory_search() where last_name = 'Muster' $$,
  $$ values (false, null::text) $$,
  'an unlock belongs to the expert who paid, not to every expert');

-- ─── Ops see raw values with unlocked false (the table policy already grants them the row) ──
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select results_eq(
  $$ select unlocked, email from public.directory_search() where last_name = 'Muster' $$,
  $$ values (false, 'anna.muster@alpha.test') $$,
  'ops read the raw values and unlocked stays false, because it means "this caller paid"');
select is((select count(*) from public.directory_search() where email is null), 0::bigint,
  'ops see every raw email');

select * from finish();
rollback;
