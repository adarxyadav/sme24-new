SET local check_function_bodies = off;

ALTER TABLE "public"."order_events"
  DROP CONSTRAINT "order_events_actor_role_check";

ALTER TABLE "public"."packages"
  DROP CONSTRAINT "packages_key_check";

ALTER TABLE "public"."invoices"
  ADD COLUMN "buyer_expert_id" uuid;

ALTER TABLE "public"."orders"
  ADD COLUMN "buyer_expert_id" uuid;

ALTER TABLE "public"."orders"
  ADD COLUMN "credits" integer;

ALTER TABLE "public"."packages"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'assessment'::text;

ALTER TABLE "public"."packages"
  ADD COLUMN "credits" integer;

ALTER TABLE "public"."invoices"
  ALTER COLUMN "organization_id" DROP NOT NULL;

ALTER TABLE "public"."order_events"
  ALTER COLUMN "organization_id" DROP NOT NULL;

ALTER TABLE "public"."orders"
  ALTER COLUMN "company_id" DROP NOT NULL;

ALTER TABLE "public"."orders"
  ALTER COLUMN "organization_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION private.check_invoice_immutable()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.buyer_expert_id is distinct from old.buyer_expert_id
     or new.order_id is distinct from old.order_id
     or new.number is distinct from old.number
     or new.issued_at is distinct from old.issued_at
     or new.due_date is distinct from old.due_date
     or new.seller_name is distinct from old.seller_name
     or new.seller_address is distinct from old.seller_address
     or new.seller_uid is distinct from old.seller_uid
     or new.seller_iban is distinct from old.seller_iban
     or new.qr_reference is distinct from old.qr_reference
     or new.created_at is distinct from old.created_at then
    raise exception 'an issued invoice is immutable except for its pdf columns and cancelled_at'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_order_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.grant_order_credits (
  the_order public.orders
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.directory_credit_balance (
  expert_id uuid DEFAULT NULL::uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  subject uuid;
begin
  if private.is_ops() then
    subject := coalesce(directory_credit_balance.expert_id, caller);
  elsif private.is_active_expert() then
    if directory_credit_balance.expert_id is not null and directory_credit_balance.expert_id <> caller then
      raise exception 'forbidden' using errcode = 'SM403';
    end if;
    subject := caller;
  else
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return (
    select coalesce(sum(e.delta), 0)::integer
    from public.directory_credit_entries e
    where e.expert_id = subject
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.directory_ops_summary()
  RETURNS TABLE (
    expert_id      uuid,
    full_name      text,
    email          text,
    balance        integer,
    credits_bought integer,
    unlocks        bigint,
    last_unlock_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not private.is_ops() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return query
    with ledger as (
      select e.expert_id,
             coalesce(sum(e.delta), 0)::integer as balance,
             coalesce(sum(e.delta) filter (where e.reason = 'purchase'), 0)::integer as credits_bought
      from public.directory_credit_entries e
      group by e.expert_id
    ),
    unlocked as (
      select u.expert_id, count(*) as unlocks, max(u.created_at) as last_unlock_at
      from public.directory_unlocks u
      group by u.expert_id
    )
    select
      p.id,
      p.full_name,
      x.email,
      coalesce(l.balance, 0),
      coalesce(l.credits_bought, 0),
      coalesce(k.unlocks, 0),
      k.last_unlock_at
    from public.profiles p
    join public.expert_profiles x on x.expert_id = p.id
    left join ledger l on l.expert_id = p.id
    left join unlocked k on k.expert_id = p.id
    where l.expert_id is not null or k.expert_id is not null
    order by k.last_unlock_at desc nulls last, p.full_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.directory_remove_contact (
  email  text,
  reason text
)
  RETURNS TABLE (
    removed          boolean,
    unlocks_cascaded integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  normalised text := lower(trim(directory_remove_contact.email));
  the_hash text;
  the_contact_id uuid;
  cascaded integer := 0;
begin
  if not private.is_ops() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  if directory_remove_contact.reason not in ('data_subject_request', 'bounce', 'ops') then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  the_hash := encode(sha256(convert_to(normalised, 'UTF8')), 'hex');

  insert into public.directory_suppressions (email_hash, reason, created_by)
  values (the_hash, directory_remove_contact.reason, caller)
  on conflict (email_hash) do nothing;

  select c.id into the_contact_id from public.directory_contacts c where c.email = normalised;
  if the_contact_id is null then
    return query select false, 0;
    return;
  end if;
  select count(*)::integer into cascaded from public.directory_unlocks u where u.contact_id = the_contact_id;
  delete from public.directory_contacts c where c.id = the_contact_id;
  return query select true, cascaded;
end;
$function$;

CREATE OR REPLACE FUNCTION public.directory_reveal (
  contact_id uuid
)
  RETURNS TABLE (
    id               uuid,
    company_id       uuid,
    company_name     text,
    company_country  text,
    company_city     text,
    first_name       text,
    last_name        text,
    contact_title    text,
    contact_country  text,
    contact_city     text,
    email            text,
    phone            text,
    mobile           text,
    unlocked_at      timestamp with time zone,
    balance          integer,
    already_unlocked boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  the_contact public.directory_contacts;
  the_unlock public.directory_unlocks;
  balance_now integer;
  was_unlocked boolean := false;
begin
  if not private.is_active_expert() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;

  -- Two reveals from one expert at once would both read the same balance; the lock serialises
  -- them, so a balance of one pays for exactly one unlock.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));

  select c.* into the_contact from public.directory_contacts c where c.id = directory_reveal.contact_id;
  if not found or exists (
    select 1 from public.directory_suppressions s
    where s.email_hash = encode(sha256(convert_to(lower(the_contact.email), 'UTF8')), 'hex')
  ) then
    raise exception 'not_found' using errcode = 'SM404';
  end if;

  select u.* into the_unlock
  from public.directory_unlocks u
  where u.expert_id = caller and u.contact_id = the_contact.id;
  if found then
    was_unlocked := true;
  else
    select coalesce(sum(e.delta), 0)::integer into balance_now
    from public.directory_credit_entries e
    where e.expert_id = caller;
    if balance_now < 1 then
      raise exception 'insufficient_credits' using errcode = 'SM402';
    end if;
    insert into public.directory_unlocks (expert_id, contact_id)
    values (caller, the_contact.id)
    returning * into the_unlock;
    insert into public.directory_credit_entries (expert_id, delta, reason, unlock_id)
    values (caller, -1, 'unlock', the_unlock.id);
  end if;

  select coalesce(sum(e.delta), 0)::integer into balance_now
  from public.directory_credit_entries e
  where e.expert_id = caller;

  return query
    select
      the_contact.id,
      co.id,
      co.name,
      co.country,
      co.city,
      the_contact.first_name,
      the_contact.last_name,
      the_contact.title,
      the_contact.country,
      the_contact.city,
      the_contact.email,
      the_contact.phone,
      the_contact.mobile,
      the_unlock.created_at,
      balance_now,
      was_unlocked
    from public.directory_companies co
    where co.id = the_contact.company_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.directory_unlocked_contacts (
  after_created_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  after_id         uuid                     DEFAULT NULL::uuid,
  page_size        integer                  DEFAULT 25
)
  RETURNS TABLE (
    unlock_id       uuid,
    id              uuid,
    company_id      uuid,
    company_name    text,
    company_country text,
    company_city    text,
    first_name      text,
    last_name       text,
    contact_title   text,
    contact_country text,
    contact_city    text,
    email           text,
    phone           text,
    mobile          text,
    unlocked_at     timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  size integer := least(greatest(coalesce(page_size, 25), 1), 500);
begin
  if not private.is_active_expert() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return query
    select
      u.id,
      c.id,
      co.id,
      co.name,
      co.country,
      co.city,
      c.first_name,
      c.last_name,
      c.title,
      c.country,
      c.city,
      c.email,
      c.phone,
      c.mobile,
      u.created_at
    from public.directory_unlocks u
    join public.directory_contacts c on c.id = u.contact_id
    join public.directory_companies co on co.id = c.company_id
    where u.expert_id = caller
      and (after_created_at is null or after_id is null
           or (u.created_at, u.id) < (after_created_at, after_id))
    order by u.created_at desc, u.id desc
    limit size;
end;
$function$;

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
$function$;

ALTER TABLE "public"."invoices"
  ADD CONSTRAINT "invoices_buyer_expert_id_fkey" FOREIGN KEY (buyer_expert_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."invoices"
  ADD CONSTRAINT "invoices_check_buyer" CHECK ((num_nonnulls(organization_id, buyer_expert_id) = 1));

ALTER TABLE "public"."order_events"
  ADD CONSTRAINT "order_events_actor_role_check" CHECK ((actor_role = ANY (ARRAY['client'::text, 'expert'::text, 'ops'::text, 'service'::text, 'system'::text])));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_buyer_expert_id_fkey" FOREIGN KEY (buyer_expert_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_check_buyer"
    CHECK (((num_nonnulls(organization_id, buyer_expert_id) = 1) AND ((company_id IS NULL) = (organization_id IS NULL)) AND ((credits IS NULL) = (buyer_expert_id IS NULL))));

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_credits_check" CHECK (((credits IS NULL) OR (credits > 0)));

ALTER TABLE "public"."packages"
  ADD CONSTRAINT "packages_check_credits" CHECK ((((kind = 'directory_credits'::text) = (credits IS NOT NULL)) AND ((credits IS NULL) OR (credits > 0))));

ALTER TABLE "public"."packages"
  ADD CONSTRAINT "packages_key_check" CHECK ((key = ANY (ARRAY['compliance'::text, 'sms'::text, 'culture'::text, 'retainer'::text, 'directory_50'::text])));

ALTER TABLE "public"."packages"
  ADD CONSTRAINT "packages_kind_check" CHECK ((kind = ANY (ARRAY['assessment'::text, 'directory_credits'::text])));

CREATE INDEX invoices_buyer_expert_id_idx ON public.invoices USING btree (buyer_expert_id)
  WHERE (buyer_expert_id IS NOT NULL);

CREATE INDEX orders_buyer_expert_id_created_at_idx ON public.orders USING btree (buyer_expert_id, created_at DESC)
  WHERE (buyer_expert_id IS NOT NULL);

CREATE POLICY "invoices: expert buyers read their own" ON "public"."invoices"
  FOR SELECT
  TO "authenticated"
  USING ((buyer_expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "order_events: expert buyers read their own orders" ON "public"."order_events"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_events.order_id) AND (o.buyer_expert_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "order_events: experts record their own order creation" ON "public"."order_events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((organization_id IS NULL) AND (actor_id = ( SELECT auth.uid() AS uid)) AND (actor_role = 'expert'::text) AND (to_status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_events.order_id) AND (o.buyer_expert_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "orders: expert buyers read their own" ON "public"."orders"
  FOR SELECT
  TO "authenticated"
  USING ((buyer_expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "orders: experts create a pending credit order" ON "public"."orders"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((buyer_expert_id = ( SELECT auth.uid() AS uid)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (organization_id IS NULL) AND (status = 'pending'::text) AND ( SELECT
    private.is_active_expert() AS is_active_expert) AND (EXISTS ( SELECT 1
   FROM public.packages p
  WHERE ((p.key = orders.package_key) AND (p.kind = 'directory_credits'::text) AND (p.credits = orders.credits))))));

CREATE POLICY "invoices bucket: expert buyers read their own" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'invoices'::text) AND ((storage.foldername(name))[1] = 'experts'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text)));

COMMENT ON COLUMN "public"."orders"."buyer_expert_id" IS 'The expert who bought a credit pack (spec 0018). Set exactly when organization_id is null; orders_check_buyer holds one buyer shape per row.';

COMMENT ON COLUMN "public"."orders"."credits" IS 'The directory credits a credit pack order grants, frozen from packages.credits at purchase and granted by settle_order. Null on a client order.';

COMMENT ON COLUMN "public"."packages"."credits" IS 'The directory credits one purchase of a credit pack grants; null on an assessment package. Frozen onto orders.credits at purchase.';

COMMENT ON COLUMN "public"."packages"."kind" IS 'assessment for the pricing page packages, directory_credits for a credit pack of the contact directory (spec 0018).';

COMMENT ON FUNCTION "public"."directory_credit_balance"(uuid) IS 'sum(delta) over an expert''s credit ledger (spec 0018). An expert reads their own; ops may name an expert_id.';

COMMENT ON FUNCTION "public"."directory_ops_summary"() IS 'One row per expert with a balance or an unlock: balance, credits bought, unlocks, last unlock (spec 0018, AC-15). Ops only.';

COMMENT ON FUNCTION "public"."directory_remove_contact"(text, text) IS 'Removes a person from the directory and suppresses their email hash in one transaction (spec 0018, AC-15). Ops only; answers removed and the unlocks cascaded.';

COMMENT ON FUNCTION "public"."directory_reveal"(uuid) IS 'Reveals one contact for one credit (spec 0018, AC-11): checks, debits and returns the row in one transaction under a per caller lock. Active experts only; SM402 below one credit, SM404 for a missing contact.';

COMMENT ON FUNCTION "public"."directory_unlocked_contacts"(timestamp with time zone, uuid, integer) IS 'The caller''s unlocked contacts newest first, keyset paged, up to 500 a page (spec 0018, AC-13). Active experts only.';

REVOKE ALL ON FUNCTION "private"."grant_order_credits"(public.orders) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."grant_order_credits"(public.orders) TO "postgres";

REVOKE ALL ON FUNCTION "public"."directory_credit_balance"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_credit_balance"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."directory_ops_summary"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_ops_summary"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."directory_remove_contact"(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_remove_contact"(text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."directory_reveal"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_reveal"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."directory_unlocked_contacts"(timestamp WITH time zone, uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_unlocked_contacts"(timestamp WITH time zone, uuid, integer) TO "authenticated", "postgres", "service_role";

-- Hand fixes (AGENTS.md): Supabase's default privileges grant execute to anon on every new public
-- function and REVOKE ... FROM PUBLIC above does not remove that direct grant; and the generator
-- re-emitted a widening of the assigned_expert_summaries view grant from SELECT to full DML for
-- authenticated, which was removed here so the view keeps its select only grant.
REVOKE EXECUTE ON FUNCTION "public"."directory_credit_balance"(uuid) FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."directory_ops_summary"() FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."directory_remove_contact"(text, text) FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."directory_reveal"(uuid) FROM "anon";
REVOKE EXECUTE ON FUNCTION "public"."directory_unlocked_contacts"(timestamp WITH time zone, uuid, integer) FROM "anon";
