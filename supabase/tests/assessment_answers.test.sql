-- assessment_answers (spec 0019, AC-3, AC-4): no client policy at all, an expert reads the
-- answers of their own assessments and writes only on their own open draft while assigned, the
-- two exclusivity checks and the two partial unique indexes, the completeness count skipping an
-- excluded section, the lock once the parent is submitted (for the expert, ops and the service
-- role alike), an ended assignment, anon, and the audit trail.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- The suite assumes a database freshly reset (`pnpm db:reset`): it inserts fixtures with fixed
-- keys and counts rows globally.
do $$
begin
  if exists (select 1 from public.organizations
             where id not in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
     or exists (select 1 from public.companies)
     or exists (select 1 from public.expert_assignments)
     or exists (select 1 from public.assessments)
     or exists (select 1 from public.assessment_answers) then
    raise exception 'this database holds rows beyond the seed; run `pnpm db:reset` before the tests';
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

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'expert2@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'expert2@test.local', 'active', now());

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');
insert into public.companies (id, organization_id, name, created_by) values
  ('0c000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', 'Company A', 'a0000000-0000-4000-8000-000000000001'),
  ('0c000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', 'Company B', 'b0000000-0000-4000-8000-000000000001');

-- Both experts are assigned to A: expert 1 writes the assessments, expert 2 is a colleague on
-- the same client who must read none of expert 1's answers. Nobody is assigned to B.
insert into public.expert_assignments (id, organization_id, expert_id, assigned_by) values
  ('0e000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-000000000000',
   'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('0e000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-000000000000',
   'e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001');

-- Expert 1 starts an ISO 45001 draft and a Compliance draft for A through the policies; ops
-- create an ISO 45001 draft for B in expert 2's name (an assessment whose expert is not assigned
-- to its organization, the shape an ended assignment leaves behind).
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
insert into public.assessments (id, organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id) values
  ('ad000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'iso45001', 'iso45001@1', 'e0000000-0000-4000-8000-000000000001'),
  ('ad000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'compliance', 'compliance@1', 'e0000000-0000-4000-8000-000000000001');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
insert into public.assessments (id, organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id) values
  ('ad000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'iso45001', 'iso45001@1', 'e0000000-0000-4000-8000-000000000002');

-- The row shape: an item answer or a section exclusion, never both, never neither -------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, section_key, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/1', 'c4', 'compliant') $$,
  '23514', null, 'a row with both an item and a section is refused');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, note)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'x') $$,
  '23514', null, 'a row with neither is refused');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, section_key, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'c4', 'compliant') $$,
  '23514', null, 'a section exclusion cannot carry a rating');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/1', 'yes') $$,
  '23514', null, 'a rating outside the three codes is refused');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, note)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/1', repeat('x', 4001)) $$,
  '23514', null, 'a note longer than 4000 characters is refused');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/999', 'compliant') $$,
  '23503', null, 'an item that does not exist is refused');

-- The expert writes on their own open draft ----------------------------------------------------
select lives_ok(
  $$ insert into public.assessment_answers (id, organization_id, assessment_id, item_id, rating)
     values ('a1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/1', 'compliant') $$,
  'the expert rates clause 4.1 on their draft');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/1', 'partial') $$,
  '23505', null, 'a second answer row for the same item is refused: one row per item, updated in place');
select lives_ok(
  $$ insert into public.assessment_answers (id, organization_id, assessment_id, section_key, note)
     values ('a1000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'c4', 'no such site function') $$,
  'the expert excludes a section with a note (whether a questionnaire allows it is the catalogue''s rule, not the table''s)');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, section_key)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'c4') $$,
  '23505', null, 'a second exclusion row for the same section is refused');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0b000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/2', 'compliant') $$,
  '42501', null, 'an answer row must carry its assessment''s organization: another organization is refused');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0b000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000003', 'iso45001@1/1', 'compliant') $$,
  '42501', null, 'the expert cannot write on another expert''s assessment');
select is((select count(*) from public.assessment_answers), 2::bigint, 'the expert reads the two rows of their own draft');

-- A colleague assigned to the same client reads the assessment, never its answers -------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is((select count(*) from public.assessments), 3::bigint,
  'expert 2 reads the two assessments of A (assigned) and the one of B in their own name');
select is((select count(*) from public.assessment_answers where assessment_id = 'ad000000-0000-4000-8000-000000000001'), 0::bigint,
  'but reads no answer of expert 1''s draft on the same client');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/2', 'compliant') $$,
  '42501', null, 'and cannot write on it');
select is(pg_temp.affected($$ update public.assessment_answers set rating = 'partial' where id = 'a1000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'nor update its rows (zero rows)');
select is(pg_temp.affected($$ delete from public.assessment_answers where id = 'a1000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'nor delete them (zero rows)');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0b000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000003', 'iso45001@1/1', 'compliant') $$,
  '42501', null, 'expert 2 cannot write on their own assessment of B either: they are not assigned to B');

-- Ops write anywhere; the expert of that assessment reads it ---------------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.assessment_answers (id, organization_id, assessment_id, item_id, rating)
     values ('a1000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000003', 'iso45001@1/1', 'non_compliant') $$,
  'ops write an answer on the B assessment');
select is((select count(*) from public.assessment_answers), 3::bigint, 'ops read every answer');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is((select count(*) from public.assessment_answers), 1::bigint,
  'expert 2 reads the one answer of the assessment in their name, though they cannot write it');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.assessment_answers), 2::bigint, 'expert 1 still reads only their own two');

-- No client policy at all (AC-10) ----------------------------------------------------------------
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assessments), 2::bigint, 'a member of A reads the two assessments of A');
select is((select count(*) from public.assessment_answers), 0::bigint, 'and zero answer rows, of their own organization included');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/2', 'compliant') $$,
  '42501', null, 'a client member cannot insert an answer');
select is(pg_temp.affected($$ update public.assessment_answers set rating = 'partial' where id = 'a1000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'nor update one (zero rows)');
select is(pg_temp.affected($$ delete from public.assessment_answers where id = 'a1000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'nor delete one (zero rows)');
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assessment_answers), 0::bigint, 'a member of B reads no answer either');
select pg_temp.as_anon();
select is((select count(*) from public.assessment_answers), 0::bigint, 'anon reads no answer');

-- The expert edits and deletes on their open draft --------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select lives_ok(
  $$ update public.assessment_answers set rating = 'partial', note = 'procedure exists, not followed on the night shift'
     where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'the expert changes a rating and adds a note');
select lives_ok(
  $$ delete from public.assessment_answers where id = 'a1000000-0000-4000-8000-000000000002' $$,
  'the expert includes the section again by deleting the exclusion row');
select is((select count(*) from public.assessment_answers where item_id is null), 0::bigint, 'no exclusion row is left');

-- The completeness count skips an excluded section (AC-4) -----------------------------------------
select throws_like(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000002' $$,
  '%assessment_incomplete: 327 items unrated%',
  'the Compliance draft needs all 327 requirements rated');
select lives_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, section_key, note)
     select '0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000002', s ->> 'key', 'not present on this site'
     from public.questionnaire_versions v, jsonb_array_elements(v.sections) s
     where v.key = 'compliance@1' and s ->> 'key' <> 'effective_communication' $$,
  'the expert excludes 17 of the 18 standards');
select throws_like(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000002' $$,
  '%assessment_incomplete: 8 items unrated%',
  'only the 8 requirements of the remaining standard are still required');
select lives_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     select '0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000002', i.id, 'compliant'
     from public.questionnaire_items i
     where i.version_key = 'compliance@1' and i.section_key = 'effective_communication' $$,
  'the expert rates those 8');
select lives_ok(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000002' $$,
  'and submits');

-- The lock (AC-4): nothing changes an answer of a submitted assessment, whoever asks -------------
select throws_like(
  $$ insert into public.assessment_answers (organization_id, assessment_id, section_key)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000002', 'x') $$,
  '%assessment_locked: ad000000-0000-4000-8000-000000000002%',
  'the expert''s late insert is refused with assessment_locked (the trigger fires before the policy)');
select is(pg_temp.affected($$ update public.assessment_answers set rating = 'partial' where assessment_id = 'ad000000-0000-4000-8000-000000000002' $$), 0::bigint,
  'the expert''s update no longer reaches the rows (zero rows)');
select is(pg_temp.affected($$ delete from public.assessment_answers where assessment_id = 'ad000000-0000-4000-8000-000000000002' $$), 0::bigint,
  'nor their delete (zero rows)');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select throws_like(
  $$ update public.assessment_answers set rating = 'partial' where assessment_id = 'ad000000-0000-4000-8000-000000000002' $$,
  '%assessment_locked%', 'ops are refused too');
select pg_temp.as_service_role();
select throws_like(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000002', 'compliance@1/1', 'compliant') $$,
  '%assessment_locked%', 'the service role cannot insert on a submitted assessment');
select throws_like(
  $$ update public.assessment_answers set rating = 'partial' where assessment_id = 'ad000000-0000-4000-8000-000000000002' $$,
  '%assessment_locked%', 'nor update');
select throws_like(
  $$ delete from public.assessment_answers where assessment_id = 'ad000000-0000-4000-8000-000000000002' $$,
  '%assessment_locked%', 'nor delete');
select throws_like(
  $$ update public.assessment_answers set assessment_id = 'ad000000-0000-4000-8000-000000000001'
     where assessment_id = 'ad000000-0000-4000-8000-000000000002' and item_id is not null $$,
  '%assessment_locked%', 'nor move a row out of it to a draft');
select lives_ok(
  $$ update public.assessment_answers set note = 'reviewed by ops' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'the service role still writes on a draft: the lock is about the parent''s state, not the role');
select is((select count(*) from public.assessment_answers where assessment_id = 'ad000000-0000-4000-8000-000000000002'), 25::bigint,
  'the submitted set is intact: 17 exclusions and 8 ratings');

-- An ended assignment closes the draft ------------------------------------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
update public.expert_assignments set status = 'ended' where id = '0e000000-0000-4000-8000-0000000000a1';
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select throws_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/2', 'compliant') $$,
  '42501', null, 'an expert whose assignment ended cannot write the draft');
select is(pg_temp.affected($$ update public.assessment_answers set rating = 'compliant' where id = 'a1000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'nor update what they wrote (zero rows)');
select is((select count(*) from public.assessment_answers where assessment_id = 'ad000000-0000-4000-8000-000000000001'), 1::bigint,
  'but still reads it: the rows are theirs');

-- Audit --------------------------------------------------------------------------------------------
select pg_temp.as_postgres();
select results_eq(
  $$ select actor_id, actor_role, organization_id, action from public.audit_log
     where table_name = 'assessment_answers' and row_id = 'a1000000-0000-4000-8000-000000000001' order by id $$,
  $$ values ('e0000000-0000-4000-8000-000000000001'::uuid, 'expert', '0a000000-0000-4000-8000-000000000000'::uuid, 'insert'),
            ('e0000000-0000-4000-8000-000000000001'::uuid, 'expert', '0a000000-0000-4000-8000-000000000000'::uuid, 'update'),
            (null::uuid, 'service', '0a000000-0000-4000-8000-000000000000'::uuid, 'update') $$,
  'the rating, the expert''s edit and the service role''s edit are each audited once with their actor');
select is((select count(*) from public.audit_log where table_name = 'assessment_answers' and row_id = 'a1000000-0000-4000-8000-000000000002'),
  2::bigint, 'the exclusion and its removal are both in the log');
select is((select count(*) from public.audit_log where table_name = 'assessment_answers' and action = 'insert'), 28::bigint,
  'every insert that landed is audited: 3 by hand plus 17 exclusions plus 8 ratings; refused writes leave no row');

select * from finish();
rollback;
