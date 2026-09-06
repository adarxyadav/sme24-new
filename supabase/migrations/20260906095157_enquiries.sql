CREATE TABLE "public"."enquiries" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "topic"           text                     NOT NULL,
  "company_name"    text                     NOT NULL,
  "contact_name"    text                     NOT NULL,
  "email"           text                     NOT NULL,
  "phone"           text,
  "headcount_band"  text,
  "message"         text                     NOT NULL,
  "locale"          text                     NOT NULL,
  "ip_hash"         text,
  "organization_id" uuid,
  "submitted_by"    uuid,
  "status"          text                     NOT NULL DEFAULT 'new'::text,
  "handled_by"      uuid,
  "handled_at"      timestamp with time zone,
  "ops_note"        text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "enquiries_company_name_check" CHECK (((char_length(company_name) >= 1) AND (char_length(company_name) <= 200))),
  CONSTRAINT "enquiries_contact_name_check" CHECK (((char_length(contact_name) >= 1) AND (char_length(contact_name) <= 200))),
  CONSTRAINT "enquiries_email_check" CHECK (((email = lower(email)) AND ((char_length(email) >= 3) AND (char_length(email) <= 320)))),
  CONSTRAINT "enquiries_headcount_band_check" CHECK ((headcount_band = ANY (ARRAY['1-49'::text, '50-249'::text, '250+'::text]))),
  CONSTRAINT "enquiries_ip_hash_check" CHECK ((char_length(ip_hash) = 64)),
  CONSTRAINT "enquiries_locale_check" CHECK ((locale = ANY (ARRAY['de'::text, 'en'::text]))),
  CONSTRAINT "enquiries_message_check" CHECK (((char_length(message) >= 20) AND (char_length(message) <= 2000))),
  CONSTRAINT "enquiries_ops_note_check" CHECK ((char_length(ops_note) <= 2000)),
  CONSTRAINT "enquiries_phone_check" CHECK ((char_length(phone) <= 40)),
  CONSTRAINT "enquiries_pkey" PRIMARY KEY (id),
  CONSTRAINT "enquiries_status_check" CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'closed'::text]))),
  CONSTRAINT "enquiries_topic_check" CHECK ((topic = ANY (ARRAY['retainer'::text, 'general'::text])))
);

ALTER TABLE "public"."enquiries"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."enquiries"
  ADD CONSTRAINT "enquiries_handled_by_fkey" FOREIGN KEY (handled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."enquiries"
  ADD CONSTRAINT "enquiries_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE "public"."enquiries"
  ADD CONSTRAINT "enquiries_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX enquiries_created_at_idx ON public.enquiries USING btree (created_at DESC);

CREATE INDEX enquiries_email_created_at_idx ON public.enquiries USING btree (email, created_at DESC);

CREATE INDEX enquiries_ip_hash_created_at_idx ON public.enquiries USING btree (ip_hash, created_at DESC)
  WHERE (ip_hash IS NOT NULL);

CREATE INDEX enquiries_organization_id_idx ON public.enquiries USING btree (organization_id);

CREATE INDEX enquiries_status_created_at_idx ON public.enquiries USING btree (status, created_at DESC);

CREATE TRIGGER enquiries_audit
  AFTER INSERT OR UPDATE OF status, ops_note ON public.enquiries
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER enquiries_set_updated_at
  BEFORE UPDATE ON public.enquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "enquiries: ops read" ON "public"."enquiries"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "enquiries: ops update" ON "public"."enquiries"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

COMMENT ON COLUMN "public"."enquiries"."handled_at" IS 'Set with handled_by the first time the status leaves new, in the same statement as the change; never cleared.';

COMMENT ON COLUMN "public"."enquiries"."ip_hash" IS 'SHA 256 hex of the first forwarded address, for the hourly flood guard only; never shown, nulled after 30 days.';

COMMENT ON COLUMN "public"."enquiries"."status" IS 'new, contacted or closed; any status may follow any other, so a closed enquiry can be reopened.';

COMMENT ON COLUMN "public"."enquiries"."topic" IS 'retainer (the package sold by conversation) or general.';

COMMENT ON TABLE "public"."enquiries" IS 'Contact form submissions (retainer requests and general questions). Only the service key inserts; ops read every row and change the four workflow columns. ip_hash nulled after 30 days, closed rows deleted after 12 months.';

REVOKE ALL ON TABLE "public"."enquiries" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."enquiries" TO "anon";

REVOKE ALL ON TABLE "public"."enquiries" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."enquiries" TO "authenticated";

-- Hand moved below the table level revoke (pgdelta emits it before, which would drop it):
-- ops change the four workflow columns and nothing else (spec 0009, AC-11).
GRANT UPDATE ("status", "handled_by", "handled_at", "ops_note") ON TABLE "public"."enquiries" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."enquiries" TO "postgres";

REVOKE ALL ON TABLE "public"."enquiries" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."enquiries" TO "service_role";
