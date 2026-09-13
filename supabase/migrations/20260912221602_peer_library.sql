CREATE TABLE "public"."peer_companies" (
  "key"              text                     NOT NULL,
  "name"             text                     NOT NULL,
  "country"          text                     NOT NULL,
  "industry_section" text                     NOT NULL,
  "headcount"        integer                  NOT NULL,
  "headcount_year"   integer                  NOT NULL,
  "report_url"       text                     NOT NULL,
  "note"             jsonb,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "peer_companies_country_check" CHECK ((country ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT "peer_companies_headcount_check" CHECK ((headcount > 0)),
  CONSTRAINT "peer_companies_headcount_year_check" CHECK (((headcount_year >= 2000) AND (headcount_year <= 2100))),
  CONSTRAINT "peer_companies_industry_section_check" CHECK ((industry_section ~ '^[A-U]$'::text)),
  CONSTRAINT "peer_companies_key_check" CHECK ((key ~ '^[a-z0-9-]+$'::text)),
  CONSTRAINT "peer_companies_note_check" CHECK (((note IS NULL) OR ((jsonb_typeof(note) = 'object'::text) AND (note ? 'de'::text) AND (note ? 'en'::text)))),
  CONSTRAINT "peer_companies_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."peer_companies"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."peer_figures" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "peer_key"           text                     NOT NULL,
  "kpi_key"            text                     NOT NULL,
  "period_year"        integer                  NOT NULL,
  "value"              numeric                  NOT NULL,
  "value_as_published" numeric                  NOT NULL,
  "unit_as_published"  text                     NOT NULL,
  "basis"              text                     NOT NULL,
  "source_url"         text                     NOT NULL,
  "verified_at"        timestamp with time zone,
  "verified_by"        text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "peer_figures_basis_check" CHECK ((basis = ANY (ARRAY['employees'::text, 'employees_and_contractors'::text]))),
  CONSTRAINT "peer_figures_kpi_key_check" CHECK ((kpi_key = ANY (ARRAY['ltifr'::text, 'trifr'::text, 'lost_days_per_incident'::text, 'iso_45001_certified'::text]))),
  CONSTRAINT "peer_figures_peer_kpi_year_basis_key" UNIQUE (peer_key, kpi_key, period_year, basis),
  CONSTRAINT "peer_figures_period_year_check" CHECK (((period_year >= 2000) AND (period_year <= 2100))),
  CONSTRAINT "peer_figures_pkey" PRIMARY KEY (id),
  CONSTRAINT "peer_figures_unit_as_published_check" CHECK ((unit_as_published = ANY (ARRAY['per_million_hours'::text, 'per_200k_hours'::text, 'days'::text, 'boolean'::text]))),
  CONSTRAINT "peer_figures_verified_pair" CHECK (((verified_at IS NULL) = (verified_by IS NULL)))
);

ALTER TABLE "public"."peer_figures"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."benchmark_snapshots"
  ADD COLUMN "peers" jsonb;

ALTER TABLE "public"."peer_figures"
  ADD CONSTRAINT "peer_figures_kpi_key_fkey" FOREIGN KEY (kpi_key) REFERENCES public.kpi_definitions(key);

ALTER TABLE "public"."peer_figures"
  ADD CONSTRAINT "peer_figures_peer_key_fkey" FOREIGN KEY (peer_key) REFERENCES public.peer_companies(key) ON DELETE CASCADE;

CREATE INDEX peer_companies_industry_section_idx ON public.peer_companies USING btree (industry_section);

CREATE INDEX peer_figures_kpi_key_period_year_idx ON public.peer_figures USING btree (kpi_key, period_year);

CREATE INDEX peer_figures_peer_key_idx ON public.peer_figures USING btree (peer_key);

CREATE TRIGGER peer_companies_set_updated_at
  BEFORE UPDATE ON public.peer_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER peer_figures_set_updated_at
  BEFORE UPDATE ON public.peer_figures
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "peer_companies: ops insert" ON "public"."peer_companies"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "peer_companies: ops update" ON "public"."peer_companies"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "peer_companies: signed in users read" ON "public"."peer_companies"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "peer_figures: ops insert" ON "public"."peer_figures"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "peer_figures: ops update" ON "public"."peer_figures"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "peer_figures: signed in users read" ON "public"."peer_figures"
  FOR SELECT
  TO "authenticated"
  USING (true);

COMMENT ON COLUMN "public"."benchmark_snapshots"."peers" IS 'The named published peer blocks per KPI (spec 0021): rank, best, gap and the copied peer rows with the client''s own saving at each; null on a row older than benchmark-model@5.';

COMMENT ON COLUMN "public"."peer_companies"."country" IS 'ISO 3166 alpha 2 of the headquarters; the peer ladder reads it through the country catalogue.';

COMMENT ON COLUMN "public"."peer_companies"."headcount" IS 'Total employees as the report prints them, with headcount_year; shown on every peer row so a listed group is never mistaken for a like sized peer.';

COMMENT ON COLUMN "public"."peer_companies"."industry_section" IS 'The NACE Rev. 2 section letter A to U; the task loads one section and never widens it.';

COMMENT ON COLUMN "public"."peer_companies"."key" IS 'A stable lowercase slug, the CSV''s key and the snapshot''s peerKey.';

COMMENT ON COLUMN "public"."peer_companies"."note" IS 'Localized {de, en} curator sentence on what the company''s figures count, or null.';

COMMENT ON COLUMN "public"."peer_figures"."basis" IS 'What the figure counts: own employees only, or employees and contractors together.';

COMMENT ON COLUMN "public"."peer_figures"."value" IS 'The figure in the KPI''s own unit: a per 200 000 hours rate is stored times five (spec 0021, AC-13), days and per million hours as printed, a boolean as 0 or 1.';

COMMENT ON COLUMN "public"."peer_figures"."value_as_published" IS 'The figure exactly as the report prints it, shown in the table''s tooltip with its unit.';

COMMENT ON COLUMN "public"."peer_figures"."verified_at" IS 'When a person read the source page; null means work in progress, skipped by the task and counted by the launch gate.';

COMMENT ON COLUMN "public"."peer_figures"."verified_by" IS 'The curator''s name, present exactly when verified_at is; never rendered to a client.';

COMMENT ON TABLE "public"."peer_companies" IS 'Named companies that publish a safety figure (spec 0021). Every signed in user reads; ops and migrations write; nobody deletes through the app roles.';

COMMENT ON TABLE "public"."peer_figures" IS 'Published safety figures of the peer companies (spec 0021). Every signed in user reads; ops and migrations write; nobody deletes through the app roles.';

-- Hand fixes (root AGENTS.md, the four diff cases). The diff re expressed the two schema files'
-- `revoke truncate` as a REVOKE ALL plus a GRANT of every other verb on each table and role; the
-- two lines below are what the schema declares and have the same effect. It also emitted a
-- REVOKE ALL plus a full DML GRANT on the views public.assigned_expert_summaries and
-- public.expert_bookings for `authenticated`, widening both from SELECT to insert, update and
-- delete; neither view is touched by spec 0021 and their live grant is SELECT only, so those
-- statements were removed rather than committed. The new nullable `peers` column on
-- benchmark_snapshots inherits the table level SELECT (that table revokes only the write verbs),
-- so no column grant is owed; benchmark_snapshots.test.sql asserts a member reads it.
REVOKE TRUNCATE ON TABLE "public"."peer_companies" FROM "anon", "authenticated", "service_role";

REVOKE TRUNCATE ON TABLE "public"."peer_figures" FROM "anon", "authenticated", "service_role";
