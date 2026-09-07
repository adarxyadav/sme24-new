-- orders, order_events and invoices: a client buys for their own organization and can never
-- change an order afterwards; ops settle and cancel; an assigned expert reads neither the order
-- nor the invoice (the deliberate deviation from the tenant table contract); another tenant sees
-- nothing; an issued invoice is immutable and order_events is append only.
-- Spec 0011 AC-2, AC-3, AC-7, AC-12, AC-13, invariants 1, 4, 5, 7, 8, 9.
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

-- The suite assumes a database freshly reset (`pnpm db:reset`).
do $$
begin
  if exists (select 1 from public.organizations
             where id not in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
     or exists (select 1 from public.companies)
     or exists (select 1 from public.orders)
     or exists (select 1 from public.invoices)
     or exists (select 1 from public.order_events)
     or exists (select 1 from public.stripe_events) then
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

create function pg_temp.affected(statement text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

-- Fixtures: two organizations, an expert assigned to A, ops, a company in each.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000002', 'a-member@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'member'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');
insert into public.expert_assignments (organization_id, expert_id, assigned_by) values
  ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
insert into public.companies (id, organization_id, name, created_by) values
  ('0c000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', 'Company A', 'a0000000-0000-4000-8000-000000000001'),
  ('0c000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', 'Company B', 'b0000000-0000-4000-8000-000000000001');

-- ─── A member buys for their own organization (AC-1, AC-11) ───────────────────────────────────
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');

select lives_ok(
  $$ insert into public.orders (id, organization_id, company_id, package_key, reference,
       payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
       billing_name, billing_street, billing_postcode, billing_town, locale, created_by)
     values ('0e000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000',
       '0c000000-0000-4000-8000-00000000000a', 'culture', 'SME24-2026-0001', 'card',
       200000, 0.081, 16200, 216200, 'Safety Culture', 'Company A', 'Bahnhofstrasse 1', '8001',
       'Zurich', 'de', 'a0000000-0000-4000-8000-000000000002') $$,
  'a member creates a pending order for their own company');

select is((select status from public.orders where id = '0e000000-0000-4000-8000-000000000001'),
  'pending', 'a new order is pending');

-- The money invariant lives in the database (AC-2, invariant 1).
select throws_ok(
  $$ insert into public.orders (organization_id, company_id, package_key, reference,
       payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
       billing_name, billing_street, billing_postcode, billing_town, locale, created_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a',
       'culture', 'SME24-2026-0002', 'card', 200000, 0.081, 16200, 999999, 'Safety Culture',
       'Company A', 'Bahnhofstrasse 1', '8001', 'Zurich', 'de',
       'a0000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'gross must equal net plus vat');

-- A member may not buy for another organization, nor name someone else as creator.
select throws_ok(
  $$ insert into public.orders (organization_id, company_id, package_key, reference,
       payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
       billing_name, billing_street, billing_postcode, billing_town, locale, created_by)
     values ('0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b',
       'culture', 'SME24-2026-0003', 'card', 200000, 0.081, 16200, 216200, 'Safety Culture',
       'Company B', 'Street', '3000', 'Bern', 'de', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a member cannot create an order for another organization');

select throws_ok(
  $$ insert into public.orders (organization_id, company_id, package_key, reference,
       payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
       billing_name, billing_street, billing_postcode, billing_town, locale, created_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a',
       'culture', 'SME24-2026-0004', 'card', 200000, 0.081, 16200, 216200, 'Safety Culture',
       'Company A', 'Street', '8001', 'Zurich', 'de', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a member cannot name another user as the creator');

-- A member may never update an order: the grant is revoked outright (AC-12, AC-13).
select throws_ok(
  $$ update public.orders set status = 'paid' where id = '0e000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot mark their own order paid');

select throws_ok(
  $$ update public.orders set gross_rappen = 1 where id = '0e000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot change an order amount');

-- A client records their own creation event and nothing else (AC-13).
select lives_ok(
  $$ insert into public.order_events (organization_id, order_id, to_status, actor_id, actor_role)
     values ('0a000000-0000-4000-8000-000000000000', '0e000000-0000-4000-8000-000000000001',
       'pending', 'a0000000-0000-4000-8000-000000000002', 'client') $$,
  'a member records the creation of their own order');

select throws_ok(
  $$ insert into public.order_events (organization_id, order_id, to_status, actor_id, actor_role)
     values ('0a000000-0000-4000-8000-000000000000', '0e000000-0000-4000-8000-000000000001',
       'paid', 'a0000000-0000-4000-8000-000000000002', 'client') $$,
  '42501', null, 'a client cannot record a paid event');

select throws_ok(
  $$ insert into public.order_events (organization_id, order_id, to_status, actor_id, actor_role)
     values ('0a000000-0000-4000-8000-000000000000', '0e000000-0000-4000-8000-000000000001',
       'pending', 'a0000000-0000-4000-8000-000000000002', 'ops') $$,
  '42501', null, 'a client cannot claim the ops actor role');

-- order_events is append only for every app role (invariant 8).
select throws_ok(
  $$ update public.order_events set reason = 'rewritten'
     where order_id = '0e000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot update an order event');

select throws_ok(
  $$ delete from public.order_events where order_id = '0e000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a client cannot delete an order event');

-- A client never writes an invoice.
select throws_ok(
  $$ insert into public.invoices (organization_id, order_id, number, due_date, seller_name,
       seller_address, seller_uid, seller_iban, qr_reference)
     values ('0a000000-0000-4000-8000-000000000000', '0e000000-0000-4000-8000-000000000001',
       '2026-0001', current_date + 30, 'SME24', 'Street', 'CHE-1', 'CH9300762011623852957',
       'RF1820260001') $$,
  '42501', null, 'a client cannot issue an invoice');

-- ─── Another tenant sees nothing (AC-12) ─────────────────────────────────────────────────────
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');

select is((select count(*) from public.orders), 0::bigint,
  'a client of another organization sees no orders');
select is((select count(*) from public.order_events), 0::bigint,
  'a client of another organization sees no order events');

-- ─── The service role settles the order and issues the invoice ───────────────────────────────
select pg_temp.as_service_role();

select lives_ok(
  $$ update public.orders set status = 'paid', paid_at = now(),
       stripe_checkout_session_id = 'cs_test_1', stripe_payment_intent_id = 'pi_test_1'
     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'the service role marks the order paid');

select lives_ok(
  $$ insert into public.order_events (organization_id, order_id, from_status, to_status, actor_role)
     values ('0a000000-0000-4000-8000-000000000000', '0e000000-0000-4000-8000-000000000001',
       'pending', 'paid', 'service') $$,
  'the service role records the paid event');

-- The number is drawn from the sequence, exactly as public.settle_order draws it, never written
-- as a literal: a hand picked '2026-0001' would take the string the sequence has not issued yet,
-- and the settle_order tests further down would then collide on invoices_number_key.
select lives_ok(
  $$ insert into public.invoices (id, organization_id, order_id, number, due_date, seller_name,
       seller_address, seller_uid, seller_iban, qr_reference)
     select '0f000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000',
       '0e000000-0000-4000-8000-000000000001', n, current_date + 30, 'SME24 AG',
       'Bahnhofstrasse 1, 8001 Zurich', 'CHE-101.654.423 MWST', 'CH9300762011623852957',
       public.scor_reference(replace(n, '-', ''))
     from (select extract(year from now() at time zone 'Europe/Zurich')::integer
       || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0') as n) drawn $$,
  'the service role issues the invoice');

-- One invoice per order (invariant 4).
select throws_ok(
  $$ insert into public.invoices (organization_id, order_id, number, due_date, seller_name,
       seller_address, seller_uid, seller_iban, qr_reference)
     values ('0a000000-0000-4000-8000-000000000000', '0e000000-0000-4000-8000-000000000001',
       '2026-0002', current_date + 30, 'SME24 AG', 'Street', 'CHE-101.654.423', 
       'CH9300762011623852957', 'RF1820260002') $$,
  '23505', null, 'an order cannot have two invoices');

-- The state machine (invariant 9): the same status twice is rejected, which is what makes a
-- duplicate webhook harmless, and paid never goes back to pending.
select throws_ok(
  $$ update public.orders set status = 'paid' where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an order cannot be marked paid twice');

select throws_ok(
  $$ update public.orders set status = 'pending' where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a paid order cannot go back to pending');

-- One order per Stripe session (invariant 5).
select throws_ok(
  $$ insert into public.orders (organization_id, company_id, package_key, reference,
       payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
       billing_name, billing_street, billing_postcode, billing_town, locale,
       stripe_checkout_session_id)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a',
       'culture', 'SME24-2026-0005', 'card', 200000, 0.081, 16200, 216200, 'Safety Culture',
       'Company A', 'Street', '8001', 'Zurich', 'de', 'cs_test_1') $$,
  '23505', null, 'two orders cannot share one Stripe session');

-- An issued invoice is immutable except for its PDF columns and cancelled_at (invariant 7).
select lives_ok(
  $$ update public.invoices set pdf_path = 'invoices/a/1.pdf', pdf_rendered_at = now()
     where id = '0f000000-0000-4000-8000-000000000001' $$,
  'the render task records the pdf path');

select throws_ok(
  $$ update public.invoices set number = '2026-9999'
     where id = '0f000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an invoice number can never be changed, not even by the service role');

select throws_ok(
  $$ update public.invoices set seller_uid = 'CHE-000.000.000'
     where id = '0f000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the frozen seller facts can never be changed');

-- A stripe event is recorded at most once (invariant 6, AC-7).
select lives_ok(
  $$ insert into public.stripe_events (event_id, type, payload)
     values ('evt_test_1', 'checkout.session.completed', '{"id":"evt_test_1"}'::jsonb) $$,
  'the service role records a stripe event');

select throws_ok(
  $$ insert into public.stripe_events (event_id, type, payload)
     values ('evt_test_1', 'checkout.session.completed', '{"id":"evt_test_1"}'::jsonb) $$,
  '23505', null, 'the same stripe event cannot be recorded twice');

-- ─── The buyer reads their order, its history and its invoice ────────────────────────────────
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');

select is((select count(*) from public.orders), 1::bigint, 'the buyer reads their own order');
select is((select status from public.orders where id = '0e000000-0000-4000-8000-000000000001'),
  'paid', 'the buyer sees the order as paid');
select is((select count(*) from public.invoices), 1::bigint, 'the buyer reads their own invoice');
select is((select count(*) from public.order_events), 2::bigint,
  'the buyer reads the full history of their order');
select is((select count(*) from public.stripe_events), 0::bigint,
  'a client never reads the stripe event log');
select is((select count(*) from public.packages), 4::bigint,
  'a signed in client reads the package catalogue');

-- The buyer cannot rewrite the invoice either. The column grant lets the statement through, so
-- the ops only update policy is what stops it: RLS filters every row rather than raising, which
-- is the correct shape (a raise would confirm the row exists).
select is(pg_temp.affected(
  $$ update public.invoices set pdf_path = 'elsewhere.pdf'
     where id = '0f000000-0000-4000-8000-000000000001' $$),
  0::bigint, 'a client changes no invoice row, not even its pdf path');
select is((select pdf_path from public.invoices where id = '0f000000-0000-4000-8000-000000000001'),
  'invoices/a/1.pdf', 'the invoice pdf path is untouched after the client attempt');

select throws_ok(
  $$ update public.packages set price_rappen = 1 where key = 'culture' $$,
  '42501', null, 'a client cannot change a package price');

-- ─── An assigned expert reads neither orders nor invoices (AC-12, the deviation) ─────────────
-- An expert is not a member of the tenant, so their token carries no organization_id claim; the
-- assignment is what would normally let them read (private.is_assigned_expert), and these three
-- tables deliberately have no such policy.
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');

select is((select count(*) from public.orders), 0::bigint,
  'an assigned expert reads no orders, the deliberate deviation from the tenant contract');
select is((select count(*) from public.invoices), 0::bigint,
  'an assigned expert reads no invoices');
select is((select count(*) from public.order_events), 0::bigint,
  'an assigned expert reads no order events');

-- ─── Ops see everything and settle a bank transfer ───────────────────────────────────────────
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops', null);

select is((select count(*) from public.orders), 1::bigint, 'ops read every order');
select is((select count(*) from public.invoices), 1::bigint, 'ops read every invoice');
select is((select count(*) from public.stripe_events), 1::bigint, 'ops read the stripe event log');

select lives_ok(
  $$ update public.invoices set pdf_failed_at = now()
     where id = '0f000000-0000-4000-8000-000000000001' $$,
  'ops record a failed render so it can be retried');

select throws_ok(
  $$ update public.invoices set number = '2026-8888'
     where id = '0f000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot change an invoice number either');

select throws_ok(
  $$ delete from public.invoices where id = '0f000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'an invoice is never deleted, only cancelled');

select throws_ok(
  $$ update public.order_events set reason = 'rewritten'
     where order_id = '0e000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'ops cannot rewrite an order event either');

select throws_ok(
  $$ insert into public.stripe_events (event_id, type, payload)
     values ('evt_ops', 'checkout.session.completed', '{}'::jsonb) $$,
  '42501', null, 'ops cannot write the stripe event log');

-- ─── Anonymous visitors see nothing ──────────────────────────────────────────────────────────
select pg_temp.as_anon();

select is((select count(*) from public.orders), 0::bigint, 'an anonymous visitor sees no orders');
select is((select count(*) from public.invoices), 0::bigint, 'an anonymous visitor sees no invoices');
select is((select count(*) from public.packages), 0::bigint,
  'an anonymous visitor sees no packages: the pricing page renders from the message catalogs');

-- ─── settle_order: the shared resumable core (AC-9, AC-18, invariants 3, 13, 14) ─────────────
select pg_temp.as_service_role();

-- A second pending order, settled through the function rather than by hand.
insert into public.orders (id, organization_id, company_id, package_key, reference,
  payment_method, net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot,
  billing_name, billing_street, billing_postcode, billing_town, locale)
values ('0e000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000',
  '0c000000-0000-4000-8000-00000000000a', 'sms', 'SME24-2026-0010', 'card',
  500000, 0.081, 40500, 540500, 'Safety Management System', 'Company A', 'Street', '8001',
  'Zurich', 'de');

select is(
  (select already_settled from public.settle_order('0e000000-0000-4000-8000-000000000002',
     '2026-09-07T10:00:00Z'::timestamptz, null, 'service', 'SME24 AG', 'Street 1, 8001 Zurich',
     'CHE-101.654.423 MWST', 'CH9300762011623852957', 30)),
  false, 'the first settle issues the invoice');

select is((select status from public.orders where id = '0e000000-0000-4000-8000-000000000002'),
  'paid', 'settle_order moves the order to paid');

-- The resume path: calling again after a crash returns the same invoice and draws no new number.
select is(
  (select already_settled from public.settle_order('0e000000-0000-4000-8000-000000000002',
     '2026-09-07T10:00:00Z'::timestamptz, null, 'service', 'SME24 AG', 'Street 1, 8001 Zurich',
     'CHE-101.654.423 MWST', 'CH9300762011623852957', 30)),
  true, 'a retry reports the order as already settled');

select is((select count(*) from public.invoices where order_id = '0e000000-0000-4000-8000-000000000002'),
  1::bigint, 'a retry issues no second invoice');

select is((select count(*) from public.order_events
           where order_id = '0e000000-0000-4000-8000-000000000002' and to_status = 'paid'),
  1::bigint, 'a retry writes no second paid event');

-- The reference on the invoice is the SCOR reference of its own number, and it verifies.
select is(
  (select qr_reference from public.invoices where order_id = '0e000000-0000-4000-8000-000000000002'),
  (select public.scor_reference(replace(number, '-', '')) from public.invoices
   where order_id = '0e000000-0000-4000-8000-000000000002'),
  'the qr reference is derived from the invoice number');

-- A client actor role is refused outright.
select throws_ok(
  $$ select public.settle_order('0e000000-0000-4000-8000-000000000002', now(), null, 'client',
       'S', 'A', 'U', 'CH9300762011623852957', 30) $$,
  'SM403', null, 'settle_order refuses a client actor role');

select throws_ok(
  $$ select public.settle_order('00000000-0000-4000-8000-000000000000', now(), null, 'service',
       'S', 'A', 'U', 'CH9300762011623852957', 30) $$,
  'SM404', null, 'settle_order raises on an unknown order');

-- Invoice numbers are gapless and strictly increasing across both payment paths (invariant 3).
select is((select count(distinct number) from public.invoices), (select count(*) from public.invoices),
  'every invoice number is unique');

-- No client may call the function at all.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ select public.settle_order('0e000000-0000-4000-8000-000000000002', now(), null, 'service',
       'S', 'A', 'U', 'CH9300762011623852957', 30) $$,
  '42501', null, 'a client cannot execute settle_order');

select pg_temp.as_postgres();
select * from finish();
rollback;
