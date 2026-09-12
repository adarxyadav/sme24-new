-- directory_unlocks and directory_unlocked_contacts (spec 0018, AC-11, AC-13): an expert reads
-- their own unlock rows and nobody else's, writes none, and the unlocks page function walks them
-- newest first by keyset up to 500 a page.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.impersonate(user_id uuid, app_role text, org_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', user_id, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', app_role, 'organization_id', org_id)))::text, true);
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

select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'other-expert@test.local', 'expert');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'client@test.local', 'client');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'other-expert@test.local', 'active', now());

insert into public.directory_companies (id, name, name_normalised, country, city) values
  ('d0000000-0000-4000-8000-00000000000a', 'Alpha Werke AG', 'alpha werke ag', 'CH', 'Baar');
insert into public.directory_contacts (id, company_id, first_name, last_name, title, email, country, source_batch, imported_at) values
  ('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a', 'Anna', 'Muster', 'Head of EHS', 'anna.muster@alpha.test', 'CH', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000a', 'Beat', 'Beispiel', 'Safety Manager', 'beat.beispiel@alpha.test', 'CH', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-00000000000a', 'Carla', 'Probe', 'Director', 'carla.probe@alpha.test', 'CH', 'test batch', now());
-- Three unlocks for the first expert at three moments, one for the other expert.
insert into public.directory_unlocks (id, expert_id, contact_id, created_at) values
  ('d1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001', '2026-09-01T10:00:00Z'),
  ('d1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000002', '2026-09-02T10:00:00Z'),
  ('d1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000003', '2026-09-03T10:00:00Z'),
  ('d1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000002', 'dc000000-0000-4000-8000-000000000001', '2026-09-04T10:00:00Z');

select throws_ok(
  $$ insert into public.directory_unlocks (expert_id, contact_id)
     values ('e0000000-0000-4000-8000-000000000001', 'dc000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'one unlock per expert per contact (invariant 3)');

-- ─── The expert reads their own rows and pages them newest first (AC-13) ───────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');

select is((select count(*) from public.directory_unlocks), 3::bigint,
  'an expert reads their own unlock rows only');
select results_eq(
  $$ select last_name, email from public.directory_unlocked_contacts() $$,
  $$ values ('Probe', 'carla.probe@alpha.test'), ('Beispiel', 'beat.beispiel@alpha.test'), ('Muster', 'anna.muster@alpha.test') $$,
  'unlocked contacts come newest first with their raw values');
select results_eq(
  $$ select last_name from public.directory_unlocked_contacts(page_size => 2) $$,
  $$ values ('Probe'), ('Beispiel') $$,
  'page_size limits the page');
select results_eq(
  $$ select last_name from public.directory_unlocked_contacts(
       after_created_at => '2026-09-02T10:00:00Z', after_id => 'd1000000-0000-4000-8000-000000000002', page_size => 2) $$,
  $$ values ('Muster') $$,
  'the keyset cursor continues after the last row of the previous page');
select is((select count(*) from public.directory_unlocked_contacts(page_size => 5000)), 3::bigint,
  'page_size is clamped to 500 (every row fits here, none is refused)');
select throws_ok(
  $$ delete from public.directory_unlocks where id = 'd1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'an expert cannot delete an unlock');

-- ─── The other expert sees only theirs ──────────────────────────────────────────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is((select count(*) from public.directory_unlocks), 1::bigint,
  'another expert reads only their own unlock');
select results_eq(
  $$ select last_name from public.directory_unlocked_contacts() $$,
  $$ values ('Muster') $$,
  'and pages only their own');

-- ─── A client and ops ───────────────────────────────────────────────────────────────────────
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client');
select is((select count(*) from public.directory_unlocks), 0::bigint, 'a client sees no unlock');
select throws_ok($$ select * from public.directory_unlocked_contacts() $$, 'SM403', 'forbidden',
  'a client gets SM403 from directory_unlocked_contacts');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.directory_unlocks), 4::bigint, 'ops read every unlock');
select throws_ok($$ select * from public.directory_unlocked_contacts() $$, 'SM403', 'forbidden',
  'ops have no unlocks page of their own: the function is for the buyer');

select pg_temp.as_postgres();
select * from finish();
rollback;
