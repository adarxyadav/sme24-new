CREATE TABLE "public"."benchmark_assumptions" (
  "key"            text                     NOT NULL,
  "value"          numeric                  NOT NULL,
  "unit"           text                     NOT NULL,
  "label"          jsonb                    NOT NULL,
  "source_name"    text                     NOT NULL,
  "source_url"     text,
  "note"           jsonb,
  "provisional"    boolean                  NOT NULL DEFAULT true,
  "effective_from" date                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "benchmark_assumptions_label_check" CHECK (((jsonb_typeof(label) = 'object'::text) AND (label ? 'de'::text) AND (label ? 'en'::text))),
  CONSTRAINT "benchmark_assumptions_note_check" CHECK (((note IS NULL) OR ((jsonb_typeof(note) = 'object'::text) AND (note ? 'de'::text) AND (note ? 'en'::text)))),
  CONSTRAINT "benchmark_assumptions_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."benchmark_assumptions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."benchmark_snapshots" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"   uuid                     NOT NULL,
  "company_id"        uuid                     NOT NULL,
  "research_run_id"   uuid,
  "trigger_kind"      text                     NOT NULL,
  "model_version"     text                     NOT NULL,
  "peer_provisional"  boolean                  NOT NULL,
  "kpis_compared"     integer                  NOT NULL,
  "confidence"        numeric,
  "cost_chf"          numeric,
  "cost_low_chf"      numeric,
  "cost_high_chf"     numeric,
  "saving_median_chf" numeric,
  "saving_top_chf"    numeric,
  "inputs"            jsonb                    NOT NULL,
  "results"           jsonb                    NOT NULL,
  "gaps"              jsonb                    NOT NULL,
  "cost"              jsonb,
  "assumptions"       jsonb                    NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "benchmark_snapshots_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT "benchmark_snapshots_kpis_compared_check" CHECK (((kpis_compared >= 0) AND (kpis_compared <= 8))),
  CONSTRAINT "benchmark_snapshots_pkey" PRIMARY KEY (id),
  CONSTRAINT "benchmark_snapshots_trigger_kind_check" CHECK ((trigger_kind = ANY (ARRAY['research'::text, 'client_edit'::text, 'recompute'::text])))
);

ALTER TABLE "public"."benchmark_snapshots"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."benchmarks" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "kpi_key"          text                     NOT NULL,
  "industry_section" text                     NOT NULL,
  "size_band"        text                     NOT NULL,
  "period_year"      integer                  NOT NULL,
  "p25"              numeric                  NOT NULL,
  "median"           numeric                  NOT NULL,
  "p75"              numeric                  NOT NULL,
  "sample_size"      integer,
  "source_name"      text                     NOT NULL,
  "source_url"       text,
  "source_note"      jsonb,
  "provisional"      boolean                  NOT NULL DEFAULT true,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "benchmarks_industry_section_check" CHECK (((industry_section ~ '^[A-U]$'::text) OR (industry_section = 'ALL'::text))),
  CONSTRAINT "benchmarks_kpi_section_band_year_key" UNIQUE (kpi_key, industry_section, size_band, period_year),
  CONSTRAINT "benchmarks_period_year_check" CHECK (((period_year >= 2000) AND (period_year <= 2100))),
  CONSTRAINT "benchmarks_pkey" PRIMARY KEY (id),
  CONSTRAINT "benchmarks_quartile_order" CHECK (((p25 <= median) AND (median <= p75))),
  CONSTRAINT "benchmarks_sample_size_check" CHECK ((sample_size >= 0)),
  CONSTRAINT "benchmarks_size_band_check" CHECK ((size_band = ANY (ARRAY['1-49'::text, '50-249'::text, '250+'::text, 'all'::text]))),
  CONSTRAINT "benchmarks_source_note_check"
    CHECK (((source_note IS NULL) OR ((jsonb_typeof(source_note) = 'object'::text) AND (source_note ? 'de'::text) AND (source_note ? 'en'::text))))
);

ALTER TABLE "public"."benchmarks"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."benchmark_snapshots"
  ADD CONSTRAINT "benchmark_snapshots_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."benchmark_snapshots"
  ADD CONSTRAINT "benchmark_snapshots_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."benchmark_snapshots"
  ADD CONSTRAINT "benchmark_snapshots_research_run_id_fkey" FOREIGN KEY (research_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;

ALTER TABLE "public"."benchmarks"
  ADD CONSTRAINT "benchmarks_kpi_key_fkey" FOREIGN KEY (kpi_key) REFERENCES public.kpi_definitions(key);

CREATE INDEX benchmark_snapshots_company_id_created_at_idx ON public.benchmark_snapshots USING btree (company_id, created_at DESC);

CREATE INDEX benchmark_snapshots_organization_id_created_at_idx ON public.benchmark_snapshots USING btree (organization_id, created_at DESC);

CREATE INDEX benchmark_snapshots_research_run_id_idx ON public.benchmark_snapshots USING btree (research_run_id);

CREATE TRIGGER benchmark_assumptions_set_updated_at
  BEFORE UPDATE ON public.benchmark_assumptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER benchmark_snapshots_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.benchmark_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER benchmark_snapshots_set_updated_at
  BEFORE UPDATE ON public.benchmark_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER benchmarks_set_updated_at
  BEFORE UPDATE ON public.benchmarks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "benchmark_assumptions: ops insert" ON "public"."benchmark_assumptions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "benchmark_assumptions: ops update" ON "public"."benchmark_assumptions"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "benchmark_assumptions: signed in users read" ON "public"."benchmark_assumptions"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "benchmark_snapshots: assigned experts read" ON "public"."benchmark_snapshots"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_assigned_expert(benchmark_snapshots.organization_id) AS is_assigned_expert));

CREATE POLICY "benchmark_snapshots: members read their organization" ON "public"."benchmark_snapshots"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "benchmark_snapshots: ops full access" ON "public"."benchmark_snapshots"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "benchmarks: ops insert" ON "public"."benchmarks"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "benchmarks: ops update" ON "public"."benchmarks"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "benchmarks: signed in users read" ON "public"."benchmarks"
  FOR SELECT
  TO "authenticated"
  USING (true);

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."benchmark_snapshots";

COMMENT ON COLUMN "public"."benchmark_assumptions"."effective_from" IS 'The date the value refers to; documentation only, key is the primary key.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."model_version" IS 'The rule set and block schema that produced the row (benchmark-model@N); the reader picks the schema by it.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."updated_at" IS 'Present for the tenant table contract; no app path updates a snapshot.';

COMMENT ON COLUMN "public"."benchmarks"."industry_section" IS 'A NOGA 2008 section letter A to U, or ALL for every industry.';

COMMENT ON COLUMN "public"."benchmarks"."provisional" IS 'True until the owner replaced the value from the published table; the dashboard says so while any used row is provisional.';

COMMENT ON COLUMN "public"."benchmarks"."size_band" IS '1-49, 50-249, 250+ or all.';

COMMENT ON TABLE "public"."benchmark_assumptions" IS 'The stored constants of the incident cost model (spec 0008), one row per key. Every signed in user reads; ops and migrations write.';

COMMENT ON TABLE "public"."benchmark_snapshots" IS 'An immutable benchmark result per company (spec 0008): scalars for the card, blocks with the inputs, peer rows and assumptions used.';

COMMENT ON TABLE "public"."benchmarks" IS 'Peer quartiles per KPI, NOGA section, size band and year (spec 0008). Every signed in user reads; ops and migrations write.';

REVOKE ALL ON TABLE "public"."benchmark_assumptions" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."benchmark_assumptions" TO "anon";

REVOKE ALL ON TABLE "public"."benchmark_assumptions" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."benchmark_assumptions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."benchmark_assumptions" TO "postgres";

REVOKE ALL ON TABLE "public"."benchmark_assumptions" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."benchmark_assumptions" TO "service_role";

REVOKE ALL ON TABLE "public"."benchmark_snapshots" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."benchmark_snapshots" TO "anon";

REVOKE ALL ON TABLE "public"."benchmark_snapshots" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."benchmark_snapshots" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."benchmark_snapshots" TO "postgres";

REVOKE ALL ON TABLE "public"."benchmark_snapshots" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."benchmark_snapshots" TO "service_role";

REVOKE ALL ON TABLE "public"."benchmarks" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."benchmarks" TO "anon";

REVOKE ALL ON TABLE "public"."benchmarks" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."benchmarks" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."benchmarks" TO "postgres";

REVOKE ALL ON TABLE "public"."benchmarks" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."benchmarks" TO "service_role";

-- Re added by hand (AGENTS.md gotcha): the app roles never write a snapshot; the task does, as the
-- service role. A member insert fails on the grant, not only on a policy (spec 0008, AC-15).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "public"."benchmark_snapshots" FROM "anon", "authenticated";
REVOKE TRUNCATE ON TABLE "public"."benchmarks", "public"."benchmark_assumptions", "public"."benchmark_snapshots" FROM "anon", "authenticated", "service_role";
