-- Order delivery: the three states that follow paid, both database guards and the correction path.
-- The transition trigger owns every statement that moves the status; orders_check_delivery_columns
-- owns the corrections that leave it alone. Neither write path can leave a scheduled order without
-- a date or an assessor.
-- Spec 0014 AC-3, AC-4, AC-5, AC-6, AC-7, AC-7a, AC-8, AC-12, invariants 1, 2, 3, 5, 6.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- The suite assumes a database freshly reset (`pnpm db:reset`). Three worktrees have shared one
-- local stack in the past, so a reset can silently skip a migration: assert the columns exist
-- rather than failing later with a confusing error (spec 0014, Migration plan risks).
do $$
begin
  if exists (select 1 from public.organizations
             where id not in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
     or exists (select 1 from public.companies)
     or exists (select 1 from public.orders) then
    raise exception 'this database holds rows beyond the seed; run `pnpm db:reset` before the tests';
  end if;
end $$;

select has_column('public', 'orders', 'scheduled_at', 'orders has scheduled_at');
select has_column('public', 'orders', 'assigned_expert_id', 'orders has assigned_expert_id');
select has_column('public', 'orders', 'delivered_at', 'orders has delivered_at');
select has_column('public', 'orders', 'scheduled_by', 'orders has scheduled_by');
select has_index('public', 'orders', 'orders_paid_unscheduled_idx', 'the paid unscheduled queue is indexed');
select has_index('public', 'orders', 'orders_scheduled_at_idx', 'the scheduled queue is indexed');

create function pg_temp.impersonate(user_id uuid, app_role text, org_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', user_id, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', app_role, 'organization_id', org_id)))::text, true);
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

create function pg_temp.make_user(user_id uuid, email text, app_role text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    '{}', now(), now());
end $$;

-- Fixtures: one organization, one company, an active expert, a deactivated expert, ops.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'gone@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'gone@test.local', 'inactive', now());
insert into public.companies (id, organization_id, name, created_by) values
  ('0c000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', 'Company A', 'a0000000-0000-4000-8000-000000000001');

insert into public.orders (id, organization_id, company_id, package_key, reference,
  status, payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
  billing_name, billing_street, billing_postcode, billing_town, locale, paid_at)
values ('0e000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000',
  '0c000000-0000-4000-8000-00000000000a', 'culture', 'SME24-2026-0001', 'paid', 'card',
  200000, 0.081, 16200, 216200, 'Safety Culture', 'Company A', 'Bahnhofstrasse 1', '8001',
  'Zurich', 'de', now());

-- ─── The delivery writes are the service role's, behind an ops check in the action ───────────
select pg_temp.as_service_role();

-- AC-5: the future date check binds on the paid -> scheduled edge, and it is the database that
-- refuses, not the app.
select throws_ok(
  $$ update public.orders set status = 'scheduled', scheduled_at = now() - interval '1 day',
       assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a past date is refused on the paid -> scheduled edge');

-- Invariant 1: scheduled without an assessor, and without a date, are both refused.
select throws_ok(
  $$ update public.orders set status = 'scheduled', scheduled_at = now() + interval '7 days'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'scheduled without an assessor is refused');

select throws_ok(
  $$ update public.orders set status = 'scheduled',
       assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'scheduled without a date is refused');

-- AC-6: paid may not jump the delivery states.
select throws_ok(
  $$ update public.orders set status = 'in_progress', scheduled_at = now() + interval '7 days',
       assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'paid cannot jump straight to in_progress');

select throws_ok(
  $$ update public.orders set status = 'delivered', scheduled_at = now() + interval '7 days',
       assigned_expert_id = 'e0000000-0000-4000-8000-000000000001', delivered_at = now()
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'paid cannot jump straight to delivered');

-- AC-3: the happy path.
select lives_ok(
  $$ update public.orders set status = 'scheduled', scheduled_at = now() + interval '7 days',
       assigned_expert_id = 'e0000000-0000-4000-8000-000000000001',
       scheduled_by = 'c0000000-0000-4000-8000-000000000001'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'a paid order is scheduled with a future date and an assessor');

select is((select status from public.orders where id = '0e000000-0000-4000-8000-000000000001'),
  'scheduled', 'the order reads scheduled');
select isnt((select scheduled_at from public.orders where id = '0e000000-0000-4000-8000-000000000001'),
  null, 'the scheduled order carries its date');
select is((select scheduled_by from public.orders where id = '0e000000-0000-4000-8000-000000000001'),
  'c0000000-0000-4000-8000-000000000001'::uuid, 'the ops actor is recorded on the order');

-- The same status twice is refused, which is what makes two ops scheduling at once give one
-- success and one invalid_transition rather than a silent overwrite (AC-3, concurrency).
select throws_ok(
  $$ update public.orders set status = 'scheduled', scheduled_at = now() + interval '8 days',
       assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an order cannot be scheduled twice');

-- ─── The correction path: orders_check_delivery_columns (AC-7a) ──────────────────────────────
-- The status does not move, so orders_check_transition never fires; this is the only guard.
select lives_ok(
  $$ update public.orders set scheduled_at = now() + interval '14 days'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'ops correct the date on a scheduled order without moving its status');

select lives_ok(
  $$ update public.orders set assigned_expert_id = 'e0000000-0000-4000-8000-000000000002'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'ops correct the assessor on a scheduled order without moving its status');

-- The assessor is corrected back, so the rest of the suite runs on the active expert.
update public.orders set assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
where id = '0e000000-0000-4000-8000-000000000001';

select throws_ok(
  $$ update public.orders set assigned_expert_id = null
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'nulling the assessor alone on a scheduled order is refused');

select throws_ok(
  $$ update public.orders set scheduled_at = null
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'nulling the date alone on a scheduled order is refused');

-- ─── scheduled -> in_progress -> delivered (AC-6) ────────────────────────────────────────────
select lives_ok(
  $$ update public.orders set status = 'in_progress'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'a scheduled order moves to in_progress');

-- A correction on an in_progress order is legitimately in the past: the future date check binds
-- only on the paid -> scheduled edge, on purpose (spec 0014, State transitions).
select lives_ok(
  $$ update public.orders set scheduled_at = now() - interval '2 days'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'a past date is allowed when correcting an in_progress order, recording a visit after the fact');

-- Invariant 2: delivered requires delivered_at.
select throws_ok(
  $$ update public.orders set status = 'delivered'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'delivered without delivered_at is refused');

select lives_ok(
  $$ update public.orders set status = 'delivered', delivered_at = now()
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'an in_progress order is delivered');

select isnt((select delivered_at from public.orders where id = '0e000000-0000-4000-8000-000000000001'),
  null, 'the delivered order carries its delivered_at');

-- A correction still works on a delivered order (AC-7a names all three states).
select lives_ok(
  $$ update public.orders set scheduled_at = now() - interval '3 days'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'ops correct the date on a delivered order');

-- Delivered does not walk backwards, and delivered -> refunded is the one edge out (AC-6).
select throws_ok(
  $$ update public.orders set status = 'scheduled'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a delivered order cannot go back to scheduled');

select throws_ok(
  $$ update public.orders set status = 'in_progress'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a delivered order cannot go back to in_progress');

select lives_ok(
  $$ update public.orders set status = 'refunded'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'a delivered order is refunded, the one edge out');

-- ─── Unschedule: scheduled back to paid (AC-7) ───────────────────────────────────────────────
-- Its own order: the first one is refunded by now, and refunded -> paid is correctly refused.
insert into public.orders (id, organization_id, company_id, package_key, reference,
  status, payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
  billing_name, billing_street, billing_postcode, billing_town, locale, paid_at)
values ('0e000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000000',
  '0c000000-0000-4000-8000-00000000000a', 'culture', 'SME24-2026-0003', 'paid', 'card',
  200000, 0.081, 16200, 216200, 'Safety Culture', 'Company A', 'Street', '8001',
  'Zurich', 'de', now());

update public.orders set status = 'scheduled', scheduled_at = now() + interval '7 days',
  assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
where id = '0e000000-0000-4000-8000-000000000003';

-- Both columns must be cleared in the same statement, so paid never carries a stale date.
select throws_ok(
  $$ update public.orders set status = 'paid'
     where id = '0e000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'unscheduling without clearing the columns is refused');

select lives_ok(
  $$ update public.orders set status = 'paid', scheduled_at = null, assigned_expert_id = null
     where id = '0e000000-0000-4000-8000-000000000003' $$,
  'a scheduled order is unscheduled back to paid');

select is((select scheduled_at from public.orders where id = '0e000000-0000-4000-8000-000000000003'),
  null, 'unscheduling clears the date');
select is((select assigned_expert_id from public.orders where id = '0e000000-0000-4000-8000-000000000003'),
  null, 'unscheduling clears the assessor');

-- The delivery columns are refused on a paid order even when both are set, because the correction
-- trigger only ever accepts a row already in a delivery state.
select throws_ok(
  $$ update public.orders set scheduled_at = now() + interval '7 days',
       assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
     where id = '0e000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'the delivery columns cannot be written on a paid order without moving its status');

-- ─── The payment edges from spec 0011 still pass unchanged ───────────────────────────────────
insert into public.orders (id, organization_id, company_id, package_key, reference,
  payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
  billing_name, billing_street, billing_postcode, billing_town, locale)
values ('0e000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000',
  '0c000000-0000-4000-8000-00000000000a', 'sms', 'SME24-2026-0004', 'card',
  500000, 0.081, 40500, 540500, 'Safety Management System', 'Company A', 'Street', '8001',
  'Zurich', 'de');

select lives_ok(
  $$ update public.orders set status = 'paid', paid_at = now()
     where id = '0e000000-0000-4000-8000-000000000002' $$,
  'pending -> paid still passes, unchanged by the delivery edges');

select throws_ok(
  $$ update public.orders set status = 'pending'
     where id = '0e000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'paid still cannot go back to pending');

-- ─── AC-12: every delivery write is in the audit log through the existing trigger ────────────
select isnt((select count(*) from public.audit_log
             where table_name = 'orders' and 'status' = any(changed_columns)), 0::bigint,
  'the delivery writes are recorded in the audit log');

select ok((select count(*) from public.audit_log
           where table_name = 'orders' and 'scheduled_at' = any(changed_columns)) > 0,
  'a correction that moves no status is recorded in the audit log too');

-- ─── AC-8: no app role writes a delivery column ──────────────────────────────────────────────
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');

select throws_ok(
  $$ update public.orders set scheduled_at = now() + interval '7 days'
     where id = '0e000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'a client cannot write scheduled_at: UPDATE is revoked with no column granted back');

select throws_ok(
  $$ update public.orders set assigned_expert_id = 'e0000000-0000-4000-8000-000000000001'
     where id = '0e000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'a client cannot write assigned_expert_id');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');

select throws_ok(
  $$ update public.orders set status = 'delivered'
     where id = '0e000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'an expert cannot move an order into a delivery state');

-- Ops hold the policy but share the revoked grant, which is why ops writes go through the
-- service client (spec 0014, invariant 3).
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops', null);

select throws_ok(
  $$ update public.orders set scheduled_at = now() + interval '7 days'
     where id = '0e000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'even ops cannot write a delivery column with their own token');

select pg_temp.as_postgres();
select * from finish();
rollback;
