SET local check_function_bodies = off;

CREATE TABLE "public"."audit_log" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "occurred_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "actor_id"        uuid,
  "actor_role"      text                     NOT NULL,
  "organization_id" uuid,
  "table_name"      text                     NOT NULL,
  "row_id"          text                     NOT NULL,
  "action"          text                     NOT NULL,
  "old_data"        jsonb,
  "new_data"        jsonb,
  "changed_columns" text[],
  CONSTRAINT "audit_log_action_check" CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))),
  CONSTRAINT "audit_log_actor_role_check" CHECK ((actor_role = ANY (ARRAY['client'::text, 'expert'::text, 'ops'::text, 'service'::text, 'system'::text]))),
  CONSTRAINT "audit_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_log"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."companies" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "name"            text                     NOT NULL,
  "legal_name"      text,
  "uid"             text,
  "website"         text,
  "industry_code"   text,
  "employees_count" integer,
  "canton"          text,
  "country"         text                     NOT NULL DEFAULT 'CH'::text,
  "created_by"      uuid,
  "archived_at"     timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "companies_canton_check" CHECK ((canton ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT "companies_employees_count_check" CHECK ((employees_count >= 0)),
  CONSTRAINT "companies_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."companies"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."company_kpis" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "company_id"      uuid                     NOT NULL,
  "research_run_id" uuid,
  "kpi_key"         text                     NOT NULL,
  "period_year"     integer                  NOT NULL,
  "value"           numeric                  NOT NULL,
  "source"          text                     NOT NULL,
  "confidence"      numeric,
  "sources"         jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "note"            text,
  "created_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "company_kpis_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT "company_kpis_period_year_check" CHECK (((period_year >= 2000) AND (period_year <= 2100))),
  CONSTRAINT "company_kpis_pkey" PRIMARY KEY (id),
  CONSTRAINT "company_kpis_source_check" CHECK ((source = ANY (ARRAY['research'::text, 'client'::text]))),
  CONSTRAINT "company_kpis_sources_check" CHECK ((jsonb_typeof(sources) = 'array'::text))
);

ALTER TABLE "public"."company_kpis"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."expert_assignments" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "expert_id"       uuid                     NOT NULL,
  "status"          text                     NOT NULL DEFAULT 'active'::text,
  "assigned_by"     uuid,
  "started_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at"        timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "expert_assignments_pkey" PRIMARY KEY (id),
  CONSTRAINT "expert_assignments_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])))
);

ALTER TABLE "public"."expert_assignments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."kpi_definitions" (
  "key"         text                     NOT NULL,
  "name"        jsonb                    NOT NULL,
  "description" jsonb,
  "unit"        text                     NOT NULL,
  "direction"   text                     NOT NULL,
  "sort_order"  integer                  NOT NULL DEFAULT 0,
  "is_active"   boolean                  NOT NULL DEFAULT true,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "kpi_definitions_description_check"
    CHECK (((description IS NULL) OR ((jsonb_typeof(description) = 'object'::text) AND (description ? 'de'::text) AND (description ? 'en'::text)))),
  CONSTRAINT "kpi_definitions_direction_check" CHECK ((direction = ANY (ARRAY['lower_is_better'::text, 'higher_is_better'::text, 'neutral'::text]))),
  CONSTRAINT "kpi_definitions_name_check" CHECK (((jsonb_typeof(name) = 'object'::text) AND (name ? 'de'::text) AND (name ? 'en'::text))),
  CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."kpi_definitions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."research_runs" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "company_id"      uuid                     NOT NULL,
  "status"          text                     NOT NULL DEFAULT 'queued'::text,
  "trigger_run_id"  text,
  "requested_by"    uuid,
  "started_at"      timestamp with time zone,
  "finished_at"     timestamp with time zone,
  "error_code"      text,
  "error_message"   text,
  "summary"         jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "research_runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "research_runs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'empty'::text, 'failed'::text])))
);

ALTER TABLE "public"."research_runs"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.audit_row()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  app_role text := claims -> 'app_metadata' ->> 'role';
  row_old jsonb;
  row_new jsonb;
  subject jsonb;
  changed text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    row_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    row_new := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
    into changed
    from jsonb_each(row_new) n
    where row_old -> n.key is distinct from n.value;
  end if;
  subject := coalesce(row_new, row_old);

  insert into public.audit_log (
    actor_id, actor_role, organization_id, table_name, row_id, action, old_data, new_data, changed_columns
  )
  values (
    (claims ->> 'sub')::uuid,
    case
      when app_role in ('client', 'expert', 'ops') then app_role
      when claims ->> 'role' = 'service_role' then 'service'
      else 'system'
    end,
    case when subject ? 'organization_id' then (subject ->> 'organization_id')::uuid end,
    tg_table_name,
    subject ->> 'id',
    lower(tg_op),
    row_old,
    row_new,
    changed
  );
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_expert_assignment_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if old.status = 'active' and new.status = 'ended' then
    new.ended_at := coalesce(new.ended_at, now());
    return new;
  end if;
  raise exception 'invalid expert_assignments transition % -> %', old.status, new.status
    using errcode = 'check_violation';
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_research_run_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if (old.status = 'queued' and new.status in ('running', 'failed'))
     or (old.status = 'running' and new.status in ('succeeded', 'empty', 'failed')) then
    return new;
  end if;
  raise exception 'invalid research_runs transition % -> %', old.status, new.status
    using errcode = 'check_violation';
end;
$function$;

CREATE OR REPLACE FUNCTION private.is_assigned_expert (
  org uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null or org is null or private.jwt_app_role() is distinct from 'expert' then
    return false;
  end if;
  return exists (
    select 1
    from public.expert_assignments a
    where a.organization_id = org
      and a.expert_id = caller
      and a.status = 'active'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_audit_log()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if coalesce(current_setting('app.audit_maintenance', true), '') <> 'on' then
    raise exception 'audit_log is append only';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_kpis"
  ADD CONSTRAINT "company_kpis_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_kpis"
  ADD CONSTRAINT "company_kpis_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."company_kpis"
  ADD CONSTRAINT "company_kpis_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."expert_assignments"
  ADD CONSTRAINT "expert_assignments_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."expert_assignments"
  ADD CONSTRAINT "expert_assignments_expert_id_fkey" FOREIGN KEY (expert_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."expert_assignments"
  ADD CONSTRAINT "expert_assignments_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_kpis"
  ADD CONSTRAINT "company_kpis_kpi_key_fkey" FOREIGN KEY (kpi_key) REFERENCES public.kpi_definitions(key);

ALTER TABLE "public"."research_runs"
  ADD CONSTRAINT "research_runs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."research_runs"
  ADD CONSTRAINT "research_runs_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_kpis"
  ADD CONSTRAINT "company_kpis_research_run_id_fkey" FOREIGN KEY (research_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;

ALTER TABLE "public"."research_runs"
  ADD CONSTRAINT "research_runs_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE VIEW "public"."company_kpi_current" WITH (security_invoker=true) AS  SELECT DISTINCT ON (company_id, kpi_key, period_year) id,
    organization_id,
    company_id,
    research_run_id,
    kpi_key,
    period_year,
    value,
    source,
    confidence,
    sources,
    note,
    created_by,
    created_at,
    updated_at
   FROM public.company_kpis
  ORDER BY company_id, kpi_key, period_year, (source = 'client'::text) DESC, created_at DESC;

CREATE INDEX audit_log_actor_id_occurred_at_idx ON public.audit_log USING btree (actor_id, occurred_at DESC);

CREATE INDEX audit_log_organization_id_occurred_at_idx ON public.audit_log USING btree (organization_id, occurred_at DESC);

CREATE INDEX audit_log_table_name_row_id_idx ON public.audit_log USING btree (table_name, row_id);

CREATE INDEX companies_created_by_idx ON public.companies USING btree (created_by);

CREATE INDEX companies_organization_id_created_at_idx ON public.companies USING btree (organization_id, created_at DESC);

CREATE UNIQUE INDEX companies_organization_id_uid_idx ON public.companies USING btree (organization_id, uid)
  WHERE (uid IS NOT NULL);

CREATE UNIQUE INDEX company_kpis_client_company_kpi_year_idx ON public.company_kpis USING btree (company_id, kpi_key, period_year)
  WHERE (source = 'client'::text);

CREATE INDEX company_kpis_company_kpi_year_idx ON public.company_kpis USING btree (company_id, kpi_key, period_year);

CREATE INDEX company_kpis_created_by_idx ON public.company_kpis USING btree (created_by);

CREATE INDEX company_kpis_kpi_key_idx ON public.company_kpis USING btree (kpi_key);

CREATE INDEX company_kpis_organization_id_idx ON public.company_kpis USING btree (organization_id);

CREATE UNIQUE INDEX company_kpis_research_run_kpi_year_idx ON public.company_kpis USING btree (research_run_id, kpi_key, period_year)
  WHERE (research_run_id IS NOT NULL);

CREATE INDEX expert_assignments_active_expert_idx ON public.expert_assignments USING btree (expert_id)
  WHERE (status = 'active'::text);

CREATE UNIQUE INDEX expert_assignments_active_organization_expert_idx ON public.expert_assignments USING btree (organization_id, expert_id)
  WHERE (status = 'active'::text);

CREATE INDEX expert_assignments_assigned_by_idx ON public.expert_assignments USING btree (assigned_by);

CREATE INDEX expert_assignments_organization_id_created_at_idx ON public.expert_assignments USING btree (organization_id, created_at DESC);

CREATE INDEX research_runs_company_id_created_at_idx ON public.research_runs USING btree (company_id, created_at DESC);

CREATE INDEX research_runs_open_status_idx ON public.research_runs USING btree (status)
  WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX research_runs_organization_id_created_at_idx ON public.research_runs USING btree (organization_id, created_at DESC);

CREATE INDEX research_runs_requested_by_idx ON public.research_runs USING btree (requested_by);

CREATE TRIGGER audit_log_protect
  BEFORE DELETE OR UPDATE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_audit_log();

CREATE TRIGGER companies_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER company_kpis_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.company_kpis
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER company_kpis_set_updated_at
  BEFORE UPDATE ON public.company_kpis
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER expert_assignments_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.expert_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER expert_assignments_check_transition
  BEFORE UPDATE OF status ON public.expert_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.check_expert_assignment_transition();

CREATE TRIGGER expert_assignments_set_updated_at
  BEFORE UPDATE ON public.expert_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER kpi_definitions_set_updated_at
  BEFORE UPDATE ON public.kpi_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER organization_members_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER organizations_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER profiles_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER research_runs_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.research_runs
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER research_runs_check_transition
  BEFORE UPDATE OF status ON public.research_runs
  FOR EACH ROW
  EXECUTE FUNCTION private.check_research_run_transition();

CREATE TRIGGER research_runs_set_updated_at
  BEFORE UPDATE ON public.research_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "audit_log: ops read" ON "public"."audit_log"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "companies: assigned experts read" ON "public"."companies"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_assigned_expert(companies.organization_id) AS is_assigned_expert));

CREATE POLICY "companies: members insert into their organization" ON "public"."companies"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "companies: members read their organization" ON "public"."companies"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "companies: members update their organization" ON "public"."companies"
  FOR UPDATE
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)))
  WITH CHECK ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "companies: ops full access" ON "public"."companies"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "company_kpis: assigned experts read" ON "public"."company_kpis"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_assigned_expert(company_kpis.organization_id) AS is_assigned_expert));

CREATE POLICY "company_kpis: members delete their client rows" ON "public"."company_kpis"
  FOR DELETE
  TO "authenticated"
  USING (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (source = 'client'::text) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "company_kpis: members insert client rows" ON "public"."company_kpis"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (source = 'client'::text) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.companies c
  WHERE ((c.id = company_kpis.company_id) AND (c.organization_id = company_kpis.organization_id))))));

CREATE POLICY "company_kpis: members read their organization" ON "public"."company_kpis"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "company_kpis: members update their client rows" ON "public"."company_kpis"
  FOR UPDATE
  TO "authenticated"
  USING (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (source = 'client'::text) AND (created_by = ( SELECT auth.uid() AS uid))))
  WITH CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (source = 'client'::text) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "company_kpis: ops full access" ON "public"."company_kpis"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "expert_assignments: experts read their own rows" ON "public"."expert_assignments"
  FOR SELECT
  TO "authenticated"
  USING ((expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "expert_assignments: members read their organization" ON "public"."expert_assignments"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "expert_assignments: ops full access" ON "public"."expert_assignments"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "kpi_definitions: ops insert" ON "public"."kpi_definitions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "kpi_definitions: ops update" ON "public"."kpi_definitions"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "kpi_definitions: signed in users read" ON "public"."kpi_definitions"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "organizations: assigned experts read" ON "public"."organizations"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_assigned_expert(organizations.id) AS is_assigned_expert));

CREATE POLICY "research_runs: assigned experts read" ON "public"."research_runs"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_assigned_expert(research_runs.organization_id) AS is_assigned_expert));

CREATE POLICY "research_runs: members read their organization" ON "public"."research_runs"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "research_runs: members request a run for their organization" ON "public"."research_runs"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (requested_by = ( SELECT auth.uid() AS uid)) AND (status = 'queued'::text) AND (EXISTS ( SELECT 1
   FROM public.companies c
  WHERE ((c.id = research_runs.company_id) AND (c.organization_id = research_runs.organization_id))))));

CREATE POLICY "research_runs: ops full access" ON "public"."research_runs"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."research_runs";

COMMENT ON COLUMN "public"."audit_log"."actor_role" IS 'client, expert or ops from the token; service for the service key; system when there is no token (migrations, seed, auth admin).';

COMMENT ON COLUMN "public"."companies"."industry_code" IS 'NOGA industry code.';

COMMENT ON COLUMN "public"."companies"."uid" IS 'The Swiss company identifier (CHE-…).';

COMMENT ON COLUMN "public"."company_kpis"."sources" IS 'Array of {url, title, excerpt, retrieved_at} the value was taken from.';

COMMENT ON COLUMN "public"."research_runs"."error_message" IS 'A message safe to show to the client; details go to Sentry.';

COMMENT ON COLUMN "public"."research_runs"."summary" IS 'What feature 8 shows about sources and coverage.';

COMMENT ON TABLE "public"."audit_log" IS 'Append only trail of every write on the audited tables. Ops read; nobody updates or deletes outside the maintenance path.';

COMMENT ON TABLE "public"."companies" IS 'An assessed company inside an organization.';

COMMENT ON TABLE "public"."company_kpis" IS 'A KPI value per company, KPI and year, from research or entered by the client.';

COMMENT ON TABLE "public"."expert_assignments" IS 'An expert''s access to one organization. Active rows grant read access through private.is_assigned_expert.';

COMMENT ON TABLE "public"."kpi_definitions" IS 'Global catalogue of safety KPIs (for example ltifr). Every signed in user reads; ops write.';

COMMENT ON TABLE "public"."research_runs" IS 'One research job per company: queued → running → succeeded | empty | failed (queued → failed allowed).';

COMMENT ON VIEW "public"."company_kpi_current" IS 'One row per company, KPI and year: the client row when present, else the newest research row.';

REVOKE ALL ON FUNCTION "private"."audit_row"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."audit_row"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."check_expert_assignment_transition"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_expert_assignment_transition"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."check_research_run_transition"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_research_run_transition"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."is_assigned_expert"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_assigned_expert"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."protect_audit_log"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."protect_audit_log"() TO "postgres";

REVOKE ALL ON TABLE "public"."audit_log" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."audit_log" TO "anon";

REVOKE ALL ON TABLE "public"."audit_log" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."audit_log" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_log" TO "postgres";

REVOKE ALL ON TABLE "public"."audit_log" FROM "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."audit_log" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."companies" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."company_kpis" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expert_assignments" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."kpi_definitions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."research_runs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."company_kpi_current" TO "anon", "authenticated", "postgres", "service_role";
