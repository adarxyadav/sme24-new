-- terms_accepted_at, terms_version and accept_terms(): the two consent columns are written by
-- handle_new_user from the sign up metadata or by accept_terms(), and never through a direct
-- update (spec 0005 AC-11, spec 0015 AC-10).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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

-- Fixtures: a password sign up with consent, a provider sign up (no consent, `name` only), a
-- sign up whose metadata carries garbage in the consent key, and a staff account.
select pg_temp.make_user('f0000000-0000-4000-8000-000000000001', 'consented@test.local', 'client',
  '{"full_name":"Carla Consent","locale":"de","terms_accepted_at":"2026-09-01T08:00:00Z"}');
select pg_temp.make_user('f0000000-0000-4000-8000-000000000002', 'provider@test.local', 'client',
  '{"name":"Pia Provider"}');
select pg_temp.make_user('f0000000-0000-4000-8000-000000000003', 'garbage@test.local', 'client',
  '{"full_name":"Gustav Garbage","terms_accepted_at":"yes please"}');
select pg_temp.make_user('f0000000-0000-4000-8000-000000000004', 'staff@test.local', 'expert');
-- Spec 0015: a sign up that carries the version it was shown, and one that carries junk in it.
select pg_temp.make_user('f0000000-0000-4000-8000-000000000005', 'versioned@test.local', 'client',
  '{"full_name":"Vera Version","terms_accepted_at":"2026-09-01T08:00:00Z","terms_version":"2"}');
select pg_temp.make_user('f0000000-0000-4000-8000-000000000006', 'junkversion@test.local', 'client',
  '{"full_name":"Jonas Junk","terms_accepted_at":"2026-09-01T08:00:00Z","terms_version":"'' or 1=1 --"}');

-- Column grant --------------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.profiles', 'terms_accepted_at', 'UPDATE'),
  'authenticated cannot update terms_accepted_at directly');
select ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
  'authenticated still updates full_name (the display grant is intact)');
-- Spec 0015 (AC-10): the column added by the migration must inherit no write grant. Postgres does
-- not extend a column level grant to a new column, and this test is what keeps that true: a later
-- `grant update on profiles` would hand the compliance column away silently.
select ok(not has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'UPDATE'),
  'authenticated cannot update terms_version directly');
-- anon carries a table level UPDATE grant on profiles from Supabase's defaults (it is not
-- revoked the way authenticated's is), so the grant check above says nothing about it. RLS is the
-- real boundary for anon: there is no anon update policy, so the write reaches zero rows.
select is(
  (select count(*) from pg_policies where tablename = 'profiles' and cmd = 'UPDATE'
   and roles::text like '%anon%'),
  0::bigint,
  'no update policy on profiles admits anon, so anon writes reach no row');

-- handle_new_user ----------------------------------------------------------------------------
select is(
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  '2026-09-01T08:00:00Z'::timestamptz,
  'handle_new_user copies a metadata timestamp into terms_accepted_at');
select is(
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  null,
  'handle_new_user leaves terms_accepted_at null when the metadata has none');
select is(
  (select full_name from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  'Pia Provider',
  'handle_new_user falls back to the provider''s `name` for full_name');
select is(
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000003'),
  null,
  'handle_new_user ignores a consent value that is not a timestamp');
select is(
  (select terms_accepted_at from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  '2026-09-01T08:00:00Z'::timestamptz,
  'the seeded client carries consent');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000005'),
  '2',
  'handle_new_user copies the version the sign up form showed');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  '1',
  'a sign up without a version key falls back to the default');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000006'),
  '1',
  'handle_new_user ignores a version that is not version shaped');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  '1',
  'a sign up with no consent at all still gets the default version');

-- Direct writes are refused ---------------------------------------------------------------------
select pg_temp.impersonate('f0000000-0000-4000-8000-000000000002', 'client');
select throws_ok(
  $$ update public.profiles set terms_accepted_at = now() where id = 'f0000000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'a client cannot set terms_accepted_at with a direct update');
select throws_ok(
  $$ update public.profiles set terms_accepted_at = null where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a client cannot clear terms_accepted_at with a direct update either');
-- Spec 0015 (AC-10): the point of the whole column. If a client could write this, they could mark
-- themselves current on a version they never saw and walk straight past the re consent dialog.
select throws_ok(
  $$ update public.profiles set terms_version = '99' where id = 'f0000000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'a client cannot set terms_version with a direct update');
select throws_ok(
  $$ update public.profiles set full_name = 'Fine', terms_version = '99' where id = 'f0000000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'a write that smuggles terms_version in beside an allowed column is refused whole');

-- accept_terms ---------------------------------------------------------------------------------
select isnt((select public.accept_terms()), null, 'accept_terms returns a timestamp for a provider sign up');
select ok(
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000002')
    between now() - interval '1 minute' and now(),
  'accept_terms stamps the caller''s profile with now()');
select is(
  (select public.accept_terms()),
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  'a second accept_terms call for the same version returns the stored value and changes nothing');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  '1',
  'the default argument records version 1, the version the zero argument callers were written for');

select pg_temp.as_postgres();
select pg_temp.impersonate('f0000000-0000-4000-8000-000000000001', 'client');
select is(
  (select public.accept_terms()),
  '2026-09-01T08:00:00Z'::timestamptz,
  'accept_terms leaves a consent already recorded for the same version untouched');

-- Re consent (AC-10): accepting a different version moves both columns together, which is the
-- whole mechanism. Before spec 0015 this call was a no op, because the write was guarded on the
-- stamp being null rather than on the version differing.
select isnt(
  (select public.accept_terms('2')),
  '2026-09-01T08:00:00Z'::timestamptz,
  'accepting a new version restamps terms_accepted_at');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  '2',
  'accepting a new version stores that version');
select ok(
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000001')
    between now() - interval '1 minute' and now(),
  'the two consent columns move together: the stamp is now, not the old acceptance');

-- Equality, never ordering (AC-10). A profile at '10' against a constant of '2' is a *different*
-- version, so accepting '2' must move it; a `<` comparison would read '10' as already older and
-- the app would treat the profile as current. Both directions are asserted, because a text
-- comparison is wrong in one direction and accidentally right in the other.
select is((select public.accept_terms('10')), (select terms_accepted_at from public.profiles
  where id = 'f0000000-0000-4000-8000-000000000001'),
  'a version that sorts below the previous one is still accepted');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  '10',
  'moving from ''2'' to ''10'' is stored, though ''10'' < ''2'' as text');

-- The argument is a compliance value, so its shape is checked in the body rather than trusted.
select throws_ok($$ select public.accept_terms('not a version at all, far too long') $$,
  'P0001', 'invalid_terms_version',
  'accept_terms refuses a version that is not version shaped');
select throws_ok($$ select public.accept_terms('') $$,
  'P0001', 'invalid_terms_version',
  'accept_terms refuses an empty version');
select throws_ok($$ select public.accept_terms(null) $$,
  'P0001', 'invalid_terms_version',
  'accept_terms refuses a null version rather than storing one');
select is(
  (select terms_version from public.profiles where id = 'f0000000-0000-4000-8000-000000000001'),
  '10',
  'a refused call leaves the stored version alone');

select pg_temp.as_postgres();
select pg_temp.impersonate('f0000000-0000-4000-8000-000000000004', 'expert');
select isnt((select public.accept_terms()), null,
  'staff may record consent too (feature 16 records the expert''s own consent)');

-- anon ----------------------------------------------------------------------------------------
select pg_temp.as_postgres();
select ok(not has_function_privilege('anon', 'public.accept_terms(text)', 'EXECUTE'),
  'anon cannot execute accept_terms');
-- The zero argument form is gone: a defaulted argument adds a signature rather than replacing
-- one, so leaving it would have made a bare accept_terms() call ambiguous at run time.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_terms'),
  1::bigint,
  'exactly one accept_terms signature exists');
select pg_temp.as_anon();
select throws_ok($$ select public.accept_terms() $$, '42501', null,
  'accept_terms as anon is refused by the grant, before the body runs');

select pg_temp.as_postgres();
select * from finish();
rollback;
