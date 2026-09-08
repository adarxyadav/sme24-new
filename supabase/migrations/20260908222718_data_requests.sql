CREATE TABLE "public"."data_requests" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "kind"            text                     NOT NULL,
  "requested_by"    uuid,
  "organization_id" uuid,
  "status"          text                     NOT NULL DEFAULT 'new'::text,
  "due_at"          timestamp with time zone NOT NULL,
  "handled_by"      uuid,
  "handled_at"      timestamp with time zone,
  "ops_note"        text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "data_requests_handled_together" CHECK (((handled_by IS NULL) = (handled_at IS NULL))),
  CONSTRAINT "data_requests_kind_check" CHECK ((kind = ANY (ARRAY['export'::text, 'deletion'::text]))),
  CONSTRAINT "data_requests_ops_note_check" CHECK ((char_length(ops_note) <= 2000)),
  CONSTRAINT "data_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "data_requests_status_check" CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'fulfilled'::text, 'refused'::text])))
);

ALTER TABLE "public"."data_requests"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."data_requests"
  ADD CONSTRAINT "data_requests_handled_by_fkey" FOREIGN KEY (handled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."data_requests"
  ADD CONSTRAINT "data_requests_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE "public"."data_requests"
  ADD CONSTRAINT "data_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX data_requests_open_idx ON public.data_requests USING btree (requested_by, kind)
  WHERE (status = ANY (ARRAY['new'::text, 'in_progress'::text]));

CREATE INDEX data_requests_organization_id_idx ON public.data_requests USING btree (organization_id);

CREATE INDEX data_requests_requested_by_idx ON public.data_requests USING btree (requested_by, created_at DESC);

CREATE INDEX data_requests_status_due_at_idx ON public.data_requests USING btree (status, due_at);

CREATE TRIGGER data_requests_audit
  AFTER INSERT OR UPDATE OF status, ops_note ON public.data_requests
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER data_requests_set_updated_at
  BEFORE UPDATE ON public.data_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "data_requests: ops read" ON "public"."data_requests"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "data_requests: subject files own" ON "public"."data_requests"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((( SELECT auth.uid() AS uid) = requested_by));

CREATE POLICY "data_requests: subject reads own" ON "public"."data_requests"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = requested_by));

COMMENT ON COLUMN "public"."data_requests"."due_at" IS 'created_at + 30 days in UTC; only the overdue comparison converts to Europe/Zurich.';

COMMENT ON COLUMN "public"."data_requests"."handled_at" IS 'Set with handled_by the first time the status leaves new, in the same statement as the change; never cleared.';

COMMENT ON COLUMN "public"."data_requests"."kind" IS 'export (a copy of the data, assembled and sent by ops outside the app) or deletion (anonymisation through updateDataRequest).';

COMMENT ON COLUMN "public"."data_requests"."requested_by" IS 'The subject. Set null when the profile goes, so the record outlives the person it is about.';

COMMENT ON COLUMN "public"."data_requests"."status" IS 'new -> in_progress -> fulfilled, with refused as the exit from either. fulfilled and refused are terminal; more is a new request.';

COMMENT ON TABLE "public"."data_requests" IS 'Data subject requests (export or deletion) filed by the subject and worked by ops within 30 days. No retention: the row is the record that the right was exercised and answered.';

REVOKE ALL ON TABLE "public"."data_requests" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."data_requests" TO "anon";

-- Hand fixed (AGENTS.md, the declarative diff's four blind spots): the generator emits the four
-- column grants first and then a table level REVOKE ALL, which drops them again. The table level
-- revoke has to come first, so the column grants survive.
REVOKE ALL ON TABLE "public"."data_requests" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."data_requests" TO "authenticated";

GRANT INSERT ("kind") ON TABLE "public"."data_requests" TO "authenticated";

GRANT INSERT ("requested_by") ON TABLE "public"."data_requests" TO "authenticated";

GRANT INSERT ("organization_id") ON TABLE "public"."data_requests" TO "authenticated";

GRANT INSERT ("due_at") ON TABLE "public"."data_requests" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."data_requests" TO "postgres";

REVOKE ALL ON TABLE "public"."data_requests" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."data_requests" TO "service_role";

-- The generator also re-emitted a widening of the assigned_expert_summaries view grant from
-- SELECT to full DML for `authenticated` (the fourth blind spot). Dropped: that view is read only
-- by design and this migration does not touch it.
