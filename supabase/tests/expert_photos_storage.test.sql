-- expert-photos bucket (spec 0013, AC-6): the photo is personal data of a contractor, so the
-- bucket is private and every render mints a signed URL with the viewer's own client. That makes
-- these policies the boundary for each viewer rather than a decision taken once in app code, and
-- the rule they have to match is the view's: a client sees the photo of an expert exactly while
-- that expert is actively assigned to them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'expert-photos') then
    raise exception 'this database holds expert photos; run `pnpm db:reset` before the tests';
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

-- A minimal auth user; the profiles trigger creates the profile from app_metadata.role.
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

-- Inserts an object row the way the storage API would, so the policies see a real path.
create function pg_temp.put_photo(expert_id uuid, ext text default 'jpg')
returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('expert-photos', expert_id::text || '/photo.' || ext, expert_id, '{}'::jsonb);
end $$;

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert-x@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'expert-y@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'expert-x@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'expert-y@test.local', 'active', now());

select pg_temp.put_photo('e0000000-0000-4000-8000-000000000001');
select pg_temp.put_photo('e0000000-0000-4000-8000-000000000002');

-- The bucket itself ------------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'expert-photos'), false,
  'the bucket is private: no object is ever readable from a public URL');
select is((select file_size_limit from storage.buckets where id = 'expert-photos'), 2097152::bigint,
  'and caps an object at 2 MB, the same limit the upload action enforces');
select results_eq(
  $$ select unnest(allowed_mime_types) from storage.buckets where id = 'expert-photos' order by 1 $$,
  $$ values ('image/jpeg'), ('image/png'), ('image/webp') $$,
  'and accepts only the three image types');

-- The owner --------------------------------------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'expert-photos' $$,
  $$ values ('e0000000-0000-4000-8000-000000000001/photo.jpg') $$,
  'an expert reads their own photo and no other expert''s');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner, metadata)
     values ('expert-photos', 'e0000000-0000-4000-8000-000000000001/photo.png',
             'e0000000-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  'and uploads into their own folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner, metadata)
     values ('expert-photos', 'e0000000-0000-4000-8000-000000000002/photo.png',
             'e0000000-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '42501', null, 'but never into another expert''s folder');
-- Storage blocks a direct delete with its own trigger (the Storage API is the only delete path),
-- so what is provable here is the read: the other expert's object is invisible, which is what
-- makes a delete of it impossible through the API too.
select is(pg_temp.affected(
  $$ update storage.objects set metadata = '{"tampered":true}'::jsonb
     where bucket_id = 'expert-photos' and name = 'e0000000-0000-4000-8000-000000000002/photo.jpg' $$),
  0::bigint, 'and cannot touch another expert''s photo row at all');

-- The client, before and after an assignment -------------------------------------------------
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'expert-photos'), 0::bigint,
  'a client with no assigned expert sees no photo');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
insert into public.expert_assignments (id, organization_id, expert_id, assigned_by) values
  ('0e000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000',
   'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');

select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'expert-photos' order by 1 $$,
  $$ values ('e0000000-0000-4000-8000-000000000001/photo.jpg'),
            ('e0000000-0000-4000-8000-000000000001/photo.png') $$,
  'once assigned, the client reads that expert''s photos and only theirs');

select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'expert-photos'), 0::bigint,
  'a client of another organization still sees nothing');

-- Ending the assignment closes the window, exactly as it does for the summary view.
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
update public.expert_assignments set status = 'ended' where id = '0e000000-0000-4000-8000-000000000001';
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from storage.objects where bucket_id = 'expert-photos'), 0::bigint,
  'and the photo goes out of reach the moment the assignment is ended');

select pg_temp.as_anon();
select is((select count(*) from storage.objects where bucket_id = 'expert-photos'), 0::bigint,
  'an anonymous visitor reads no photo: the bucket is private');

select * from finish();
rollback;
