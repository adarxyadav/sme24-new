SET local check_function_bodies = off;

CREATE SEQUENCE "public"."invoice_number_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."order_reference_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE TABLE "public"."invoices" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "order_id"        uuid                     NOT NULL,
  "number"          text                     NOT NULL,
  "issued_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "due_date"        date                     NOT NULL,
  "seller_name"     text                     NOT NULL,
  "seller_address"  text                     NOT NULL,
  "seller_uid"      text                     NOT NULL,
  "seller_iban"     text                     NOT NULL,
  "qr_reference"    text                     NOT NULL,
  "pdf_path"        text,
  "pdf_rendered_at" timestamp with time zone,
  "pdf_failed_at"   timestamp with time zone,
  "cancelled_at"    timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "invoices_number_check" CHECK ((number ~ '^[0-9]{4}-[0-9]{4,}$'::text)),
  CONSTRAINT "invoices_number_key" UNIQUE (number),
  CONSTRAINT "invoices_order_id_key" UNIQUE (order_id),
  CONSTRAINT "invoices_pkey" PRIMARY KEY (id),
  CONSTRAINT "invoices_qr_reference_check" CHECK ((qr_reference ~ '^RF[0-9]{2}[0-9A-Z]{1,21}$'::text)),
  CONSTRAINT "invoices_qr_reference_key" UNIQUE (qr_reference),
  CONSTRAINT "invoices_seller_address_check" CHECK (((char_length(seller_address) >= 1) AND (char_length(seller_address) <= 500))),
  CONSTRAINT "invoices_seller_iban_check" CHECK (((char_length(seller_iban) >= 15) AND (char_length(seller_iban) <= 34))),
  CONSTRAINT "invoices_seller_name_check" CHECK (((char_length(seller_name) >= 1) AND (char_length(seller_name) <= 200))),
  CONSTRAINT "invoices_seller_uid_check" CHECK (((char_length(seller_uid) >= 1) AND (char_length(seller_uid) <= 30)))
);

ALTER TABLE "public"."invoices"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."order_events" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "order_id"        uuid                     NOT NULL,
  "from_status"     text,
  "to_status"       text                     NOT NULL,
  "actor_id"        uuid,
  "actor_role"      text                     NOT NULL,
  "reason"          text,
  "occurred_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "order_events_actor_role_check" CHECK ((actor_role = ANY (ARRAY['client'::text, 'ops'::text, 'service'::text, 'system'::text]))),
  CONSTRAINT "order_events_from_status_check"
    CHECK (((from_status IS NULL) OR (from_status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text, 'refunded'::text, 'expired'::text])))),
  CONSTRAINT "order_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "order_events_reason_check" CHECK (((reason IS NULL) OR (char_length(reason) <= 500))),
  CONSTRAINT "order_events_to_status_check" CHECK ((to_status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text, 'refunded'::text, 'expired'::text])))
);

ALTER TABLE "public"."order_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."orders" (
  "id"                         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"            uuid                     NOT NULL,
  "company_id"                 uuid                     NOT NULL,
  "package_key"                text                     NOT NULL,
  "reference"                  text                     NOT NULL,
  "status"                     text                     NOT NULL DEFAULT 'pending'::text,
  "payment_method"             text                     NOT NULL,
  "net_rappen"                 bigint                   NOT NULL,
  "vat_rate"                   numeric(5,4)             NOT NULL,
  "vat_rappen"                 bigint                   NOT NULL,
  "gross_rappen"               bigint                   NOT NULL,
  "currency"                   text                     NOT NULL DEFAULT 'CHF'::text,
  "package_name_snapshot"      text                     NOT NULL,
  "billing_name"               text                     NOT NULL,
  "billing_street"             text                     NOT NULL,
  "billing_postcode"           text                     NOT NULL,
  "billing_town"               text                     NOT NULL,
  "billing_country"            text                     NOT NULL DEFAULT 'CH'::text,
  "billing_uid"                text,
  "locale"                     text                     NOT NULL,
  "stripe_checkout_session_id" text,
  "stripe_payment_intent_id"   text,
  "due_date"                   date,
  "paid_at"                    timestamp with time zone,
  "cancelled_at"               timestamp with time zone,
  "expires_at"                 timestamp with time zone,
  "created_by"                 uuid,
  "created_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "orders_billing_country_check" CHECK ((billing_country ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT "orders_billing_name_check" CHECK (((char_length(billing_name) >= 1) AND (char_length(billing_name) <= 200))),
  CONSTRAINT "orders_billing_postcode_check" CHECK (((char_length(billing_postcode) >= 1) AND (char_length(billing_postcode) <= 20))),
  CONSTRAINT "orders_billing_street_check" CHECK (((char_length(billing_street) >= 1) AND (char_length(billing_street) <= 200))),
  CONSTRAINT "orders_billing_town_check" CHECK (((char_length(billing_town) >= 1) AND (char_length(billing_town) <= 100))),
  CONSTRAINT "orders_billing_uid_check" CHECK (((billing_uid IS NULL) OR ((char_length(billing_uid) >= 12) AND (char_length(billing_uid) <= 30)))),
  CONSTRAINT "orders_check" CHECK ((gross_rappen = (net_rappen + vat_rappen))),
  CONSTRAINT "orders_currency_check" CHECK ((currency = 'CHF'::text)),
  CONSTRAINT "orders_locale_check" CHECK ((locale = ANY (ARRAY['de'::text, 'en'::text]))),
  CONSTRAINT "orders_net_rappen_check" CHECK ((net_rappen > 0)),
  CONSTRAINT "orders_package_name_snapshot_check" CHECK (((char_length(package_name_snapshot) >= 1) AND (char_length(package_name_snapshot) <= 200))),
  CONSTRAINT "orders_payment_method_check" CHECK ((payment_method = ANY (ARRAY['card'::text, 'bank_transfer'::text]))),
  CONSTRAINT "orders_pkey" PRIMARY KEY (id),
  CONSTRAINT "orders_reference_check" CHECK ((reference ~ '^SME24-[0-9]{4}-[0-9]{4,}$'::text)),
  CONSTRAINT "orders_reference_key" UNIQUE (reference),
  CONSTRAINT "orders_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text, 'refunded'::text, 'expired'::text]))),
  CONSTRAINT "orders_stripe_checkout_session_id_key" UNIQUE (stripe_checkout_session_id),
  CONSTRAINT "orders_vat_rappen_check" CHECK ((vat_rappen >= 0)),
  CONSTRAINT "orders_vat_rate_check" CHECK (((vat_rate >= (0)::numeric) AND (vat_rate < (1)::numeric)))
);

ALTER TABLE "public"."orders"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."packages" (
  "key"          text                     NOT NULL,
  "price_rappen" bigint,
  "vat_rate"     numeric(5,4)             NOT NULL DEFAULT 0.081,
  "sort_order"   integer                  NOT NULL,
  "is_active"    boolean                  NOT NULL DEFAULT true,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "packages_key_check" CHECK ((key = ANY (ARRAY['compliance'::text, 'sms'::text, 'culture'::text, 'retainer'::text]))),
  CONSTRAINT "packages_pkey" PRIMARY KEY (key),
  CONSTRAINT "packages_price_rappen_check" CHECK (((price_rappen IS NULL) OR (price_rappen > 0))),
  CONSTRAINT "packages_sort_order_check" CHECK ((sort_order > 0)),
  CONSTRAINT "packages_vat_rate_check" CHECK (((vat_rate >= (0)::numeric) AND (vat_rate < (1)::numeric)))
);

ALTER TABLE "public"."packages"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."stripe_events" (
  "event_id"     text                     NOT NULL,
  "type"         text                     NOT NULL,
  "payload"      jsonb                    NOT NULL,
  "received_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at" timestamp with time zone,
  "error"        text,
  CONSTRAINT "stripe_events_error_check" CHECK (((error IS NULL) OR (char_length(error) <= 2000))),
  CONSTRAINT "stripe_events_event_id_check" CHECK (((char_length(event_id) >= 3) AND (char_length(event_id) <= 255))),
  CONSTRAINT "stripe_events_pkey" PRIMARY KEY (event_id),
  CONSTRAINT "stripe_events_type_check" CHECK (((char_length(type) >= 1) AND (char_length(type) <= 100)))
);

ALTER TABLE "public"."stripe_events"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.check_invoice_immutable()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
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
  if (old.status = 'pending' and new.status in ('paid', 'cancelled', 'expired'))
     or (old.status = 'paid' and new.status = 'refunded') then
    return new;
  end if;
  raise exception 'invalid orders transition % -> %', old.status, new.status
    using errcode = 'check_violation';
end;
$function$;

ALTER TABLE "public"."invoices"
  ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."order_events"
  ADD CONSTRAINT "order_events_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."invoices"
  ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;

ALTER TABLE "public"."order_events"
  ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_package_key_fkey" FOREIGN KEY (package_key) REFERENCES public.packages(key);

CREATE INDEX invoices_organization_id_issued_at_idx ON public.invoices USING btree (organization_id, issued_at DESC);

CREATE INDEX invoices_pdf_failed_idx ON public.invoices USING btree (pdf_failed_at)
  WHERE (pdf_failed_at IS NOT NULL);

CREATE INDEX order_events_order_id_occurred_at_idx ON public.order_events USING btree (order_id, occurred_at DESC);

CREATE INDEX order_events_organization_id_idx ON public.order_events USING btree (organization_id);

CREATE INDEX orders_company_id_created_at_idx ON public.orders USING btree (company_id, created_at DESC);

CREATE INDEX orders_created_by_idx ON public.orders USING btree (created_by);

CREATE INDEX orders_organization_id_created_at_idx ON public.orders USING btree (organization_id, created_at DESC);

CREATE INDEX orders_package_key_idx ON public.orders USING btree (package_key);

CREATE INDEX orders_pending_idx ON public.orders USING btree (status)
  WHERE (status = 'pending'::text);

CREATE INDEX packages_sort_order_idx ON public.packages USING btree (sort_order);

CREATE INDEX stripe_events_received_at_idx ON public.stripe_events USING btree (received_at DESC);

CREATE INDEX stripe_events_type_received_at_idx ON public.stripe_events USING btree (TYPE, received_at DESC);

CREATE INDEX stripe_events_unprocessed_idx ON public.stripe_events USING btree (received_at)
  WHERE (processed_at IS NULL);

CREATE TRIGGER invoices_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER invoices_check_immutable
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION private.check_invoice_immutable();

CREATE TRIGGER invoices_set_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER orders_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER orders_check_transition
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.check_order_transition();

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER packages_set_updated_at
  BEFORE UPDATE ON public.packages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "invoices: members read their organization" ON "public"."invoices"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "invoices: ops read" ON "public"."invoices"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "invoices: ops update" ON "public"."invoices"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "order_events: members read their organization" ON "public"."order_events"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "order_events: members record their own order creation" ON "public"."order_events"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (actor_id = ( SELECT auth.uid() AS uid)) AND (actor_role = 'client'::text) AND (to_status =
    'pending'::text) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_events.order_id) AND (o.organization_id = order_events.organization_id))))));

CREATE POLICY "order_events: ops insert" ON "public"."order_events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "order_events: ops read" ON "public"."order_events"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "orders: members create a pending order for their organization" ON "public"."orders"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM public.companies c
  WHERE ((c.id = orders.company_id) AND (c.organization_id = orders.organization_id))))));

CREATE POLICY "orders: members read their organization" ON "public"."orders"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "orders: ops full access" ON "public"."orders"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "packages: ops full access" ON "public"."packages"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "packages: signed in users read" ON "public"."packages"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "stripe_events: ops read" ON "public"."stripe_events"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

COMMENT ON COLUMN "public"."invoices"."number" IS 'Gapless <year>-<counter> from public.invoice_number_seq. The series includes cancelled invoices, so an invoice count is not a sales count: filter on cancelled_at is null for revenue.';

COMMENT ON COLUMN "public"."invoices"."pdf_failed_at" IS 'Set when the render task exhausts its retries. pdf_path and pdf_failed_at both null means the render is still in flight; pdf_failed_at set means ops must retry. Cleared on a successful retry.';

COMMENT ON COLUMN "public"."invoices"."qr_reference" IS 'ISO 11649 SCOR creditor reference derived from the invoice number, printed on the Swiss QR bill.';

COMMENT ON COLUMN "public"."order_events"."actor_id" IS 'The acting user, or null for the webhook task and the sweep. No foreign key, so the trail survives a deleted account.';

COMMENT ON COLUMN "public"."order_events"."actor_role" IS 'client, ops, service (a task) or system. This feature writes client, ops and service; system stays for the wider convention of spec 0002.';

COMMENT ON COLUMN "public"."orders"."billing_uid" IS 'The buyer''s CHE-###.###.### number, optionally suffixed MWST. Frozen billing data, deliberately independent of companies.uid.';

COMMENT ON COLUMN "public"."orders"."gross_rappen" IS 'net_rappen + vat_rappen, enforced by the check constraint. What Stripe charges and what the invoice totals.';

COMMENT ON COLUMN "public"."orders"."net_rappen" IS 'Net price excluding VAT in whole Rappen, copied from packages.price_rappen at purchase.';

COMMENT ON COLUMN "public"."orders"."reference" IS 'SME24-<year>-<counter> from public.order_reference_seq, shown to the client; the invoice carries its own separate gapless number.';

COMMENT ON COLUMN "public"."orders"."stripe_checkout_session_id" IS 'Null until the session is created, which is what the sweep keys on: a pending card order with a null session id never reached Stripe and is expired outright after an hour.';

COMMENT ON COLUMN "public"."packages"."is_active" IS 'An inactive package cannot start a new checkout; existing orders are unaffected.';

COMMENT ON COLUMN "public"."packages"."price_rappen" IS 'Net price excluding VAT in whole Rappen (1 CHF = 100 Rappen). Null means sold by conversation and not purchasable.';

COMMENT ON COLUMN "public"."packages"."vat_rate" IS 'The MWST rate frozen onto an order at purchase; 0.081 since 2024.';

COMMENT ON COLUMN "public"."stripe_events"."event_id" IS 'Stripe''s evt_... id. Being the primary key is what makes a duplicate delivery harmless (spec 0011, AC-7).';

COMMENT ON COLUMN "public"."stripe_events"."processed_at" IS 'Set when the confirmation task finished with the event; null with an old received_at is an event that never got applied.';

COMMENT ON SEQUENCE "public"."invoice_number_seq" IS 'Supplies the counter in the <year>-<4 digits> invoice number. Gapless by contract: drawn only inside the small issuing transaction of spec 0011 invariant 3.';

COMMENT ON SEQUENCE "public"."order_reference_seq" IS 'Supplies the counter in the SME24-<year>-<n> order reference. Not gapless by design: a burnt reference costs nothing, unlike an invoice number.';

COMMENT ON TABLE "public"."invoices" IS 'One immutable numbered invoice per order. Retained ten years: never deleted, only cancelled. After issue only the PDF columns and cancelled_at may change.';

COMMENT ON TABLE "public"."order_events" IS 'Append only history of every orders state change: from, to, who and why. No app role may update or delete a row.';

COMMENT ON TABLE "public"."orders" IS 'One package purchase. Amounts are whole Rappen; price and billing address are frozen at purchase. pending → paid | expired | cancelled, and paid → refunded. Clients insert only; the webhook task and ops actions write every state change.';

COMMENT ON TABLE "public"."packages" IS 'The assessment packages and their net prices in Rappen. Read by every signed in user, written by ops only; kept equal to PACKAGES in src/features/marketing/packages.ts by a Vitest test.';

COMMENT ON TABLE "public"."stripe_events" IS 'Every Stripe webhook event, keyed on Stripe''s event id so a redelivery is a no operation. Service role writes, ops read. No organization_id: the order id is inside the payload.';

REVOKE ALL ON FUNCTION "private"."check_invoice_immutable"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_invoice_immutable"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."check_order_transition"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_order_transition"() TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."invoice_number_seq" TO "anon", "authenticated", "postgres", "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."order_reference_seq" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."invoices" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."invoices" TO "anon";

REVOKE ALL ("cancelled_at") ON TABLE "public"."invoices" FROM "authenticated";

GRANT UPDATE ("cancelled_at") ON TABLE "public"."invoices" TO "authenticated";

REVOKE ALL ("pdf_failed_at") ON TABLE "public"."invoices" FROM "authenticated";

GRANT UPDATE ("pdf_failed_at") ON TABLE "public"."invoices" TO "authenticated";

REVOKE ALL ("pdf_path") ON TABLE "public"."invoices" FROM "authenticated";

GRANT UPDATE ("pdf_path") ON TABLE "public"."invoices" TO "authenticated";

REVOKE ALL ("pdf_rendered_at") ON TABLE "public"."invoices" FROM "authenticated";

GRANT UPDATE ("pdf_rendered_at") ON TABLE "public"."invoices" TO "authenticated";

REVOKE ALL ON TABLE "public"."invoices" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."invoices" TO "authenticated";

-- Re added by hand (AGENTS.md): the declarative diff emits the four per column UPDATE grants
-- above the table level REVOKE ALL, which then drops them again. Ops need exactly these four
-- columns to retry a failed render and to cancel an invoice (spec 0011, invariant 7).
GRANT UPDATE ("pdf_path", "pdf_rendered_at", "pdf_failed_at", "cancelled_at") ON TABLE "public"."invoices" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."invoices" TO "postgres";

REVOKE ALL ON TABLE "public"."invoices" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."invoices" TO "service_role";

REVOKE ALL ON TABLE "public"."order_events" FROM "anon";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."order_events" TO "anon";

REVOKE ALL ON TABLE "public"."order_events" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."order_events" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_events" TO "postgres";

REVOKE ALL ON TABLE "public"."order_events" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."order_events" TO "service_role";

REVOKE ALL ON TABLE "public"."orders" FROM "anon";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."orders" TO "anon";

REVOKE ALL ON TABLE "public"."orders" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."orders" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "postgres";

REVOKE ALL ON TABLE "public"."orders" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."orders" TO "service_role";

REVOKE ALL ON TABLE "public"."packages" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."packages" TO "anon";

REVOKE ALL ON TABLE "public"."packages" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."packages" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."packages" TO "postgres";

REVOKE ALL ON TABLE "public"."packages" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."packages" TO "service_role";

REVOKE ALL ON TABLE "public"."stripe_events" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."stripe_events" TO "anon";

REVOKE ALL ON TABLE "public"."stripe_events" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."stripe_events" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stripe_events" TO "postgres";

REVOKE ALL ON TABLE "public"."stripe_events" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."stripe_events" TO "service_role";
