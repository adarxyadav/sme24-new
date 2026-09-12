-- questionnaire_versions and questionnaire_items (spec 0019, AC-2; spec 0002 kind G): the seed
-- migration wrote iso45001@1 and compliance@1 with the counts the content files state, every
-- parent precedes its children, every item's section and group exist in its version's outline,
-- every signed in user reads, only ops write through the API, and truncate is revoked.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- The suite assumes a database freshly reset (`pnpm db:reset`): it counts the seeded rows.
do $$
begin
  if exists (select 1 from public.questionnaire_versions where key not in ('iso45001@1', 'compliance@1')) then
    raise exception 'this database holds questionnaire versions beyond the seed; run `pnpm db:reset` before the tests';
  end if;
end $$;

-- Shared shape (spec 0002, Policy tests): everything below runs in one transaction and is rolled
-- back at the end. Impersonation switches the role and the JWT claims the way PostgREST does.
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

create function pg_temp.affected(statement text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');
insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');

-- The seed ------------------------------------------------------------------------------------
select results_eq(
  $$ select key, questionnaire_key, version, item_count from public.questionnaire_versions order by key $$,
  $$ values ('compliance@1', 'compliance', 1, 327), ('iso45001@1', 'iso45001', 1, 60) $$,
  'the seed wrote iso45001@1 with 60 items and compliance@1 with 327, as the version rows state');
select is((select count(*) from public.questionnaire_items where version_key = 'iso45001@1'), 60::bigint,
  'iso45001@1 holds 60 items');
select is((select count(*) from public.questionnaire_items where version_key = 'compliance@1'), 327::bigint,
  'compliance@1 holds 327 items');
select is_empty(
  $$ select v.key from public.questionnaire_versions v
     where v.item_count <> (select count(*) from public.questionnaire_items i where i.version_key = v.key) $$,
  'every version row states the item count the seed actually wrote');
select is((select count(*) from public.questionnaire_items where version_key = 'iso45001@1' and parent_id is null), 27::bigint,
  'iso45001@1 has 27 top level items, the clauses');
select is((select count(*) from public.questionnaire_items where version_key = 'iso45001@1' and parent_id is not null and rateable), 19::bigint,
  'iso45001@1 has 19 rateable annex sub items');
select is((select count(*) from public.questionnaire_items where version_key = 'iso45001@1' and not rateable), 14::bigint,
  'iso45001@1 has 14 context lines');
select is((select count(*) from public.questionnaire_items where version_key = 'compliance@1' and (parent_id is not null or not rateable or group_key is null)), 0::bigint,
  'every compliance@1 item is a rateable top level item in a group');
select is((select jsonb_array_length(sections) from public.questionnaire_versions where key = 'iso45001@1'), 7,
  'iso45001@1 outlines seven sections');
select is((select jsonb_array_length(sections) from public.questionnaire_versions where key = 'compliance@1'), 18,
  'compliance@1 outlines 18 sections');
select is((select count(*) from public.questionnaire_versions v, jsonb_array_elements(v.sections) s, jsonb_array_elements(s -> 'groups') g where v.key = 'compliance@1'), 42::bigint,
  'compliance@1 outlines 42 groups');

-- Positions and parents ------------------------------------------------------------------------
select is_empty(
  $$ select v.key from public.questionnaire_versions v
     where (select count(*) from public.questionnaire_items i where i.version_key = v.key)
        <> (select max(position) from public.questionnaire_items i where i.version_key = v.key)
        or 1 <> (select min(position) from public.questionnaire_items i where i.version_key = v.key) $$,
  'positions run 1 to N in every version');
select is_empty(
  $$ select c.id from public.questionnaire_items c join public.questionnaire_items p on p.id = c.parent_id
     where p.position >= c.position or p.version_key <> c.version_key or p.parent_id is not null $$,
  'every parent precedes its children, in the same version, and is itself top level');
select is_empty(
  $$ select i.id from public.questionnaire_items i
     where i.id <> i.version_key || '/' || i.position $$,
  'every item id is <version key>/<position>');
select is_empty(
  $$ select i.id from public.questionnaire_items i join public.questionnaire_versions v on v.key = i.version_key
     where not exists (select 1 from jsonb_array_elements(v.sections) s where s ->> 'key' = i.section_key) $$,
  'every item''s section exists in its version''s outline');
select is_empty(
  $$ select i.id from public.questionnaire_items i join public.questionnaire_versions v on v.key = i.version_key
     where i.group_key is not null and not exists (
       select 1 from jsonb_array_elements(v.sections) s, jsonb_array_elements(s -> 'groups') g
       where s ->> 'key' = i.section_key and g ->> 'key' = i.group_key) $$,
  'every item''s group exists under its section in the outline');
select is_empty(
  $$ select i.id from public.questionnaire_items i
     where title ->> 'de' = '' or title ->> 'en' = '' or question ->> 'de' = '' or question ->> 'en' = ''
        or (requirement is not null and (requirement ->> 'de' = '' or requirement ->> 'en' = '')) $$,
  'every text carries a non empty German and English');
select is_empty(
  $$ select i.id from public.questionnaire_items i
     where title ->> 'en' ilike '%lonza%' or question ->> 'en' ilike '%lonza%' or requirement ->> 'en' ilike '%lonza%' $$,
  'no seeded text names the company the checklist was written for');
select is((select label from public.questionnaire_items where version_key = 'compliance@1' and section_key = 'hot_work' and position = (select min(position) + 9 from public.questionnaire_items where section_key = 'hot_work')), '1.10',
  'the tenth Hot Work item carries its restored label 1.10');

-- Reads ----------------------------------------------------------------------------------------
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.questionnaire_versions), 2::bigint, 'a client reads every version');
select is((select count(*) from public.questionnaire_items), 387::bigint, 'a client reads every item');
select throws_ok(
  $$ insert into public.questionnaire_versions (key, questionnaire_key, version, title, sections, item_count)
     values ('culture@1', 'culture', 1, '{"de":"K","en":"C"}', '[]', 0) $$,
  '42501', null, 'a client cannot insert a version');
select is(pg_temp.affected($$ update public.questionnaire_versions set source_note = 'x' where key = 'iso45001@1' $$), 0::bigint,
  'a client cannot update a version (zero rows)');
select is(pg_temp.affected($$ update public.questionnaire_items set de_reviewed = true where id = 'iso45001@1/1' $$), 0::bigint,
  'a client cannot update an item (zero rows)');
select is(pg_temp.affected($$ delete from public.questionnaire_items where id = 'iso45001@1/1' $$), 0::bigint,
  'a client cannot delete an item (zero rows)');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.questionnaire_items where version_key = 'iso45001@1'), 60::bigint, 'an expert reads the items');
select throws_ok(
  $$ insert into public.questionnaire_items (id, version_key, position, section_key, label, rateable, title, question)
     values ('iso45001@1/61', 'iso45001@1', 61, 'c10', '10.4', true, '{"de":"x","en":"x"}', '{"de":"x","en":"x"}') $$,
  '42501', null, 'an expert cannot insert an item');

select pg_temp.as_anon();
select is((select count(*) from public.questionnaire_versions), 0::bigint, 'anon reads no version');
select is((select count(*) from public.questionnaire_items), 0::bigint, 'anon reads no item');

-- Ops writes -----------------------------------------------------------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.questionnaire_versions (key, questionnaire_key, version, title, sections, item_count)
     values ('culture@1', 'culture', 1, '{"de":"Kultur","en":"Culture"}', '[]', 0) $$,
  'ops insert a version');
select lives_ok($$ update public.questionnaire_items set de_reviewed = true where id = 'iso45001@1/1' $$,
  'ops update an item');
select throws_ok(
  $$ insert into public.questionnaire_versions (key, questionnaire_key, version, title, sections, item_count)
     values ('culture@2', 'culture', 1, '{"de":"Kultur","en":"Culture"}', '[]', 0) $$,
  '23514', null, 'a version key that does not spell its questionnaire key and version is rejected');
select throws_ok(
  $$ insert into public.questionnaire_items (id, version_key, position, section_key, label, rateable, title, question)
     values ('wrong', 'culture@1', 1, 's1', '1.1', true, '{"de":"x","en":"x"}', '{"de":"x","en":"x"}') $$,
  '23514', null, 'an item id that is not <version key>/<position> is rejected');

-- Truncate and audit ---------------------------------------------------------------------------
select pg_temp.as_postgres();
select is_empty(
  $$ select r from (values ('anon'), ('authenticated'), ('service_role')) as roles(r)
     where has_table_privilege(r, 'public.questionnaire_versions', 'TRUNCATE')
        or has_table_privilege(r, 'public.questionnaire_items', 'TRUNCATE') $$,
  'truncate is revoked from the three app roles on both tables');
select is((select count(*) from public.audit_log where table_name in ('questionnaire_versions', 'questionnaire_items')), 0::bigint,
  'no audit row is written for the two content tables (kind G)');

select * from finish();
rollback;
