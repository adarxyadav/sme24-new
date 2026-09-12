-- ISO 11649 SCOR creditor reference, the database half of src/features/checkout/reference.ts.
-- Kept here because the invoice number is drawn inside the issuing transaction, so the reference
-- must be derived there too; a Vitest test asserts the two implementations agree.
create or replace function public.scor_reference(body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := upper(regexp_replace(body, '[^0-9A-Za-z]', '', 'g'));
  expanded text := '';
  character_code integer;
  remainder integer := 0;
  digit text;
begin
  if length(cleaned) = 0 or length(cleaned) > 21 then
    raise exception 'cannot build a SCOR reference from %', body using errcode = 'check_violation';
  end if;
  -- Letters become two digit numbers, A = 10 through Z = 35, over the body followed by RF00.
  for character_code in select generate_series(1, length(cleaned || 'RF00')) loop
    digit := substr(cleaned || 'RF00', character_code, 1);
    if digit ~ '[0-9]' then
      expanded := expanded || digit;
    else
      expanded := expanded || (ascii(digit) - 55)::text;
    end if;
  end loop;
  -- Mod 97 taken digit by digit, so no intermediate value overflows.
  for character_code in select generate_series(1, length(expanded)) loop
    remainder := (remainder * 10 + substr(expanded, character_code, 1)::integer) % 97;
  end loop;
  return 'RF' || lpad((98 - remainder)::text, 2, '0') || cleaned;
end;
$$;

comment on function public.scor_reference(text) is 'ISO 11649 SCOR creditor reference from an invoice number body. Mirrors scorReference in src/features/checkout/reference.ts; a Vitest test keeps the two equal.';

revoke execute on function public.scor_reference(text) from anon, authenticated, public;

-- Grants the credits of a credit pack order (spec 0018, AC-8, invariant 4): one ledger row per
-- order, `delta` the order's frozen `credits`, guarded by the partial unique index on
-- (order_id) where reason = 'purchase', so a settle retry, an ops mark paid racing the webhook or
-- a second webhook delivery grants exactly once. A client order (no buyer_expert_id) is a no op.
create or replace function private.grant_order_credits(the_order public.orders)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if the_order.buyer_expert_id is null or the_order.credits is null then
    return;
  end if;
  if not exists (
    select 1 from public.packages p
    where p.key = the_order.package_key and p.kind = 'directory_credits'
  ) then
    raise exception 'order % names an expert buyer but not a credit pack', the_order.id
      using errcode = 'check_violation';
  end if;
  insert into public.directory_credit_entries (expert_id, delta, reason, order_id)
  values (the_order.buyer_expert_id, the_order.credits, 'purchase', the_order.id)
  on conflict (order_id) where reason = 'purchase' do nothing;
end;
$$;

revoke execute on function private.grant_order_credits(public.orders) from public;

-- The issuing transaction (spec 0011, invariant 3). One function, called by the service role from
-- `settleOrder`, that does the whole atomic part of settling a payment and nothing else:
--
--   1. moves the order pending -> paid,
--   2. writes its order_events row,
--   3. draws the invoice number and inserts the invoices row.
--
-- Nothing else happens inside it: no Stripe call, no Storage write, no enqueue, no email. That is
-- what makes invoice numbers gapless. Postgres sequences do not roll back, so a transaction that
-- fails for an unrelated reason would burn a number and leave a hole in the series; keeping this
-- transaction to three local writes means the only way it rolls back is a genuine constraint
-- violation, which is exactly the case where the number should not have been drawn.
--
-- It is also the resume point (AC-18, invariant 14): calling it again after a crash returns the
-- existing invoice instead of issuing a second one, so `settleOrder` can safely retry.

create or replace function public.settle_order(
  order_id uuid,
  paid_at timestamptz,
  actor_id uuid,
  actor_role text,
  seller_name text,
  seller_address text,
  seller_uid text,
  seller_iban text,
  due_days integer default 30
)
returns table (invoice_id uuid, invoice_number text, qr_reference text, already_settled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_order public.orders;
  existing public.invoices;
  counter bigint;
  new_number text;
  new_reference text;
  issue_year integer;
begin
  if actor_role not in ('ops', 'service') then
    raise exception 'settle_order is not a client action' using errcode = 'SM403';
  end if;

  -- Two deliveries of the same Stripe event, or an ops click racing the webhook, would both read
  -- the order as pending. The lock is keyed on the order and lasts for this transaction, so the
  -- second caller waits and then finds the order already paid.
  perform pg_advisory_xact_lock(hashtextextended(settle_order.order_id::text, 0));

  select * into the_order from public.orders o where o.id = settle_order.order_id;
  if not found then
    raise exception 'order_not_found' using errcode = 'SM404';
  end if;

  select * into existing from public.invoices i where i.order_id = settle_order.order_id;

  -- Already settled: the resume path. Return the invoice that exists and draw no second number.
  if the_order.status = 'paid' then
    if existing.id is null then
      -- A paid order with no invoice can only come from a crash between the two writes of an
      -- earlier call; issue the invoice now rather than leaving the order without a document.
      issue_year := extract(year from (settle_order.paid_at at time zone 'Europe/Zurich'))::integer;
      counter := nextval('public.invoice_number_seq');
      new_number := issue_year || '-' || lpad(counter::text, 4, '0');
      new_reference := public.scor_reference(replace(new_number, '-', ''));
      insert into public.invoices (
        organization_id, buyer_expert_id, order_id, number, issued_at, due_date,
        seller_name, seller_address, seller_uid, seller_iban, qr_reference
      ) values (
        the_order.organization_id, the_order.buyer_expert_id, the_order.id, new_number, settle_order.paid_at,
        (settle_order.paid_at at time zone 'Europe/Zurich')::date + settle_order.due_days,
        settle_order.seller_name, settle_order.seller_address, settle_order.seller_uid,
        settle_order.seller_iban, new_reference
      )
      returning * into existing;
    end if;
    -- A paid credit pack order always holds its grant (invariant 5); the partial unique index
    -- makes this a no op on every call after the first.
    perform private.grant_order_credits(the_order);
    return query select existing.id, existing.number, existing.qr_reference, true;
    return;
  end if;

  if the_order.status <> 'pending' then
    raise exception 'order_not_pending' using errcode = 'SM409';
  end if;

  update public.orders
  set status = 'paid', paid_at = settle_order.paid_at
  where id = settle_order.order_id;

  insert into public.order_events (organization_id, order_id, from_status, to_status, actor_id, actor_role)
  values (the_order.organization_id, the_order.id, 'pending', 'paid',
          settle_order.actor_id, settle_order.actor_role);

  -- The credits of a credit pack order are granted in this same transaction as `paid` (spec 0018,
  -- AC-8, invariant 5): a paid credit order without its ledger row cannot exist.
  perform private.grant_order_credits(the_order);

  -- The bank transfer path already issued its invoice at creation, so only draw a number when
  -- there is none (invariant 11: a pending bank transfer order is simply an unpaid invoice).
  if existing.id is null then
    issue_year := extract(year from (settle_order.paid_at at time zone 'Europe/Zurich'))::integer;
    counter := nextval('public.invoice_number_seq');
    new_number := issue_year || '-' || lpad(counter::text, 4, '0');
    new_reference := public.scor_reference(replace(new_number, '-', ''));
    insert into public.invoices (
      organization_id, buyer_expert_id, order_id, number, issued_at, due_date,
      seller_name, seller_address, seller_uid, seller_iban, qr_reference
    ) values (
      the_order.organization_id, the_order.buyer_expert_id, the_order.id, new_number, settle_order.paid_at,
      (settle_order.paid_at at time zone 'Europe/Zurich')::date + settle_order.due_days,
      settle_order.seller_name, settle_order.seller_address, settle_order.seller_uid,
      settle_order.seller_iban, new_reference
    )
    returning * into existing;
  end if;

  return query select existing.id, existing.number, existing.qr_reference, false;
end;
$$;

comment on function public.settle_order(uuid, timestamptz, uuid, text, text, text, text, text, integer) is
  'The atomic part of settling a payment: order to paid, its order_events row, and the invoice with its gapless number. Resumable: a second call returns the existing invoice. Service role and ops only.';

-- The service role calls this; no client and no anonymous visitor ever may. The declarative diff
-- does not emit the anon revoke on a new public function, so it is re added by hand in the
-- migration (AGENTS.md).
revoke execute on function public.settle_order(uuid, timestamptz, uuid, text, text, text, text, text, integer) from anon, authenticated, public;

-- Issues an invoice for a bank transfer order without settling it (spec 0011, AC-8). Same small
-- transaction discipline as public.settle_order: it draws the number and inserts the row, and
-- nothing else, so the series stays gapless (invariant 3). The order deliberately stays `pending`;
-- ops move it to `paid` through settle_order when the money lands, and that call finds the invoice
-- already there and draws no second number.
create or replace function public.issue_invoice(
  order_id uuid,
  seller_name text,
  seller_address text,
  seller_uid text,
  seller_iban text,
  due_days integer default 30
)
returns table (invoice_id uuid, invoice_number text, qr_reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  the_order public.orders;
  existing public.invoices;
  counter bigint;
  new_number text;
  new_reference text;
  issue_year integer;
  issued_at timestamptz := now();
begin
  -- Two requests for the same order (a double click, a task retry) would both pass the check
  -- below; the lock makes the second wait and find the first one's invoice.
  perform pg_advisory_xact_lock(hashtextextended(issue_invoice.order_id::text, 0));

  select * into the_order from public.orders o where o.id = issue_invoice.order_id;
  if not found then
    raise exception 'order_not_found' using errcode = 'SM404';
  end if;
  if the_order.payment_method <> 'bank_transfer' then
    raise exception 'not_a_bank_transfer_order' using errcode = 'SM409';
  end if;

  select * into existing from public.invoices i where i.order_id = issue_invoice.order_id;
  if existing.id is not null then
    return query select existing.id, existing.number, existing.qr_reference;
    return;
  end if;

  issue_year := extract(year from (issued_at at time zone 'Europe/Zurich'))::integer;
  counter := nextval('public.invoice_number_seq');
  new_number := issue_year || '-' || lpad(counter::text, 4, '0');
  new_reference := public.scor_reference(replace(new_number, '-', ''));

  insert into public.invoices (
    organization_id, buyer_expert_id, order_id, number, issued_at, due_date,
    seller_name, seller_address, seller_uid, seller_iban, qr_reference
  ) values (
    the_order.organization_id, the_order.buyer_expert_id, the_order.id, new_number, issued_at,
    (issued_at at time zone 'Europe/Zurich')::date + issue_invoice.due_days,
    issue_invoice.seller_name, issue_invoice.seller_address, issue_invoice.seller_uid,
    issue_invoice.seller_iban, new_reference
  )
  returning * into existing;

  -- The order keeps its own due date in step with the invoice it was given.
  update public.orders set due_date = existing.due_date where id = the_order.id;

  return query select existing.id, existing.number, existing.qr_reference;
end;
$$;

comment on function public.issue_invoice(uuid, text, text, text, text, integer) is
  'Issues the invoice for a bank transfer order, leaving it pending. Draws the gapless number in one small transaction. Service role only.';

revoke execute on function public.issue_invoice(uuid, text, text, text, text, integer) from anon, authenticated, public;
