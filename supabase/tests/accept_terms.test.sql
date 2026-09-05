-- terms_accepted_at and accept_terms(): the consent column is written once, by handle_new_user
-- from the sign up metadata or by accept_terms() for provider sign ups, and never through a
-- direct update (spec 0005 AC-11).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

-- Column grant --------------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.profiles', 'terms_accepted_at', 'UPDATE'),
  'authenticated cannot update terms_accepted_at directly');
select ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
  'authenticated still updates full_name (the display grant is intact)');

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

-- accept_terms ---------------------------------------------------------------------------------
select isnt((select public.accept_terms()), null, 'accept_terms returns a timestamp for a provider sign up');
select ok(
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000002')
    between now() - interval '1 minute' and now(),
  'accept_terms stamps the caller''s profile with now()');
select is(
  (select public.accept_terms()),
  (select terms_accepted_at from public.profiles where id = 'f0000000-0000-4000-8000-000000000002'),
  'a second accept_terms call returns the stored value and changes nothing');

select pg_temp.as_postgres();
select pg_temp.impersonate('f0000000-0000-4000-8000-000000000001', 'client');
select is(
  (select public.accept_terms()),
  '2026-09-01T08:00:00Z'::timestamptz,
  'accept_terms never overwrites a consent the sign up already recorded');

select pg_temp.as_postgres();
select pg_temp.impersonate('f0000000-0000-4000-8000-000000000004', 'expert');
select isnt((select public.accept_terms()), null,
  'staff may record consent too (feature 16 records the expert''s own consent)');

-- anon ----------------------------------------------------------------------------------------
select pg_temp.as_postgres();
select ok(not has_function_privilege('anon', 'public.accept_terms()', 'EXECUTE'),
  'anon cannot execute accept_terms');
select pg_temp.as_anon();
select throws_ok($$ select public.accept_terms() $$, '42501', null,
  'accept_terms as anon is refused by the grant, before the body runs');

select pg_temp.as_postgres();
select * from finish();
rollback;
