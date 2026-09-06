-- Orders (spec 0011, kind T: tenant). One row per package purchase, card or bank transfer.
-- Every amount is whole Rappen as bigint, never numeric and never a float, so no rounding drift
-- can occur (AC-2). The price, the VAT rate and the billing address are frozen onto the row at
-- purchase, so a later price change or a company edit never rewrites a past invoice.
--
-- DEVIATION FROM THE TENANT TABLE CONTRACT (spec 0002): there is deliberately NO
-- "assigned experts read" policy on this table, nor on public.invoices. An expert needs to know
-- that an assessment is booked, which feature 12 gives them through the assignment, not what the
-- client paid or where to invoice them. Money and billing data stay with the client and ops.
--
-- A client inserts a pending order and may never update one: every state change comes from the
-- webhook task (service role) or an ops action, so UPDATE is revoked from authenticated outright
-- with no column grant back (AC-12, AC-13).

-- The human order reference, SME24-<year>-<counter>. Drawn by the checkout action.
create sequence if not exists public.order_reference_seq as bigint start 1;
comment on sequence public.order_reference_seq is 'Supplies the counter in the SME24-<year>-<n> order reference. Not gapless by design: a burnt reference costs nothing, unlike an invoice number.';

-- Draws the next order reference, SME24-<year>-<counter>. The year is the server clock in
-- Europe/Zurich (spec 0011, Value sourcing), so a purchase just before midnight on 31 December
-- carries the year the buyer saw. Definer, because the sequence is not granted to the app roles;
-- a burnt reference costs nothing, unlike a burnt invoice number, so this may be called freely.
create or replace function public.next_order_reference()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'SME24-'
    || extract(year from (now() at time zone 'Europe/Zurich'))::integer
    || '-'
    || lpad(nextval('public.order_reference_seq')::text, 4, '0');
$$;

comment on function public.next_order_reference() is 'The next SME24-<year>-<counter> order reference; the year is the Europe/Zurich clock. Not gapless by design.';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Which company the assessment is for; restrict, so a company with orders cannot vanish.
  company_id uuid not null references public.companies (id) on delete restrict,
  package_key text not null references public.packages (key),
  -- SME24-2026-0042, allocated at creation and shown to the client and on the invoice.
  reference text not null unique check (reference ~ '^SME24-[0-9]{4}-[0-9]{4,}$'),
  -- Payment states only; delivery states (scheduled, in progress, delivered) are feature 12 and
  -- land as an additive change to this constraint.
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'refunded', 'expired')),
  payment_method text not null check (payment_method in ('card', 'bank_transfer')),
  -- The three money columns, all whole Rappen. gross = net + vat is a database invariant, not an
  -- application check: a wrong total cannot be persisted at all (AC-2, invariant 1).
  net_rappen bigint not null check (net_rappen > 0),
  vat_rate numeric(5, 4) not null check (vat_rate >= 0 and vat_rate < 1),
  vat_rappen bigint not null check (vat_rappen >= 0),
  gross_rappen bigint not null check (gross_rappen = net_rappen + vat_rappen),
  currency text not null default 'CHF' check (currency = 'CHF'),
  -- The package name in the buyer's language at purchase, for the invoice line item.
  package_name_snapshot text not null check (char_length(package_name_snapshot) between 1 and 200),
  -- The billing address, frozen at purchase. Deliberately independent of companies: the buyer is
  -- stating who to invoice, not correcting the research (spec 0011, Value sourcing).
  billing_name text not null check (char_length(billing_name) between 1 and 200),
  billing_street text not null check (char_length(billing_street) between 1 and 200),
  billing_postcode text not null check (char_length(billing_postcode) between 1 and 20),
  billing_town text not null check (char_length(billing_town) between 1 and 100),
  billing_country text not null default 'CH' check (billing_country ~ '^[A-Z]{2}$'),
  -- The buyer's CHE-... number when they have one; validated for shape and check digit by the
  -- pure isValidSwissUid helper in the action, not here.
  billing_uid text null check (billing_uid is null or char_length(billing_uid) between 12 and 30),
  -- Drives the Stripe locale, the invoice PDF and the purchase language.
  locale text not null check (locale in ('de', 'en')),
  -- Null on the bank transfer path; unique so one Stripe session yields exactly one order (AC-7).
  stripe_checkout_session_id text null unique,
  stripe_payment_intent_id text null,
  due_date date null,
  paid_at timestamptz null,
  cancelled_at timestamptz null,
  expires_at timestamptz null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.orders is 'One package purchase. Amounts are whole Rappen; price and billing address are frozen at purchase. pending → paid | expired | cancelled, and paid → refunded. Clients insert only; the webhook task and ops actions write every state change.';
comment on column public.orders.net_rappen is 'Net price excluding VAT in whole Rappen, copied from packages.price_rappen at purchase.';
comment on column public.orders.gross_rappen is 'net_rappen + vat_rappen, enforced by the check constraint. What Stripe charges and what the invoice totals.';
comment on column public.orders.reference is 'SME24-<year>-<counter> from public.order_reference_seq, shown to the client; the invoice carries its own separate gapless number.';
comment on column public.orders.stripe_checkout_session_id is 'Null until the session is created, which is what the sweep keys on: a pending card order with a null session id never reached Stripe and is expired outright after an hour.';
comment on column public.orders.billing_uid is 'The buyer''s CHE-###.###.### number, optionally suffixed MWST. Frozen billing data, deliberately independent of companies.uid.';

create index orders_organization_id_created_at_idx on public.orders (organization_id, created_at desc);
create index orders_company_id_created_at_idx on public.orders (company_id, created_at desc);
-- The sweep walks the open orders only.
create index orders_pending_idx on public.orders (status) where status = 'pending';
create index orders_created_by_idx on public.orders (created_by);
create index orders_package_key_idx on public.orders (package_key);

alter table public.orders enable row level security;

create policy "orders: members read their organization"
  on public.orders
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- A member buys for their own organization: their organization, themselves as creator, status
-- pending, and a company of that organization (the subquery runs under the member's own
-- companies policy). Amounts are not checked here; the action freezes them from packages and the
-- gross = net + vat constraint above is the real guard.
create policy "orders: members create a pending order for their organization"
  on public.orders
  for insert
  to authenticated
  with check (
    organization_id = (select private.jwt_org_id())
    and created_by = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.organization_id = orders.organization_id
    )
  );

-- No members update policy at all, and no assigned experts read policy (see the header).

create policy "orders: ops full access"
  on public.orders
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- The state machine (spec 0011, invariant 9). Fires only when an update names the status column,
-- so the follow up work may still write paid_at, the Stripe ids and the PDF columns on a row
-- whose status did not move.
create or replace function private.check_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status then
    raise exception 'orders status is already %', old.status
      using errcode = 'check_violation';
  end if;
  if (old.status = 'pending' and new.status in ('paid', 'cancelled', 'expired'))
     or (old.status = 'paid' and new.status = 'refunded') then
    return new;
  end if;
  raise exception 'invalid orders transition % -> %', old.status, new.status
    using errcode = 'check_violation';
end;
$$;

revoke execute on function private.check_order_transition() from public;

create trigger orders_check_transition
  before update of status on public.orders
  for each row execute function private.check_order_transition();

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger orders_audit
  after insert or update or delete on public.orders
  for each row execute function private.audit_row();

-- A client inserts an order and may never change one: every state change comes from the webhook
-- task (service role) or an ops action. UPDATE is revoked from authenticated with nothing granted
-- back, unlike research_runs which grants five columns. Ops keep full access through the policy
-- but share the grant, which is why ops writes go through the service client.
revoke update, delete on public.orders from anon, authenticated;

-- TRUNCATE walks around RLS and fires no row trigger; Supabase hands it to all three app roles at
-- creation. On money rows it would erase the bookkeeping trail, so it is revoked from every role.
revoke truncate on public.orders from anon, authenticated, service_role;

-- The checkout action draws a reference before inserting the order, so signed in clients execute
-- it; anonymous visitors never do. The declarative diff does not emit the anon revoke on a new
-- public function and Supabase's default privileges grant execute to both app roles, so the
-- migration revokes anon by hand (AGENTS.md).
revoke execute on function public.next_order_reference() from anon, public;
grant execute on function public.next_order_reference() to authenticated;
