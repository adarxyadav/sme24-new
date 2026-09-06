SET local check_function_bodies = off;

DROP POLICY "research_runs: members request a run for their organization" ON "public"."research_runs";

ALTER TABLE "public"."research_runs"
  ADD COLUMN "provider_run_id" text;

CREATE OR REPLACE FUNCTION private.research_run_allowed (
  organization_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if organization_id is null then
    return false;
  end if;
  return (
    select count(*)
    from public.research_runs r
    where r.organization_id = research_run_allowed.organization_id
      and r.created_at > now() - interval '24 hours'
      and r.error_code is distinct from 'trigger_failed'
  ) < 5;
end;
$function$;

CREATE UNIQUE INDEX research_runs_one_open_per_company_idx ON public.research_runs USING btree (company_id)
  WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE POLICY "research_runs: members close their own queued run" ON "public"."research_runs"
  FOR UPDATE
  TO "authenticated"
  USING (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (requested_by = ( SELECT auth.uid() AS uid)) AND (status = 'queued'::text)))
  WITH
    CHECK
    (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (requested_by = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['queued'::text, 'failed'::text]))));

CREATE POLICY "research_runs: members request a run for their organization" ON "public"."research_runs"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (requested_by = ( SELECT auth.uid() AS uid)) AND (status = 'queued'::text) AND (EXISTS ( SELECT 1
   FROM public.companies c
  WHERE ((c.id = research_runs.company_id) AND (c.organization_id = research_runs.organization_id)))) AND
    ( SELECT private.research_run_allowed(research_runs.organization_id) AS research_run_allowed)));

COMMENT ON COLUMN "public"."company_kpis"."sources" IS 'Array of {url, title, excerpt, retrievedAt} the value was taken from.';

COMMENT ON COLUMN "public"."research_runs"."provider_run_id" IS 'The research provider''s run id (spec 0007): written before the first poll so a retry resumes instead of paying twice.';

REVOKE ALL ON FUNCTION "private"."research_run_allowed"(uuid) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "private"."research_run_allowed"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."research_runs" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."research_runs" TO "authenticated";

-- Hand moved below the table level revoke (pgdelta emits them before, which would drop them):
-- spec 0007, AC-2: members may update these five columns only.
REVOKE ALL ("error_code") ON TABLE "public"."research_runs" FROM "authenticated";

GRANT UPDATE ("error_code") ON TABLE "public"."research_runs" TO "authenticated";

REVOKE ALL ("error_message") ON TABLE "public"."research_runs" FROM "authenticated";

GRANT UPDATE ("error_message") ON TABLE "public"."research_runs" TO "authenticated";

REVOKE ALL ("finished_at") ON TABLE "public"."research_runs" FROM "authenticated";

GRANT UPDATE ("finished_at") ON TABLE "public"."research_runs" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."research_runs" FROM "authenticated";

GRANT UPDATE ("status") ON TABLE "public"."research_runs" TO "authenticated";

REVOKE ALL ("trigger_run_id") ON TABLE "public"."research_runs" FROM "authenticated";

GRANT UPDATE ("trigger_run_id") ON TABLE "public"."research_runs" TO "authenticated";

-- Data migration (spec 0007, AC-1): the eight KPIs of the catalogue, in sort order. Names and
-- descriptions are keyed by locale; the TypeScript catalogue (src/features/research/catalogue.ts)
-- lists the same keys with the ranges and parse rules. A rerun updates the text columns.
insert into public.kpi_definitions (key, name, description, unit, direction, sort_order, is_active) values
  ('ltifr',
   '{"de":"LTIFR (Unfälle mit Ausfallzeit)","en":"LTIFR (lost time injury frequency rate)"}',
   '{"de":"Unfälle mit Ausfallzeit pro 1 000 000 geleistete Arbeitsstunden.","en":"Lost time injuries per 1 000 000 hours worked."}',
   'per 1 000 000 hours worked', 'lower_is_better', 10, true),
  ('trifr',
   '{"de":"TRIFR (meldepflichtige Verletzungen)","en":"TRIFR (total recordable injury frequency rate)"}',
   '{"de":"Meldepflichtige Verletzungen pro 1 000 000 geleistete Arbeitsstunden.","en":"Recordable injuries per 1 000 000 hours worked."}',
   'per 1 000 000 hours worked', 'lower_is_better', 20, true),
  ('fatalities',
   '{"de":"Todesfälle","en":"Fatalities"}',
   '{"de":"Arbeitsbedingte Todesfälle im Berichtsjahr.","en":"Work related fatalities in the reporting year."}',
   'count', 'lower_is_better', 30, true),
  ('lost_days_per_incident',
   '{"de":"Ausfalltage pro Unfall","en":"Lost days per incident"}',
   '{"de":"Durchschnittliche Ausfalltage pro Unfall mit Ausfallzeit.","en":"Average lost work days per lost time incident."}',
   'days', 'lower_is_better', 40, true),
  ('accident_rate_per_1000_fte',
   '{"de":"Unfallrate pro 1 000 Vollzeitstellen","en":"Accident rate per 1 000 FTE"}',
   '{"de":"Berufsunfälle pro 1 000 Vollzeitäquivalente.","en":"Occupational accidents per 1 000 full time equivalents."}',
   'per 1 000 full time equivalents', 'lower_is_better', 50, true),
  ('absenteeism_rate',
   '{"de":"Absenzenquote","en":"Absenteeism rate"}',
   '{"de":"Absenztage in Prozent der Sollarbeitstage.","en":"Absence days as a percentage of scheduled working days."}',
   'percent', 'lower_is_better', 60, true),
  ('near_miss_rate',
   '{"de":"Beinaheunfälle pro 100 Mitarbeitende","en":"Near misses per 100 employees"}',
   '{"de":"Gemeldete Beinaheunfälle pro 100 Mitarbeitende.","en":"Reported near misses per 100 employees."}',
   'per 100 employees', 'higher_is_better', 70, true),
  ('iso_45001_certified',
   '{"de":"ISO 45001 zertifiziert","en":"ISO 45001 certified"}',
   '{"de":"Ob eine gültige ISO 45001 Zertifizierung besteht (1 ja, 0 nein).","en":"Whether an ISO 45001 certification is in force (1 yes, 0 no)."}',
   'yes or no', 'higher_is_better', 80, true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  unit = excluded.unit,
  direction = excluded.direction,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
