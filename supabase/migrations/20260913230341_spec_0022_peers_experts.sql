-- Spec 0022, the peer benchmark from the research run: the peers a run finds replace the curated
-- library, so the four curated tables go and `research_peers` arrives; the snapshot gains the
-- three `@7` columns and loses the three `not null` the old blocks needed; the expert profile
-- gains the countries the suggestion ladder reads and `expert_suggestions` is the only way a
-- client ever sees an expert they are not assigned to.
--
-- Backward compatible as AGENTS.md requires: every added column is nullable or defaulted, the
-- dropped `not null`s only widen what a row may hold, and the four dropped tables have no reader
-- left in `src/` by this commit. Previews share staging, so the drops are the one irreversible
-- step here: the curated figures are committed in git history (the seed-data CSVs up to 041191f)
-- and reproducible from them if spec 0022 were ever reverted.

SET local check_function_bodies = off;

ALTER TABLE "public"."benchmarks"
  DROP CONSTRAINT "benchmarks_kpi_key_fkey";

ALTER TABLE "public"."peer_figures"
  DROP CONSTRAINT "peer_figures_kpi_key_fkey";

ALTER TABLE "public"."peer_figures"
  DROP CONSTRAINT "peer_figures_peer_key_fkey";

DROP TABLE "public"."benchmark_assumptions";

DROP TABLE "public"."benchmarks";

DROP TABLE "public"."peer_companies";

DROP TABLE "public"."peer_figures";

CREATE TABLE "public"."research_peers" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"    uuid                     NOT NULL,
  "company_id"         uuid                     NOT NULL,
  "research_run_id"    uuid                     NOT NULL,
  "peer_name"          text                     NOT NULL,
  "peer_website"       text,
  "peer_country"       text                     NOT NULL,
  "industry_section"   text                     NOT NULL,
  "headcount"          integer,
  "headcount_year"     integer,
  "kpi_key"            text                     NOT NULL,
  "period_year"        integer                  NOT NULL,
  "value"              numeric                  NOT NULL,
  "value_as_published" numeric                  NOT NULL,
  "unit_as_published"  text                     NOT NULL,
  "basis"              text,
  "source_url"         text                     NOT NULL,
  "source_title"       text,
  "confidence"         numeric                  NOT NULL,
  "rung"               text                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "research_peers_basis_check" CHECK ((basis = ANY (ARRAY['employees'::text, 'employees_and_contractors'::text]))),
  CONSTRAINT "research_peers_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT "research_peers_headcount_check" CHECK ((headcount > 0)),
  CONSTRAINT "research_peers_headcount_year_check" CHECK (((headcount_year >= 2000) AND (headcount_year <= 2100))),
  CONSTRAINT "research_peers_industry_section_check" CHECK ((industry_section ~ '^[A-U]$'::text)),
  CONSTRAINT "research_peers_kpi_key_check" CHECK ((kpi_key = ANY (ARRAY['ltifr'::text, 'trifr'::text]))),
  CONSTRAINT "research_peers_peer_country_check" CHECK ((peer_country ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT "research_peers_peer_name_check" CHECK (((char_length(peer_name) >= 1) AND (char_length(peer_name) <= 200))),
  CONSTRAINT "research_peers_period_year_check" CHECK (((period_year >= 2000) AND (period_year <= 2100))),
  CONSTRAINT "research_peers_pkey" PRIMARY KEY (id),
  CONSTRAINT "research_peers_rung_check" CHECK ((rung = ANY (ARRAY['country'::text, 'region'::text, 'world'::text]))),
  CONSTRAINT "research_peers_source_url_check" CHECK (((char_length(source_url) >= 1) AND (char_length(source_url) <= 2000))),
  CONSTRAINT "research_peers_unit_as_published_check" CHECK ((unit_as_published = ANY (ARRAY['per_million_hours'::text, 'per_200k_hours'::text, 'per_100_workers'::text]))),
  CONSTRAINT "research_peers_value_as_published_check" CHECK ((value_as_published >= (0)::numeric)),
  CONSTRAINT "research_peers_value_check" CHECK ((value >= (0)::numeric))
);

ALTER TABLE "public"."research_peers"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."benchmark_snapshots"
  ADD COLUMN "currency" text;

ALTER TABLE "public"."benchmark_snapshots"
  ADD COLUMN "loss_amount" numeric;

ALTER TABLE "public"."benchmark_snapshots"
  ADD COLUMN "saving_at_median" numeric;

ALTER TABLE "public"."expert_profiles"
  ADD COLUMN "countries" text[] NOT NULL DEFAULT '{}'::text[];

-- AC-25's backfill, which the declarative diff cannot know about: every expert on the books today
-- was recruited for Switzerland, so an empty array would drop them all off a Swiss client's
-- suggestions at the country rung. New rows keep the empty default.
UPDATE "public"."expert_profiles"
SET "countries" = ARRAY['CH']::text[]
WHERE "countries" = '{}'::text[];

ALTER TABLE "public"."research_runs"
  ADD COLUMN "peer_provider_run_id" text;

ALTER TABLE "public"."benchmark_snapshots"
  ALTER COLUMN "assumptions" DROP NOT NULL;

ALTER TABLE "public"."benchmark_snapshots"
  ALTER COLUMN "gaps" DROP NOT NULL;

ALTER TABLE "public"."benchmark_snapshots"
  ALTER COLUMN "results" DROP NOT NULL;

CREATE OR REPLACE FUNCTION private.is_active_expert (
  expert uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or expert is null then
    return false;
  end if;
  return exists (
    select 1
    from public.expert_profiles e
    where e.expert_id = expert
      and e.status = 'active'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.expert_suggestions (
  section          text,
  country          text,
  region_countries text[]
)
  RETURNS TABLE (
    expert_id    uuid,
    full_name    text,
    headline     text,
    industries   text[],
    countries    text[],
    languages    text[],
    availability text,
    photo_path   text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    e.expert_id,
    p.full_name,
    e.headline,
    e.industries,
    e.countries,
    e.languages,
    e.availability,
    e.photo_path
  from public.expert_profiles e
  join public.profiles p on p.id = e.expert_id
  where auth.uid() is not null
    and e.status = 'active'
    and section = any (e.industries)
  order by
    case
      when country = any (e.countries) then 0
      when e.countries && coalesce(region_countries, '{}') then 1
      else 2
    end,
    case e.availability
      when 'available' then 0
      when 'limited' then 1
      else 2
    end,
    e.years_experience desc nulls last,
    e.expert_id
  limit 3;
$function$;

ALTER TABLE "public"."benchmark_snapshots"
  ADD CONSTRAINT "benchmark_snapshots_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE "public"."expert_profiles"
  ADD CONSTRAINT "expert_profiles_countries_check" CHECK ((array_to_string(countries, ','::text) ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'::text));

ALTER TABLE "public"."research_peers"
  ADD CONSTRAINT "research_peers_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."research_peers"
  ADD CONSTRAINT "research_peers_kpi_key_fkey" FOREIGN KEY (kpi_key) REFERENCES public.kpi_definitions(key);

ALTER TABLE "public"."research_peers"
  ADD CONSTRAINT "research_peers_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."research_peers"
  ADD CONSTRAINT "research_peers_research_run_id_fkey" FOREIGN KEY (research_run_id) REFERENCES public.research_runs(id) ON DELETE CASCADE;

CREATE INDEX expert_profiles_countries_idx ON public.expert_profiles USING gin (countries);

CREATE INDEX research_peers_company_run_idx ON public.research_peers USING btree (company_id, research_run_id);

CREATE INDEX research_peers_organization_id_idx ON public.research_peers USING btree (organization_id);

CREATE UNIQUE INDEX research_peers_run_peer_kpi_idx ON public.research_peers USING btree (research_run_id, peer_name, kpi_key);

CREATE TRIGGER research_peers_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.research_peers
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE POLICY "research_peers: assigned experts read" ON "public"."research_peers"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_assigned_expert(research_peers.organization_id) AS is_assigned_expert));

CREATE POLICY "research_peers: members read their organization" ON "public"."research_peers"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "research_peers: ops full access" ON "public"."research_peers"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "expert photos: signed in read an active expert's" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING
    (((bucket_id = 'expert-photos'::text) AND ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND ( SELECT
    private.is_active_expert(((storage.foldername(objects.name))[1])::uuid) AS is_active_expert)));

COMMENT ON COLUMN "public"."benchmark_snapshots"."assumptions" IS 'The curated assumption rows benchmark-model@1 to @6 used; null from @7 on, whose constants live in src/features/benchmark/loss.ts.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."currency" IS 'The snapshot''s currency (spec 0022), copied from companies.currency; null on a row older than benchmark-model@7, which was always CHF.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."gaps" IS 'The ranked gaps of benchmark-model@1 to @6; null from @7 on.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."loss_amount" IS 'The client''s estimated yearly loss in `currency` (spec 0022, AC-14); null on a row older than benchmark-model@7 and whenever the loss could not be computed.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."peers" IS 'The peers the run found (spec 0022): the rung, the kept rows and the rank per rate; null when no peer was kept. On a @5 or @6 row this is the old named library block instead.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."results" IS 'The per KPI positions of benchmark-model@1 to @6; null from @7 on, which carries `peers` and `loss` instead.';

COMMENT ON COLUMN "public"."benchmark_snapshots"."saving_at_median" IS 'The saving at the peer median in `currency` (spec 0022, AC-14); null on a row older than benchmark-model@7 and whenever no peer rate was compared.';

COMMENT ON COLUMN "public"."expert_profiles"."countries" IS 'ISO 3166 alpha 2 codes the expert works in (spec 0022). Shape checked here, membership by Zod on the form.';

COMMENT ON COLUMN "public"."research_peers"."confidence" IS 'The validator''s confidence in the figure (AC-8); capped at 0.5 when the validation call was skipped.';

COMMENT ON COLUMN "public"."research_peers"."rung" IS 'Which ladder step the task settled on (AC-7): the same value on every row of a run.';

COMMENT ON COLUMN "public"."research_peers"."unit_as_published" IS 'The unit the peer printed; per_200k_hours and per_100_workers are both multiplied by five to reach value.';

COMMENT ON COLUMN "public"."research_peers"."value" IS 'Per million hours worked, converted in code from value_as_published and unit_as_published (AC-8).';

COMMENT ON COLUMN "public"."research_runs"."peer_provider_run_id" IS 'The provider''s run id for the peer search (spec 0022, AC-6): written before the first poll so a retry of research-peers resumes that run instead of paying twice.';

COMMENT ON FUNCTION "public"."expert_suggestions"(text, text, text[]) IS 'Up to three active experts for a section, by the country then region then world ladder (spec 0022, AC-26). The public half of the profile only.';

COMMENT ON TABLE "public"."research_peers" IS 'The published LTIFR and TRIFR of the peers one research run found (spec 0022); written by the research-peers task alone.';

REVOKE ALL ON FUNCTION "private"."is_active_expert"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_active_expert"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."expert_suggestions"(text, text, text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."expert_suggestions"(text, text, text[]) TO "authenticated", "postgres", "service_role";

REVOKE ALL ("countries") ON TABLE "public"."expert_profiles" FROM "authenticated";

GRANT UPDATE ("countries") ON TABLE "public"."expert_profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."research_peers" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."research_peers" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."research_peers" TO "postgres";

REVOKE ALL ON TABLE "public"."research_peers" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."research_peers" TO "service_role";

-- By hand (AGENTS.md, the diff's blind spots).
--
-- 1. `anon` keeps the full default grant set on a newly created table and the diff never emits the
--    revoke the schema file declares, so without this a signed out caller would hold INSERT,
--    UPDATE and DELETE on research_peers. RLS would still filter it to zero rows, but the grant is
--    the outer boundary the other tenant tables all close; research_peers.test.sql asserts the
--    read fails on the privilege.
REVOKE ALL ON TABLE "public"."research_peers" FROM "anon";

-- 2. The `anon` execute revoke on a new public function: the diff emits only `FROM PUBLIC`, which
--    does not remove the grant `anon` holds in its own right. contract.test.sql is the regression
--    net for the whole set.
REVOKE EXECUTE ON FUNCTION "public"."expert_suggestions"(text, text, text[]) FROM "anon";
REVOKE EXECUTE ON FUNCTION "private"."is_active_expert"(uuid) FROM "anon";

-- 3. The diff re-emitted a REVOKE ALL plus a full DML GRANT on the `assigned_expert_summaries` and
--    `expert_bookings` views. Both grant SELECT only to `authenticated`; the widening is dropped
--    here rather than committed, as in 20260913221714_spec_0022_company_currency.sql.
