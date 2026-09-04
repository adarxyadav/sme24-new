SET local check_function_bodies = off;

DROP POLICY "company_kpis: members update their client rows" ON "public"."company_kpis";

DROP POLICY "organization_members: owners insert within their organization" ON "public"."organization_members";

CREATE OR REPLACE FUNCTION private.check_company_kpi_identity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.company_id is distinct from old.company_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'company_kpis identity is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
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
  raise exception 'invalid expert_assignments transition % -> % on %', old.status, new.status, old.id
    using errcode = 'check_violation';
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_organization_owner_columns()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.is_ops() then
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at
     or new.created_by is distinct from old.created_by
     or new.id is distinct from old.id then
    raise exception 'only name is editable by an owner'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_profile_organization()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if caller is not null and caller is distinct from new.user_id then
      return new;
    end if;
    update public.profiles
    set organization_id = new.organization_id
    where id = new.user_id and organization_id is null;
    return new;
  end if;

  update public.profiles
  set organization_id = null
  where id = old.user_id and organization_id = old.organization_id;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_organization_member (
  organization_id uuid,
  user_id         uuid,
  role            text DEFAULT 'member'::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  member_id uuid;
begin
  if role not in ('owner', 'member') then
    raise exception 'invalid_role';
  end if;

  if caller is null
     or not private.is_org_owner(add_organization_member.organization_id) then
    raise exception 'not_an_owner';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = add_organization_member.user_id
      and p.role = 'client'
      and p.organization_id is null
  ) then
    raise exception 'not_a_client';
  end if;

  if exists (
    select 1 from public.organization_members m
    where m.user_id = add_organization_member.user_id
  ) then
    raise exception 'already_member';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (
    add_organization_member.organization_id,
    add_organization_member.user_id,
    add_organization_member.role
  )
  returning id into member_id;

  update public.profiles p
  set organization_id = add_organization_member.organization_id
  where p.id = add_organization_member.user_id and p.organization_id is null;

  return member_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook (
  event jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  claims jsonb;
  user_role public.app_role;
  user_org uuid;
begin
  select role, organization_id into user_role, user_org
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  -- The hook owns app_metadata.role and app_metadata.organization_id unconditionally: both keys
  -- are stripped first and only written back from the profile. Without the else branch a user
  -- with no profile row would keep whatever the incoming claims carried, and Supabase builds
  -- those from raw_app_meta_data, which sign up can influence: a self supplied role of `ops`
  -- would pass straight through.
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    (coalesce(claims -> 'app_metadata', '{}'::jsonb) - 'role' - 'organization_id')
      || case
           when user_role is not null then jsonb_build_object('role', user_role::text)
           else '{}'::jsonb
         end
      || case
           when user_role is not null and user_org is not null
             then jsonb_build_object('organization_id', user_org::text)
           else '{}'::jsonb
         end,
    true
  );

  return jsonb_set(event, '{claims}', claims);
end;
$function$;

-- Validated immediately, which is safe here: companies ships in this same slice, the seed writes
-- none, and no environment holds a row yet. A later check on a populated table would need the
-- NOT VALID then VALIDATE two step instead.
ALTER TABLE "public"."companies"
  ADD CONSTRAINT "companies_uid_check" CHECK ((uid ~ '^CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}$'::text));

CREATE TRIGGER company_kpis_check_identity
  BEFORE UPDATE OF company_id, organization_id ON public.company_kpis
  FOR EACH ROW
  EXECUTE FUNCTION private.check_company_kpi_identity();

CREATE TRIGGER organizations_check_owner_columns
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION private.check_organization_owner_columns();

CREATE POLICY "company_kpis: members update their client rows" ON "public"."company_kpis"
  FOR UPDATE
  TO "authenticated"
  USING (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (source = 'client'::text) AND (created_by = ( SELECT auth.uid() AS uid))))
  WITH CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (source = 'client'::text) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.companies c
  WHERE ((c.id = company_kpis.company_id) AND (c.organization_id = company_kpis.organization_id))))));

COMMENT ON COLUMN "public"."companies"."uid" IS 'The Swiss company identifier, formatted CHE-123.456.789.';

COMMENT ON FUNCTION "public"."add_organization_member"(uuid, uuid, text) IS 'Owner adds a member to their organization. Only a client with no organization can be added.';

REVOKE ALL ON FUNCTION "private"."check_company_kpi_identity"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_company_kpi_identity"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."check_organization_owner_columns"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_organization_owner_columns"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."add_organization_member"(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."add_organization_member"(uuid, uuid, text) TO "authenticated", "postgres", "service_role";

-- Hand added: the default privileges of schema public grant execute to anon at creation, and the
-- diff does not carry the revoke (same as create_organization in the earlier migration).
REVOKE EXECUTE ON FUNCTION "public"."add_organization_member"(uuid, uuid, text) FROM "anon";

-- Hand added: the diff does not detect a view body rewritten from `select *` to an explicit
-- column list, because the expanded columns are identical today. Listing them makes the view's
-- shape a decision, so a later column added to company_kpis does not silently join its contract.
CREATE OR REPLACE VIEW "public"."company_kpi_current"
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (company_id, kpi_key, period_year)
  id, organization_id, company_id, research_run_id, kpi_key, period_year, value, source,
  confidence, sources, note, created_by, created_at, updated_at
FROM public.company_kpis
ORDER BY company_id, kpi_key, period_year, (source = 'client') DESC, created_at DESC;

REVOKE ALL ON TABLE "public"."companies" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."companies" TO "anon";

REVOKE ALL ON TABLE "public"."companies" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."companies" TO "authenticated";

REVOKE ALL ON TABLE "public"."companies" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."companies" TO "service_role";

REVOKE ALL ON TABLE "public"."company_kpis" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."company_kpis" TO "anon";

REVOKE ALL ON TABLE "public"."company_kpis" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."company_kpis" TO "authenticated";

REVOKE ALL ON TABLE "public"."company_kpis" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."company_kpis" TO "service_role";

REVOKE ALL ON TABLE "public"."expert_assignments" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."expert_assignments" TO "anon";

REVOKE ALL ON TABLE "public"."expert_assignments" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."expert_assignments" TO "authenticated";

REVOKE ALL ON TABLE "public"."expert_assignments" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."expert_assignments" TO "service_role";

REVOKE ALL ON TABLE "public"."kpi_definitions" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."kpi_definitions" TO "anon";

REVOKE ALL ON TABLE "public"."kpi_definitions" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."kpi_definitions" TO "authenticated";

REVOKE ALL ON TABLE "public"."kpi_definitions" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."kpi_definitions" TO "service_role";

REVOKE ALL ON TABLE "public"."organization_members" FROM "anon";

GRANT DELETE, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."organization_members" TO "anon";

REVOKE ALL ON TABLE "public"."organization_members" FROM "authenticated";

GRANT DELETE, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."organization_members" TO "authenticated";

REVOKE ALL ON TABLE "public"."organization_members" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."organization_members" TO "service_role";

REVOKE ALL ON TABLE "public"."organizations" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."organizations" TO "anon";

REVOKE ALL ON TABLE "public"."organizations" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."organizations" TO "authenticated";

REVOKE ALL ON TABLE "public"."organizations" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."organizations" TO "service_role";

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."profiles" TO "anon";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."profiles" TO "authenticated";

-- Hand added: the REVOKE ALL above (which is what drops TRUNCATE) also drops the column level
-- UPDATE grants set by 20260903193805_data_model_core.sql, so they are restored here. Without
-- these two lines a user cannot edit their own full_name or locale at all. Same ordering rule as
-- the original migration: table revoke first, column grants after it.
GRANT UPDATE ("full_name") ON TABLE "public"."profiles" TO "authenticated";

GRANT UPDATE ("locale") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."research_runs" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."research_runs" TO "anon";

REVOKE ALL ON TABLE "public"."research_runs" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."research_runs" TO "authenticated";

REVOKE ALL ON TABLE "public"."research_runs" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."research_runs" TO "service_role";

REVOKE ALL ON TABLE "public"."scaffold_checks" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."scaffold_checks" TO "anon";

REVOKE ALL ON TABLE "public"."scaffold_checks" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."scaffold_checks" TO "authenticated";

REVOKE ALL ON TABLE "public"."scaffold_checks" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."scaffold_checks" TO "service_role";
