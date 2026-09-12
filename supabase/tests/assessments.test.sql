-- assessments (spec 0019, AC-3, AC-4): the security table row by row, the expert_bookings
-- boundary, the column grant, the draft -> submitted edge with its completeness count and the
-- submitted_at stamp, every other status change refused, one open draft per company and
-- questionnaire, the composite foreign key, anon reads nothing, and the audit trail.
--
-- The answers table has its own file (assessment_answers.test.sql); answers are inserted here
-- only as far as the completeness count needs them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

-- The suite assumes a database freshly reset (`pnpm db:reset`): it inserts fixtures with fixed
-- keys and counts rows globally. Fail with a clear message rather than a bad plan when a probe
-- left rows behind.
do $$
begin
  if exists (select 1 from public.organizations
             where id not in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
     or exists (select 1 from public.companies)
     or exists (select 1 from public.orders)
     or exists (select 1 from public.expert_assignments)
     or exists (select 1 from public.assessments)
     or exists (select 1 from public.assessment_answers) then
    raise exception 'this database holds rows beyond the seed; run `pnpm db:reset` before the tests';
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

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'expert2@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

-- Both experts need an `active` profile row, or check_expert_assignable (spec 0013) refuses the
-- assignment below for the wrong reason.
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

-- Expert 1 is assigned to A; expert 2 is assigned nowhere.
insert into public.expert_assignments (id, organization_id, expert_id, assigned_by) values
  ('0e000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-000000000000',
   'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');

-- Three orders: A1 is expert 1's booking for A, A2 is expert 2's booking for A (a scheduled order
-- names its assessor without an assignment row; spec 0014's action creates both), B1 is a paid
-- order of B nobody is the assessor of.
insert into public.orders (id, organization_id, company_id, package_key, reference,
  status, payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
  billing_name, billing_street, billing_postcode, billing_town, locale, paid_at)
values
  ('0d000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-000000000000',
   '0c000000-0000-4000-8000-00000000000a', 'sms', 'SME24-2026-0001', 'paid', 'card',
   500000, 0.081, 40500, 540500, 'Safety Management System', 'Company A', 'Bahnhofstrasse 1', '8001',
   'Zurich', 'de', now()),
  ('0d000000-0000-4000-8000-0000000000a2', '0a000000-0000-4000-8000-000000000000',
   '0c000000-0000-4000-8000-00000000000a', 'compliance', 'SME24-2026-0002', 'paid', 'card',
   800000, 0.081, 64800, 864800, 'Compliance', 'Company A', 'Bahnhofstrasse 1', '8001',
   'Zurich', 'de', now()),
  ('0d000000-0000-4000-8000-0000000000b1', '0b000000-0000-4000-8000-000000000000',
   '0c000000-0000-4000-8000-00000000000b', 'culture', 'SME24-2026-0003', 'paid', 'card',
   200000, 0.081, 16200, 216200, 'Safety Culture', 'Company B', 'Rue du Lac 2', '1000',
   'Lausanne', 'en', now());
update public.orders set status = 'scheduled', scheduled_at = now() + interval '7 days',
  assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
where id = '0d000000-0000-4000-8000-0000000000a1';
update public.orders set status = 'scheduled', scheduled_at = now() + interval '9 days',
  assigned_expert_id = 'e0000000-0000-4000-8000-000000000002'
where id = '0d000000-0000-4000-8000-0000000000a2';

-- Structure ---------------------------------------------------------------------------------
-- A definer view runs with its owner's rights; a migration that recreated it under another
-- owner would silently change who it reads as.
select is(
  (select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'expert_bookings'),
  'postgres'::name, 'expert_bookings is owned by postgres');
select hasnt_column('public', 'expert_bookings', 'net_rappen', 'the view carries no net amount');
select hasnt_column('public', 'expert_bookings', 'gross_rappen', 'nor the gross amount');
select hasnt_column('public', 'expert_bookings', 'billing_name', 'nor the billing address');
select hasnt_column('public', 'expert_bookings', 'stripe_checkout_session_id', 'nor a Stripe id');

-- The column grant (AC-3): status, site and conducted_on, nothing else, and no table level update.
select ok(not has_table_privilege('authenticated', 'public.assessments', 'UPDATE'),
  'authenticated holds no table level update on assessments');
select results_eq(
  $$ select a.attname from pg_attribute a
     where a.attrelid = 'public.assessments'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', 'public.assessments', a.attname, 'UPDATE')
     order by 1 $$,
  $$ values ('conducted_on'::name), ('site'::name), ('status'::name) $$,
  'authenticated may update exactly status, site and conducted_on');
select is_empty(
  $$ select r from (values ('anon'), ('authenticated'), ('service_role')) as roles(r)
     where has_table_privilege(r, 'public.assessments', 'TRUNCATE')
        or has_table_privilege(r, 'public.assessment_answers', 'TRUNCATE') $$,
  'truncate is revoked from the three app roles on both tables');

-- expert_bookings: own bookings, or ops -----------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select results_eq(
  $$ select id, package_key, status from public.expert_bookings $$,
  $$ values ('0d000000-0000-4000-8000-0000000000a1'::uuid, 'sms', 'scheduled') $$,
  'expert 1 reads the one booking they are the assessor of, with its package and state');
select is((select count(*) from public.orders), 0::bigint,
  'while the orders table itself shows them nothing: the view is the only way in');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select results_eq(
  $$ select id from public.expert_bookings $$,
  $$ values ('0d000000-0000-4000-8000-0000000000a2'::uuid) $$,
  'expert 2 reads only their own booking, not expert 1''s for the same organization');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select count(*) from public.expert_bookings), 0::bigint,
  'a client member reads nothing through the expert view, even of their own orders');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.expert_bookings), 2::bigint,
  'ops read every scheduled booking; the paid order without a date is not a booking yet');
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.expert_bookings $$, '42501', null,
  'an anonymous visitor is refused the view outright');

-- No client write --------------------------------------------------------------------------
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'iso45001', 'iso45001@1', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a client member cannot start an assessment, even for their own organization');

-- An expert without an assignment ------------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'iso45001', 'iso45001@1', 'e0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'an expert not assigned to the organization cannot start an assessment for it');

-- The assigned expert starts a draft -----------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select lives_ok(
  $$ insert into public.assessments (id, organization_id, company_id, order_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('ad000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a',
             '0d000000-0000-4000-8000-0000000000a1', 'iso45001', 'iso45001@1', 'e0000000-0000-4000-8000-000000000001') $$,
  'the assigned expert starts an ISO 45001 draft for a company of the organization, linked to their booking');
select results_eq(
  $$ select status, submitted_at, site, conducted_on from public.assessments where id = 'ad000000-0000-4000-8000-000000000001' $$,
  $$ values ('draft', null::timestamptz, null::text, null::date) $$,
  'a new assessment is a draft with nothing submitted');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'compliance', 'compliance@1', 'e0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'the expert cannot start a draft in another expert''s name');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id, status, submitted_at)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'compliance', 'compliance@1', 'e0000000-0000-4000-8000-000000000001', 'submitted', now()) $$,
  '42501', null, 'the expert cannot insert an assessment as already submitted');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'compliance', 'compliance@1', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'the expert cannot start a draft for a company of another organization');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, order_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-0000000000b1', 'compliance', 'compliance@1', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'the expert cannot link an order of another organization');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, order_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-0000000000a2', 'compliance', 'compliance@1', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'nor an order of the same organization that is another expert''s booking');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'compliance', 'iso45001@1', 'e0000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'the composite foreign key refuses a questionnaire_key that does not match the pinned version');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'iso45001', 'iso45001@1', 'e0000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a second ISO 45001 draft for the same company is refused (draft_exists)');
select lives_ok(
  $$ insert into public.assessments (id, organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('ad000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a',
             'compliance', 'compliance@1', 'e0000000-0000-4000-8000-000000000001') $$,
  'a Compliance draft for the same company is a different questionnaire and lives, without an order');

-- Reads -------------------------------------------------------------------------------------
select is((select count(*) from public.assessments), 2::bigint, 'the assigned expert reads both drafts');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is((select count(*) from public.assessments), 0::bigint, 'an expert of no organization reads nothing');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq(
  $$ select questionnaire_key, status from public.assessments order by questionnaire_key $$,
  $$ values ('compliance', 'draft'), ('iso45001', 'draft') $$,
  'a member of A reads the assessments of A: which questionnaire and its state');
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.assessments), 0::bigint, 'a member of B reads nothing of A');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select count(*) from public.assessments), 2::bigint, 'ops read every assessment');
select pg_temp.as_anon();
select is((select count(*) from public.assessments), 0::bigint, 'anon reads no assessment');

-- Client writes are filtered to zero rows ---------------------------------------------------
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is(pg_temp.affected($$ update public.assessments set site = 'Werk West' where id = 'ad000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'a client member cannot update an assessment (zero rows)');
select is(pg_temp.affected($$ delete from public.assessments where id = 'ad000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'a client member cannot delete an assessment (zero rows)');

-- The expert edits their own draft: three columns only ---------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select lives_ok(
  $$ update public.assessments set site = 'Werk Ost', conducted_on = '2026-09-15' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  'the expert records the site and the visit date on their draft');
select throws_ok(
  $$ update public.assessments set submitted_at = now() where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the expert cannot write submitted_at (column grant)');
select throws_ok(
  $$ update public.assessments set questionnaire_version_key = 'iso45001@1' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor the pinned version (column grant)');
select throws_ok(
  $$ update public.assessments set expert_id = 'e0000000-0000-4000-8000-000000000002' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'nor hand the draft to another expert (column grant)');
select is(pg_temp.affected($$ delete from public.assessments where id = 'ad000000-0000-4000-8000-000000000002' $$), 0::bigint,
  'the expert cannot delete their own draft (zero rows)');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is(pg_temp.affected($$ update public.assessments set site = 'x' where id = 'ad000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'another expert cannot update the draft (zero rows)');

-- Submit: the completeness count (AC-4) --------------------------------------------------------
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select throws_like(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '%assessment_incomplete: 27 items unrated%',
  'submitting with nothing rated names all 27 ISO 45001 clauses as unrated');
select throws_ok(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'and the refusal is a check_violation');
-- Rate every clause but the last one (10.3), as the expert, through the policies.
select lives_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     select '0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', i.id, 'compliant'
     from public.questionnaire_items i
     where i.version_key = 'iso45001@1' and i.rateable and i.parent_id is null and i.label <> '10.3' $$,
  'the expert rates 26 of the 27 clauses');
select lives_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating, note)
     select '0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', i.id, null, 'to check with the site manager'
     from public.questionnaire_items i where i.version_key = 'iso45001@1' and i.label = '10.3' $$,
  'and leaves a note without a rating on 10.3');
select lives_ok(
  $$ insert into public.assessment_answers (organization_id, assessment_id, item_id, rating)
     values ('0a000000-0000-4000-8000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'iso45001@1/11', 'compliant') $$,
  'and rates the annex sub item A.1 under 6.1.2.1');
select throws_like(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '%assessment_incomplete: 1 items unrated%',
  'a note without a rating is unrated and a sub item rating does not count: one item left');
select lives_ok(
  $$ update public.assessment_answers set rating = 'partial'
     where assessment_id = 'ad000000-0000-4000-8000-000000000001'
       and item_id = (select id from public.questionnaire_items where version_key = 'iso45001@1' and label = '10.3') $$,
  'the expert rates 10.3');
select lives_ok(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  'with every clause rated, the draft is submitted');
select results_eq(
  $$ select status, submitted_at is not null, submitted_at <= now() from public.assessments where id = 'ad000000-0000-4000-8000-000000000001' $$,
  $$ values ('submitted', true, true) $$,
  'the edge stamps submitted_at from the server clock');

-- Every other status change is refused ----------------------------------------------------------
select is(pg_temp.affected($$ update public.assessments set status = 'draft' where id = 'ad000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'the expert no longer reaches the submitted row through the update policy (zero rows)');
select is(pg_temp.affected($$ update public.assessments set site = 'Werk Nord' where id = 'ad000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'nor its site and date (zero rows)');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select throws_like(
  $$ update public.assessments set status = 'draft' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '%invalid assessments transition submitted -> draft on ad000000-0000-4000-8000-000000000001%',
  'ops cannot reopen a submitted assessment: there is no way back');
select throws_ok(
  $$ update public.assessments set status = 'draft' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'and that refusal is a check_violation too');
select lives_ok(
  $$ update public.assessments set status = 'submitted' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  'naming the same status again is not a change and passes');
select throws_ok(
  $$ update public.assessments set status = 'archived' where id = 'ad000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'a status outside draft and submitted is refused');
select pg_temp.as_service_role();
select throws_like(
  $$ update public.assessments set status = 'draft' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '%invalid assessments transition submitted -> draft%',
  'the service role is refused the reopen as well: the trigger does not care who asks');
select throws_ok(
  $$ update public.assessments set submitted_at = null where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a submitted row cannot lose its submitted_at (the consistency check)');

-- An ended assignment closes the draft to the expert ----------------------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
update public.expert_assignments set status = 'ended' where id = '0e000000-0000-4000-8000-0000000000a1';
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.assessments), 2::bigint,
  'the expert still reads their own rows after the assignment ended');
select is(pg_temp.affected($$ update public.assessments set site = 'x' where id = 'ad000000-0000-4000-8000-000000000002' $$), 0::bigint,
  'but can no longer edit the open draft (zero rows)');
select throws_ok(
  $$ insert into public.assessments (organization_id, company_id, questionnaire_key, questionnaire_version_key, expert_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'iso45001', 'iso45001@1', 'e0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'nor start a new one');

-- Ops reach everything through the policy, within the column grant ---------------------------------
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ update public.assessments set site = 'Werk Süd' where id = 'ad000000-0000-4000-8000-000000000002' $$,
  'ops update the site of a draft');
select throws_ok(
  $$ update public.assessments set expert_id = 'e0000000-0000-4000-8000-000000000002' where id = 'ad000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'ops share the column grant: a reassignment needs the service client');

-- Deleting the assessment itself still cascades to its answers ------------------------------------
select pg_temp.as_postgres();
select lives_ok(
  $$ delete from public.assessments where id = 'ad000000-0000-4000-8000-000000000001' $$,
  'the superuser deletes the submitted assessment (a tenant deletion cascades the same way)');
select is((select count(*) from public.assessment_answers where assessment_id = 'ad000000-0000-4000-8000-000000000001'), 0::bigint,
  'and its answers went with it: the lock guards the answers of a submitted assessment, not the assessment row');

-- Audit --------------------------------------------------------------------------------------------
-- updated_at never appears in changed_columns here: now() is fixed for the whole transaction, so
-- set_updated_at writes the value the row already carries. The ops no op changed nothing at all.
select results_eq(
  $$ select actor_id, actor_role, organization_id, action, changed_columns from public.audit_log
     where table_name = 'assessments' and row_id = 'ad000000-0000-4000-8000-000000000001' order by id $$,
  $$ values
       ('e0000000-0000-4000-8000-000000000001'::uuid, 'expert', '0a000000-0000-4000-8000-000000000000'::uuid, 'insert', null::text[]),
       ('e0000000-0000-4000-8000-000000000001'::uuid, 'expert', '0a000000-0000-4000-8000-000000000000'::uuid, 'update', array['conducted_on', 'site']),
       ('e0000000-0000-4000-8000-000000000001'::uuid, 'expert', '0a000000-0000-4000-8000-000000000000'::uuid, 'update', array['status', 'submitted_at']),
       ('c0000000-0000-4000-8000-000000000001'::uuid, 'ops', '0a000000-0000-4000-8000-000000000000'::uuid, 'update', null::text[]),
       (null::uuid, 'system', '0a000000-0000-4000-8000-000000000000'::uuid, 'delete', null::text[]) $$,
  'the start, the details, the submit, the ops no op and the delete are each audited once with their actor');
select is((select count(*) from public.audit_log where table_name = 'assessments'), 7::bigint,
  'no other audit row for the table beyond those five plus the second draft''s insert and ops edit');

select * from finish();
rollback;
