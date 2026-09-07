SET local check_function_bodies = off;

CREATE TABLE "public"."peer_companies" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"       uuid                     NOT NULL,
  "industry_section" text                     NOT NULL,
  "size_band"        text                     NOT NULL,
  "status"           text                     NOT NULL DEFAULT 'proposed'::text,
  "display_label"    text,
  "proposed_by"      text                     NOT NULL,
  "proposal"         jsonb,
  "rejection_reason" text,
  "approved_by"      uuid,
  "approved_at"      timestamp with time zone,
  "researched_at"    timestamp with time zone,
  "last_run_id"      uuid,
  "failed_refreshes" integer                  NOT NULL DEFAULT 0,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "peer_companies_approved_at_when_approved" CHECK (((status <> 'approved'::text) OR (approved_at IS NOT NULL))),
  CONSTRAINT "peer_companies_company_id_key" UNIQUE (company_id),
  CONSTRAINT "peer_companies_display_label_check" CHECK ((display_label ~ '^Peer [A-J]$'::text)),
  CONSTRAINT "peer_companies_failed_refreshes_check" CHECK ((failed_refreshes >= 0)),
  CONSTRAINT "peer_companies_industry_section_check" CHECK ((industry_section ~ '^[A-U]$'::text)),
  CONSTRAINT "peer_companies_label_iff_approved" CHECK (((status = 'approved'::text) = (display_label IS NOT NULL))),
  CONSTRAINT "peer_companies_pkey" PRIMARY KEY (id),
  CONSTRAINT "peer_companies_proposed_by_check" CHECK ((proposed_by = ANY (ARRAY['ai'::text, 'ops'::text]))),
  CONSTRAINT "peer_companies_size_band_check" CHECK ((size_band = ANY (ARRAY['1-49'::text, '50-249'::text, '250+'::text, 'all'::text]))),
  CONSTRAINT "peer_companies_status_check" CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'retired'::text])))
);

ALTER TABLE "public"."peer_companies"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."companies"
  ADD COLUMN "is_peer" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION private.check_no_house_membership()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.organization_id = private.house_organization_id() then
    raise exception 'the house organization has no members'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_peer_company()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not exists (
    select 1 from public.companies c
    where c.id = new.company_id
      and c.organization_id = private.house_organization_id()
      and c.is_peer
  ) then
    raise exception 'a peer must be a company of the house organization marked is_peer'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.house_organization_id()
  RETURNS uuid
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select '99999999-9999-4999-8999-999999999999'::uuid;
$function$;

CREATE OR REPLACE FUNCTION private.research_run_allowed (
  organization_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  run_limit integer := case
    when organization_id = private.house_organization_id() then 50
    else 5
  end;
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
  ) < run_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_peer_research()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.status in ('succeeded', 'empty') then
    update public.peer_companies p
    set researched_at = coalesce(new.finished_at, now()),
        last_run_id = new.id,
        failed_refreshes = 0
    where p.company_id = new.company_id;
  elsif new.status = 'failed' and new.error_code is distinct from 'trigger_failed' then
    update public.peer_companies p
    set failed_refreshes = p.failed_refreshes + 1,
        last_run_id = new.id
    where p.company_id = new.company_id;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_peer_company (
  peer_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  peer public.peer_companies;
  approved_count integer;
  next_label text;
begin
  if caller is null or not private.is_ops() then
    raise exception 'not_authorized' using errcode = 'SM403';
  end if;

  select * into peer from public.peer_companies p where p.id = approve_peer_company.peer_id;
  if not found then
    raise exception 'not_found' using errcode = 'SM404';
  end if;
  if peer.status not in ('proposed', 'retired') then
    raise exception 'invalid_status' using errcode = 'SM409';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(peer.industry_section || '/' || peer.size_band, 0));

  select count(*) into approved_count
  from public.peer_companies p
  where p.industry_section = peer.industry_section
    and p.size_band = peer.size_band
    and p.status = 'approved';
  if approved_count >= 10 then
    raise exception 'set_full' using errcode = 'SM409';
  end if;

  select 'Peer ' || letter into next_label
  from unnest(array['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) as letter
  where not exists (
    select 1 from public.peer_companies p
    where p.industry_section = peer.industry_section
      and p.size_band = peer.size_band
      and p.display_label = 'Peer ' || letter
  )
  order by letter
  limit 1;

  update public.peer_companies p
  set status = 'approved',
      display_label = next_label,
      approved_by = caller,
      approved_at = now(),
      rejection_reason = null
  where p.id = peer.id;

  return next_label;
end;
$function$;

ALTER TABLE "public"."peer_companies"
  ADD CONSTRAINT "peer_companies_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."peer_companies"
  ADD CONSTRAINT "peer_companies_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."peer_companies"
  ADD CONSTRAINT "peer_companies_last_run_id_fkey" FOREIGN KEY (last_run_id) REFERENCES public.research_runs(id) ON DELETE SET NULL;

CREATE INDEX peer_companies_approved_by_idx ON public.peer_companies USING btree (approved_by);

CREATE UNIQUE INDEX peer_companies_label_idx ON public.peer_companies USING btree (industry_section, size_band, display_label)
  WHERE (display_label IS NOT NULL);

CREATE INDEX peer_companies_last_run_id_idx ON public.peer_companies USING btree (last_run_id);

CREATE INDEX peer_companies_refresh_idx ON public.peer_companies USING btree (status, researched_at);

CREATE INDEX peer_companies_set_idx ON public.peer_companies USING btree (industry_section, size_band, status);

CREATE TRIGGER organization_members_check_no_house_membership
  BEFORE INSERT OR UPDATE OF organization_id ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION private.check_no_house_membership();

CREATE TRIGGER peer_companies_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.peer_companies
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER peer_companies_check_company
  BEFORE INSERT OR UPDATE OF company_id ON public.peer_companies
  FOR EACH ROW
  EXECUTE FUNCTION private.check_peer_company();

CREATE TRIGGER peer_companies_set_updated_at
  BEFORE UPDATE ON public.peer_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER research_runs_sync_peer
  AFTER UPDATE OF status ON public.research_runs
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_peer_research();

CREATE POLICY "companies: signed in users read approved peers" ON "public"."companies"
  FOR SELECT
  TO "authenticated"
  USING ((is_peer AND (organization_id = ( SELECT private.house_organization_id() AS house_organization_id)) AND (EXISTS ( SELECT 1
   FROM public.peer_companies pc
  WHERE ((pc.company_id = companies.id) AND (pc.status = 'approved'::text))))));

CREATE POLICY "company_kpis: signed in users read approved peers" ON "public"."company_kpis"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.peer_companies pc
  WHERE ((pc.company_id = company_kpis.company_id) AND (pc.status = 'approved'::text)))));

CREATE POLICY "peer_companies: ops full access" ON "public"."peer_companies"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "peer_companies: signed in users read approved peers" ON "public"."peer_companies"
  FOR SELECT
  TO "authenticated"
  USING ((status = 'approved'::text));

COMMENT ON COLUMN "public"."companies"."is_peer" IS 'True for a peer company inside the house organization (spec 0012); never true for a client company.';

COMMENT ON COLUMN "public"."peer_companies"."failed_refreshes" IS 'Consecutive failed runs; reset on success, at 3 the peer is flagged and the schedule skips it.';

COMMENT ON COLUMN "public"."peer_companies"."proposal" IS '{model, promptVersion, reason, proposedAt} when a model proposed the peer; null when ops added it by hand.';

COMMENT ON COLUMN "public"."peer_companies"."researched_at" IS 'When the last run ended succeeded or empty; drives the yearly refresh.';

COMMENT ON FUNCTION "public"."approve_peer_company"(uuid) IS 'Ops approve a proposed or retired peer: at most ten per section and band, the next free label Peer A to Peer J (spec 0012).';

COMMENT ON TABLE "public"."peer_companies" IS 'A named peer company (spec 0012): section, band, status, anonymous label and refresh state; the company itself lives in the house organization.';

REVOKE ALL ON FUNCTION "private"."check_no_house_membership"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_no_house_membership"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."check_peer_company"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_peer_company"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."house_organization_id"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."house_organization_id"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."sync_peer_research"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."sync_peer_research"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."approve_peer_company"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."approve_peer_company"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."peer_companies" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."peer_companies" TO "anon";

REVOKE ALL ON TABLE "public"."peer_companies" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."peer_companies" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."peer_companies" TO "postgres";

REVOKE ALL ON TABLE "public"."peer_companies" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."peer_companies" TO "service_role";

CREATE OR REPLACE FUNCTION private.check_house_run_quota()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.organization_id = private.house_organization_id()
     and not private.research_run_allowed(new.organization_id) then
    raise exception 'quota_exceeded' using errcode = 'SM429';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_house_run_quota"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_house_run_quota"() TO "postgres";

CREATE TRIGGER research_runs_check_house_quota
  BEFORE INSERT ON public.research_runs
  FOR EACH ROW
  EXECUTE FUNCTION private.check_house_run_quota();

-- Added by hand (AGENTS.md): Supabase's default privileges grant execute on every new public
-- function to anon, and the REVOKE ... FROM PUBLIC above does not remove that direct grant.
REVOKE EXECUTE ON FUNCTION "public"."approve_peer_company"(uuid) FROM "anon";

-- The house organization (spec 0012, AC-1): the one ops owned organization every peer company
-- belongs to. Fixed id, no members (the trigger above refuses any), seeded here rather than in
-- seed.sql because production needs it too. Its id is private.house_organization_id().
INSERT INTO "public"."organizations" ("id", "name", "locale")
VALUES ('99999999-9999-4999-8999-999999999999', 'SME24 peer research', 'en')
ON CONFLICT ("id") DO NOTHING;
