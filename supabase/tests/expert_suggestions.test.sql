-- expert_suggestions (spec 0022, AC-26): a client may not select expert_profiles at all, the
-- function's row type carries no email, ops note or status, it returns at most three `active`
-- experts of the section by the country then region then world ladder, anon may not execute it,
-- and the storage policy lets a client sign an active expert's photo but not an invited one's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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

create function pg_temp.make_user(user_id uuid, email text, app_role text, meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    meta, now(), now());
end $$;

-- The ladder assertions below name the exact three rows the function must return for section C,
-- so the seed's own section C experts (spec 0022, AC-28: three active Swiss experts for the
-- benchmark page to show) would compete with the fixtures for those three places. Clear the table
-- first: everything here runs in one transaction that is rolled back, so the seeded rows come back
-- untouched when the suite ends.
delete from public.expert_profiles;

-- Fixtures: a client with no expert assignment at all (the benchmark page suggests experts before
-- any assignment exists), and five experts in section C across the three ladder rungs.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-00000000000c', 'ch-expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-00000000000d', 'ch-limited@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-00000000000e', 'de-expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-00000000000f', 'us-expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000010', 'invited@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000011', 'other-section@test.local', 'expert');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- Two Swiss experts (one available, one limited), a German one, an American one, a Swiss expert
-- still `invited`, and an active Swiss expert in another section.
insert into public.expert_profiles (expert_id, email, status, onboarded_at, headline, industries, countries, languages, availability, years_experience, photo_path) values
  ('e0000000-0000-4000-8000-00000000000c', 'ch-expert@test.local', 'active', now(), 'Swiss safety lead', array['C'], array['CH'], array['de'], 'available', 12, 'e0000000-0000-4000-8000-00000000000c/photo.jpg'),
  ('e0000000-0000-4000-8000-00000000000d', 'ch-limited@test.local', 'active', now(), 'Swiss auditor', array['C'], array['CH'], array['de'], 'limited', 20, null),
  ('e0000000-0000-4000-8000-00000000000e', 'de-expert@test.local', 'active', now(), 'German consultant', array['C'], array['DE'], array['de'], 'available', 30, null),
  ('e0000000-0000-4000-8000-00000000000f', 'us-expert@test.local', 'active', now(), 'US consultant', array['C'], array['US'], array['en'], 'available', 40, null),
  ('e0000000-0000-4000-8000-000000000010', 'invited@test.local', 'invited', null, 'Not yet onboarded', array['C'], array['CH'], array['de'], 'available', 50, 'e0000000-0000-4000-8000-000000000010/photo.jpg'),
  ('e0000000-0000-4000-8000-000000000011', 'other-section@test.local', 'active', now(), 'Finance specialist', array['K'], array['CH'], array['de'], 'available', 35, null);

-- The boundary: a client never selects the table, whatever the function returns.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is(
  (select count(*) from public.expert_profiles),
  0::bigint,
  'a client selecting expert_profiles gets zero rows');

-- The ladder (AC-26). Switzerland is the client's country, the German expert sits in its region.
select is(
  (select count(*) from public.expert_suggestions('C', 'CH', array['DE', 'AT', 'FR', 'IT'])),
  3::bigint,
  'at most three experts come back');
select is(
  (select array_agg(s.expert_id order by ordinality)
   from public.expert_suggestions('C', 'CH', array['DE', 'AT', 'FR', 'IT']) with ordinality as s(expert_id, full_name, headline, industries, countries, languages, availability, photo_path, ordinality)),
  array['e0000000-0000-4000-8000-00000000000c', 'e0000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-00000000000e']::uuid[],
  'country rung first, then the region; within a rung available beats limited');

-- The available Swiss expert has 12 years and the limited one 20, so availability outranking
-- experience is what puts them in this order rather than the other way round.
select is(
  (select s.headline from public.expert_suggestions('C', 'CH', array['DE']) s limit 1),
  'Swiss safety lead',
  'availability is ordered before years of experience');

select is(
  (select count(*) from public.expert_suggestions('C', 'JP', array['KR', 'CN'])),
  3::bigint,
  'a country with no match falls through to the world rung');
select is(
  (select count(*) from public.expert_suggestions('K', 'CH', array['DE'])),
  1::bigint,
  'only experts whose industries hold the section are suggested');
select is(
  (select count(*) from public.expert_suggestions('Q', 'CH', array['DE'])),
  0::bigint,
  'a section nobody covers answers no rows rather than raising');
select is(
  (select count(*) from public.expert_suggestions('C', 'CH', array['DE'])
   where expert_id = 'e0000000-0000-4000-8000-000000000010'),
  0::bigint,
  'an invited expert is never suggested');
select is(
  (select count(*) from public.expert_suggestions('C', 'CH', null)),
  3::bigint,
  'a null region list is treated as no region rather than raising');

-- The row type is the whole of what a client learns about an unassigned expert (AC-26). A set
-- returning function's output columns are its OUT parameters, so pg_proc is where they are read;
-- information_schema.columns holds nothing for a function.
create function pg_temp.out_columns()
returns table (name text) language sql stable as $$
  select unnest(p.proargnames[array_length(p.proargnames, 1) - 7:])::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'expert_suggestions'
$$;
select bag_eq(
  $$ select name from pg_temp.out_columns() $$,
  $$ values ('expert_id'), ('full_name'), ('headline'), ('industries'), ('countries'), ('languages'), ('availability'), ('photo_path') $$,
  'the row type is exactly the public half of the profile');
select is(
  (select count(*) from pg_temp.out_columns()
   where name in ('email', 'status', 'bio', 'phone', 'availability_note', 'invited_by', 'deactivated_at')),
  0::bigint,
  'the row type has no email, notes or status column');

-- Definer with a pinned search_path, and no anon execute (AC-26).
select is(
  (select prosecdef from pg_proc where proname = 'expert_suggestions'),
  true,
  'the function is security definer');
select is(
  (select proconfig from pg_proc where proname = 'expert_suggestions'),
  array['search_path=""']::text[],
  'the search path is pinned empty');
select ok(
  not has_function_privilege('anon', 'public.expert_suggestions(text, text, text[])', 'execute'),
  'anon may not execute the function');
select ok(
  has_function_privilege('authenticated', 'public.expert_suggestions(text, text, text[])', 'execute'),
  'a signed in caller may execute the function');

-- The photo policy (AC-26): the page signs the photo with the caller's own client, so a client
-- with no assignment must still read an active expert's object and never an invited one's.
select pg_temp.as_postgres();
insert into storage.buckets (id, name, public) values ('expert-photos', 'expert-photos', false)
on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner) values
  ('expert-photos', 'e0000000-0000-4000-8000-00000000000c/photo.jpg', 'e0000000-0000-4000-8000-00000000000c'),
  ('expert-photos', 'e0000000-0000-4000-8000-000000000010/photo.jpg', 'e0000000-0000-4000-8000-000000000010');

select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is(
  (select count(*) from storage.objects
   where name = 'e0000000-0000-4000-8000-00000000000c/photo.jpg'),
  1::bigint,
  'a client with no assignment reads an active expert''s photo');
select is(
  (select count(*) from storage.objects
   where name = 'e0000000-0000-4000-8000-000000000010/photo.jpg'),
  0::bigint,
  'and never an invited expert''s photo');

select pg_temp.as_anon();
select is(
  (select count(*) from storage.objects where bucket_id = 'expert-photos'),
  0::bigint,
  'a signed out caller reads no photo at all');

select * from finish();
rollback;
