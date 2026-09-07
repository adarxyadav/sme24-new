SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.next_order_reference()
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select 'SME24-'
    || extract(year from (now() at time zone 'Europe/Zurich'))::integer
    || '-'
    || lpad(nextval('public.order_reference_seq')::text, 4, '0');
$function$;

CREATE OR REPLACE FUNCTION public.scor_reference (
  body text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.settle_order (
  order_id       uuid,
  paid_at        timestamp with time zone,
  actor_id       uuid,
  actor_role     text,
  seller_name    text,
  seller_address text,
  seller_uid     text,
  seller_iban    text,
  due_days       integer                  DEFAULT 30
)
  RETURNS TABLE (
    invoice_id      uuid,
    invoice_number  text,
    qr_reference    text,
    already_settled boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
        organization_id, order_id, number, issued_at, due_date,
        seller_name, seller_address, seller_uid, seller_iban, qr_reference
      ) values (
        the_order.organization_id, the_order.id, new_number, settle_order.paid_at,
        (settle_order.paid_at at time zone 'Europe/Zurich')::date + settle_order.due_days,
        settle_order.seller_name, settle_order.seller_address, settle_order.seller_uid,
        settle_order.seller_iban, new_reference
      )
      returning * into existing;
    end if;
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

  -- The bank transfer path already issued its invoice at creation, so only draw a number when
  -- there is none (invariant 11: a pending bank transfer order is simply an unpaid invoice).
  if existing.id is null then
    issue_year := extract(year from (settle_order.paid_at at time zone 'Europe/Zurich'))::integer;
    counter := nextval('public.invoice_number_seq');
    new_number := issue_year || '-' || lpad(counter::text, 4, '0');
    new_reference := public.scor_reference(replace(new_number, '-', ''));
    insert into public.invoices (
      organization_id, order_id, number, issued_at, due_date,
      seller_name, seller_address, seller_uid, seller_iban, qr_reference
    ) values (
      the_order.organization_id, the_order.id, new_number, settle_order.paid_at,
      (settle_order.paid_at at time zone 'Europe/Zurich')::date + settle_order.due_days,
      settle_order.seller_name, settle_order.seller_address, settle_order.seller_uid,
      settle_order.seller_iban, new_reference
    )
    returning * into existing;
  end if;

  return query select existing.id, existing.number, existing.qr_reference, false;
end;
$function$;

COMMENT ON FUNCTION "public"."next_order_reference"() IS 'The next SME24-<year>-<counter> order reference; the year is the Europe/Zurich clock. Not gapless by design.';

COMMENT ON FUNCTION "public"."scor_reference"(text) IS 'ISO 11649 SCOR creditor reference from an invoice number body. Mirrors scorReference in src/features/checkout/reference.ts; a Vitest test keeps the two equal.';

COMMENT ON FUNCTION "public"."settle_order"(uuid, timestamp with time zone, uuid, text, text, text, text, text, integer) IS 'The atomic part of settling a payment: order to paid, its order_events row, and the invoice with its gapless number. Resumable: a second call returns the existing invoice. Service role and ops only.';

REVOKE ALL ON FUNCTION "public"."next_order_reference"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."next_order_reference"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."scor_reference"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."scor_reference"(text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."settle_order"(uuid, timestamp WITH time zone, uuid, text, text, text, text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."settle_order"(uuid, timestamp WITH time zone, uuid, text, text, text, text, text, integer) TO "postgres", "service_role";

-- Re added by hand (AGENTS.md): the declarative diff emits only `REVOKE ALL ... FROM PUBLIC`,
-- which drops the PUBLIC pseudo role grant but not the direct grants Supabase's default
-- privileges hand to anon and authenticated on every new function in public.
-- settle_order writes money rows: without this a signed in client could mark their own order paid
-- without paying. next_order_reference stays available to authenticated (the checkout action
-- draws a reference before inserting) but never to anonymous visitors.
REVOKE EXECUTE ON FUNCTION "public"."settle_order"(uuid, timestamp WITH time zone, uuid, text, text, text, text, text, integer) FROM "anon", "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."scor_reference"(text) FROM "anon", "authenticated";

REVOKE EXECUTE ON FUNCTION "public"."next_order_reference"() FROM "anon";
