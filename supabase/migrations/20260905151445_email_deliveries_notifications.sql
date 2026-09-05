CREATE TABLE "public"."email_deliveries" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "idempotency_key"     text                     NOT NULL,
  "source_event"        text                     NOT NULL,
  "template"            text                     NOT NULL,
  "locale"              text                     NOT NULL,
  "recipient_email"     text                     NOT NULL,
  "recipient_id"        uuid,
  "organization_id"     uuid,
  "subject"             text,
  "data"                jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "status"              text                     NOT NULL DEFAULT 'queued'::text,
  "transport"           text,
  "provider_message_id" text,
  "error"               text,
  "attempts"            integer                  NOT NULL DEFAULT 0,
  "last_run_id"         text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at"             timestamp with time zone,
  "delivered_at"        timestamp with time zone,
  "failed_at"           timestamp with time zone,
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_deliveries_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "email_deliveries_data_check" CHECK ((jsonb_typeof(data) = 'object'::text)),
  CONSTRAINT "email_deliveries_idempotency_key_key" UNIQUE (idempotency_key),
  CONSTRAINT "email_deliveries_locale_check" CHECK ((locale = ANY (ARRAY['de'::text, 'en'::text]))),
  CONSTRAINT "email_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_deliveries_recipient_email_check" CHECK ((char_length(recipient_email) <= 320)),
  CONSTRAINT "email_deliveries_source_event_check" CHECK (((char_length(source_event) >= 1) AND (char_length(source_event) <= 100))),
  CONSTRAINT "email_deliveries_status_check"
    CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'bounced'::text, 'complained'::text, 'failed'::text, 'skipped'::text]))),
  CONSTRAINT "email_deliveries_template_check" CHECK (((char_length(template) >= 1) AND (char_length(template) <= 100))),
  CONSTRAINT "email_deliveries_transport_check" CHECK ((transport = ANY (ARRAY['resend'::text, 'smtp'::text])))
);

ALTER TABLE "public"."email_deliveries"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."notifications" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "recipient_id"    uuid                     NOT NULL,
  "organization_id" uuid,
  "kind"            text                     NOT NULL,
  "data"            jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "link"            text,
  "delivery_id"     uuid,
  "read_at"         timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_data_check" CHECK ((jsonb_typeof(data) = 'object'::text)),
  CONSTRAINT "notifications_kind_check" CHECK (((char_length(kind) >= 1) AND (char_length(kind) <= 100))),
  CONSTRAINT "notifications_link_check" CHECK (((link IS NULL) OR (link ~ '^/'::text))),
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."notifications"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE "public"."email_deliveries"
  ADD CONSTRAINT "email_deliveries_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_delivery_id_fkey" FOREIGN KEY (delivery_id) REFERENCES public.email_deliveries(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX email_deliveries_created_at_id_idx ON public.email_deliveries USING btree (created_at DESC, id DESC);

CREATE INDEX email_deliveries_organization_id_idx ON public.email_deliveries USING btree (organization_id);

CREATE UNIQUE INDEX email_deliveries_provider_message_id_idx ON public.email_deliveries USING btree (provider_message_id)
  WHERE (provider_message_id IS NOT NULL);

CREATE INDEX email_deliveries_recipient_id_idx ON public.email_deliveries USING btree (recipient_id);

CREATE INDEX email_deliveries_status_created_at_idx ON public.email_deliveries USING btree (status, created_at DESC);

CREATE INDEX notifications_delivery_id_idx ON public.notifications USING btree (delivery_id);

CREATE INDEX notifications_organization_id_idx ON public.notifications USING btree (organization_id);

CREATE INDEX notifications_recipient_id_read_at_created_at_idx ON public.notifications USING btree (recipient_id, read_at, created_at DESC);

CREATE TRIGGER email_deliveries_set_updated_at
  BEFORE UPDATE ON public.email_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "email_deliveries: ops read" ON "public"."email_deliveries"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "notifications: recipients read their own" ON "public"."notifications"
  FOR SELECT
  TO "authenticated"
  USING ((recipient_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "notifications: recipients update their own" ON "public"."notifications"
  FOR UPDATE
  TO "authenticated"
  USING ((recipient_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((recipient_id = ( SELECT auth.uid() AS uid)));

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."email_deliveries";

COMMENT ON COLUMN "public"."email_deliveries"."attempts" IS 'Task attempts across all runs; the provider idempotency key is <id>/<attempts>.';

COMMENT ON COLUMN "public"."email_deliveries"."error" IS 'The reason of a failed or skipped row: invalid_data, render_failed, no_transport, not_allowlisted, recipient_missing or the provider message.';

COMMENT ON COLUMN "public"."email_deliveries"."idempotency_key" IS 'The caller''s key, unique: a second trigger with the same key reuses the row.';

COMMENT ON COLUMN "public"."email_deliveries"."status" IS 'queued, sending, sent, delivered, bounced, complained, failed or skipped; moves forward only, except the ops retry (failed to sending).';

COMMENT ON COLUMN "public"."notifications"."link" IS 'App path without the locale prefix, prefixed when rendered (feature 23).';

COMMENT ON TABLE "public"."email_deliveries" IS 'Outbox of every product email: one row per intended send, status from the task and the Resend webhook. Ops read; only the service key writes. Purged after 90 days.';

COMMENT ON TABLE "public"."notifications" IS 'In app notification feed: one row per email to a known user. The recipient reads their own rows and sets read_at; only the service key inserts.';

REVOKE ALL ON TABLE "public"."email_deliveries" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."email_deliveries" TO "anon";

REVOKE ALL ON TABLE "public"."email_deliveries" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."email_deliveries" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_deliveries" TO "postgres";

REVOKE ALL ON TABLE "public"."email_deliveries" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."email_deliveries" TO "service_role";

REVOKE ALL ON TABLE "public"."notifications" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."notifications" TO "anon";

REVOKE ALL ON TABLE "public"."notifications" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."notifications" TO "authenticated";

-- Hand moved below the table level revoke (pgdelta emits it before, which would drop it):
-- a recipient may mark a notification read and change nothing else (spec 0006, AC-13).
GRANT UPDATE ("read_at") ON TABLE "public"."notifications" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "postgres";

REVOKE ALL ON TABLE "public"."notifications" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."notifications" TO "service_role";
