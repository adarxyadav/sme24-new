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
--
-- SECOND BUYER SHAPE (spec 0018, AC-7): an expert buys a credit pack for the contact directory on
-- this same rail. organization_id and company_id are then null and buyer_expert_id names the
-- buyer; orders_check_buyer holds exactly one shape per row. Every client policy compares
-- organization_id to the token's organization, which is false for null, so no client ever sees
-- an expert order, and an expert reads only the rows where they are the buyer. `credits` is
-- frozen from packages.credits at purchase and is what settle_order grants; the expert insert
-- policy is what ties it to the package, because UPDATE is revoked and no check constraint can
-- read another table. An expert order never enters a delivery state (check_order_transition).

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
  -- Null for an expert buyer (spec 0018).
  organization_id uuid null references public.organizations (id) on delete cascade,
  -- Which company the assessment is for; restrict, so a company with orders cannot vanish. Null
  -- with organization_id.
  company_id uuid null references public.companies (id) on delete restrict,
  -- The expert who bought a credit pack (spec 0018); restrict, because an order is kept ten years
  -- and a profile is anonymised, never deleted.
  buyer_expert_id uuid null references public.profiles (id) on delete restrict,
  -- The directory credits this purchase grants, frozen from packages.credits like the price, so a
  -- resized pack never changes what a pending invoice buyer receives. Null on a client order.
  credits integer null check (credits is null or credits > 0),
  package_key text not null references public.packages (key),
  -- SME24-2026-0042, allocated at creation and shown to the client and on the invoice.
  reference text not null unique check (reference ~ '^SME24-[0-9]{4}-[0-9]{4,}$'),
  -- Payment states and, since spec 0014, the three delivery states that follow paid. One column
  -- carries both concerns on purpose; splitting them is a Follow-up in that spec.
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'refunded', 'expired', 'scheduled', 'in_progress', 'delivered')),
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
  -- Delivery (spec 0014). The order is the delivery record: ops set the agreed date and the
  -- assessor here, and the three delivery states above ride the same status column. All four are
  -- nullable, so the migration is inert to code that ignores them.
  scheduled_at timestamptz null,
  assigned_expert_id uuid null references public.profiles (id) on delete set null,
  delivered_at timestamptz null,
  scheduled_by uuid null references public.profiles (id) on delete set null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one buyer shape (spec 0018, invariant 6): a client organization with its company, or
  -- an expert with their credits.
  constraint orders_check_buyer check (
    num_nonnulls(organization_id, buyer_expert_id) = 1
    and (company_id is null) = (organization_id is null)
    and (credits is null) = (buyer_expert_id is null)
  )
);

comment on table public.orders is 'One package purchase. Amounts are whole Rappen; price and billing address are frozen at purchase. pending → paid | expired | cancelled, and paid → refunded. Clients insert only; the webhook task and ops actions write every state change.';
comment on column public.orders.net_rappen is 'Net price excluding VAT in whole Rappen, copied from packages.price_rappen at purchase.';
comment on column public.orders.gross_rappen is 'net_rappen + vat_rappen, enforced by the check constraint. What Stripe charges and what the invoice totals.';
comment on column public.orders.reference is 'SME24-<year>-<counter> from public.order_reference_seq, shown to the client; the invoice carries its own separate gapless number.';
comment on column public.orders.stripe_checkout_session_id is 'Null until the session id is stored, which is what the sweep keys on: a pending card order with a null session id has no session the buyer can reach (either none was created, or one was created and its id could not be stored, in which case the payable URL is withheld and the orphan expires at Stripe) and is expired outright after an hour.';
comment on column public.orders.billing_uid is 'The buyer''s CHE-###.###.### number, optionally suffixed MWST. Frozen billing data, deliberately independent of companies.uid.';
comment on column public.orders.scheduled_at is 'The agreed on site date and time. Not null exactly while the status is scheduled, in_progress or delivered; the future date check binds only on the paid -> scheduled edge, so a visit may be recorded after the fact.';
comment on column public.orders.assigned_expert_id is 'The assessor doing the work. Set together with scheduled_at; the ops action also upserts the matching active expert_assignments row, which is what actually grants the expert access.';
comment on column public.orders.delivered_at is 'When the assessment was delivered. Required by the in_progress -> delivered edge.';
comment on column public.orders.scheduled_by is 'The ops actor who scheduled the order, from auth.getClaims() in the action.';
comment on column public.orders.buyer_expert_id is 'The expert who bought a credit pack (spec 0018). Set exactly when organization_id is null; orders_check_buyer holds one buyer shape per row.';
comment on column public.orders.credits is 'The directory credits a credit pack order grants, frozen from packages.credits at purchase and granted by settle_order. Null on a client order.';

create index orders_organization_id_created_at_idx on public.orders (organization_id, created_at desc);
create index orders_company_id_created_at_idx on public.orders (company_id, created_at desc);
-- The sweep walks the open orders only.
create index orders_pending_idx on public.orders (status) where status = 'pending';
create index orders_created_by_idx on public.orders (created_by);
create index orders_package_key_idx on public.orders (package_key);
-- The ops overview reads two narrow slices of the table: paid orders still waiting on a date, and
-- scheduled or running orders whose date has arrived. Partial, because both are a handful of rows
-- against every order ever placed (spec 0014, AC-11).
create index orders_paid_unscheduled_idx on public.orders (paid_at) where status = 'paid';
create index orders_scheduled_at_idx on public.orders (scheduled_at) where status in ('scheduled', 'in_progress');
-- The dashboard and the correction path both look an order up by its assessor.
create index orders_assigned_expert_id_idx on public.orders (assigned_expert_id);
-- An expert's own credit pack orders (spec 0018).
create index orders_buyer_expert_id_created_at_idx
  on public.orders (buyer_expert_id, created_at desc) where buyer_expert_id is not null;

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

-- The expert buyer (spec 0018, AC-7). An active expert reads the orders where they are the buyer
-- and inserts a pending one with no organization, themselves as buyer and creator, and a credit
-- pack whose credits equal the package's. The last condition is not optional: UPDATE is revoked,
-- so this policy is the only guard, and settle_order grants the frozen `credits`; without it an
-- expert inserting under their own policy would choose the credits they receive.
create policy "orders: expert buyers read their own"
  on public.orders
  for select
  to authenticated
  using (buyer_expert_id = (select auth.uid()));

create policy "orders: experts create a pending credit order"
  on public.orders
  for insert
  to authenticated
  with check (
    buyer_expert_id = (select auth.uid())
    and created_by = (select auth.uid())
    and organization_id is null
    and status = 'pending'
    and (select private.is_active_expert())
    and exists (
      select 1 from public.packages p
      where p.key = package_key and p.kind = 'directory_credits' and p.credits = orders.credits
    )
  );

create policy "orders: ops full access"
  on public.orders
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- The state machine (spec 0011 invariant 9, extended by spec 0014 with the delivery edges). Fires
-- only when an update names the status column, so the follow up work may still write paid_at, the
-- Stripe ids and the PDF columns on a row whose status did not move.
--
-- The future date check binds only on paid -> scheduled: correcting the date on an order already
-- in_progress or delivered is real work (recording a visit after the fact), which is why it lives
-- on that edge rather than in a table level constraint (spec 0014, State transitions).
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

  -- An expert's credit pack order has nothing to schedule (spec 0018, AC-10): every edge into a
  -- delivery state is refused here, whatever the app offers. classifyScheduleError matches the
  -- fragment 'delivery is not available for an expert order'.
  if new.buyer_expert_id is not null and new.status in ('scheduled', 'in_progress', 'delivered') then
    raise exception 'orders delivery is not available for an expert order'
      using errcode = 'check_violation';
  end if;

  -- Payment edges (spec 0011).
  if (old.status = 'pending' and new.status in ('paid', 'cancelled', 'expired'))
     or (old.status = 'paid' and new.status = 'refunded')
     or (old.status = 'delivered' and new.status = 'refunded') then
    return new;
  end if;

  -- Delivery edges (spec 0014). Each one carries the invariant its target state implies, so
  -- neither a scheduled order without a date nor a delivered one without a delivered_at exists.
  if old.status = 'paid' and new.status = 'scheduled' then
    if new.scheduled_at is null or new.assigned_expert_id is null then
      raise exception 'orders scheduled requires scheduled_at and assigned_expert_id'
        using errcode = 'check_violation';
    end if;
    if new.scheduled_at <= now() then
      raise exception 'orders scheduled_at must be in the future'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'scheduled' and new.status = 'in_progress' then
    if new.scheduled_at is null or new.assigned_expert_id is null then
      raise exception 'orders in_progress requires scheduled_at and assigned_expert_id'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Unschedule. Both columns must be cleared in the same statement, so paid never carries a date.
  if old.status = 'scheduled' and new.status = 'paid' then
    if new.scheduled_at is not null or new.assigned_expert_id is not null then
      raise exception 'orders unschedule requires scheduled_at and assigned_expert_id to be null'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'in_progress' and new.status = 'delivered' then
    if new.scheduled_at is null or new.assigned_expert_id is null then
      raise exception 'orders delivered requires scheduled_at and assigned_expert_id'
        using errcode = 'check_violation';
    end if;
    if new.delivered_at is null then
      raise exception 'orders delivered requires delivered_at'
        using errcode = 'check_violation';
    end if;
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

-- The correction path (spec 0014, AC-7a). orders_check_transition is declared
-- `before update of status`, so it does not fire at all when ops correct only the date or only the
-- assessor on an order already scheduled, in_progress or delivered. Without this second trigger
-- invariant 1 would have no database guard on that path.
--
-- It deliberately does not re check the future date: a correction on an in_progress or delivered
-- order is legitimately in the past.
--
-- A statement that also moves the status is left entirely to orders_check_transition, which
-- asserts the same end state on every edge it allows. Without that guard the unschedule edge
-- (scheduled -> paid, clearing both columns in one statement) would fire this trigger too and be
-- refused for landing on paid, so AC-7 could never pass.
create or replace function private.check_order_delivery_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    return new;
  end if;
  if new.status not in ('scheduled', 'in_progress', 'delivered') then
    raise exception 'orders delivery columns require a scheduled, in_progress or delivered order, not %', new.status
      using errcode = 'check_violation';
  end if;
  if new.scheduled_at is null or new.assigned_expert_id is null then
    raise exception 'orders % requires scheduled_at and assigned_expert_id', new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_order_delivery_columns() from public;

create trigger orders_check_delivery_columns
  before update of scheduled_at, assigned_expert_id on public.orders
  for each row execute function private.check_order_delivery_columns();

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
