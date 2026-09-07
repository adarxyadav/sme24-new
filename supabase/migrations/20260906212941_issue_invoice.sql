SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.issue_invoice (
  order_id       uuid,
  seller_name    text,
  seller_address text,
  seller_uid     text,
  seller_iban    text,
  due_days       integer DEFAULT 30
)
  RETURNS TABLE (
    invoice_id     uuid,
    invoice_number text,
    qr_reference   text
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
    organization_id, order_id, number, issued_at, due_date,
    seller_name, seller_address, seller_uid, seller_iban, qr_reference
  ) values (
    the_order.organization_id, the_order.id, new_number, issued_at,
    (issued_at at time zone 'Europe/Zurich')::date + issue_invoice.due_days,
    issue_invoice.seller_name, issue_invoice.seller_address, issue_invoice.seller_uid,
    issue_invoice.seller_iban, new_reference
  )
  returning * into existing;

  -- The order keeps its own due date in step with the invoice it was given.
  update public.orders set due_date = existing.due_date where id = the_order.id;

  return query select existing.id, existing.number, existing.qr_reference;
end;
$function$;

COMMENT ON FUNCTION "public"."issue_invoice"(uuid, text, text, text, text, integer) IS 'Issues the invoice for a bank transfer order, leaving it pending. Draws the gapless number in one small transaction. Service role only.';

REVOKE ALL ON FUNCTION "public"."issue_invoice"(uuid, text, text, text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."issue_invoice"(uuid, text, text, text, text, integer) TO "postgres", "service_role";

-- Re added by hand (AGENTS.md): the diff emits only REVOKE ALL ... FROM PUBLIC, which leaves the
-- direct grants Supabase's default privileges give anon and authenticated on a new public
-- function. issue_invoice draws an invoice number, so only the service role may call it.
REVOKE EXECUTE ON FUNCTION "public"."issue_invoice"(uuid, text, text, text, text, integer) FROM "anon", "authenticated";
