SET local check_function_bodies = off;

CREATE SCHEMA "private";

CREATE TABLE "public"."organization_members" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "user_id"         uuid                     NOT NULL,
  "role"            text                     NOT NULL DEFAULT 'member'::text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "organization_members_organization_id_user_id_key" UNIQUE (organization_id, user_id),
  CONSTRAINT "organization_members_pkey" PRIMARY KEY (id),
  CONSTRAINT "organization_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])))
);

ALTER TABLE "public"."organization_members"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."organizations" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"        text                     NOT NULL,
  "created_by"  uuid,
  "archived_at" timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "organizations_name_check" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200))),
  CONSTRAINT "organizations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."organizations"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profiles"
  ADD COLUMN "full_name" text;

ALTER TABLE "public"."profiles"
  ADD COLUMN "locale" text NOT NULL DEFAULT 'de'::text;

CREATE OR REPLACE FUNCTION private.is_ops()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(private.jwt_app_role() = 'ops', false);
$function$;

CREATE OR REPLACE FUNCTION private.is_org_owner (
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
  if caller is null or org is null then
    return false;
  end if;
  return exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = caller
      and m.role = 'owner'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.jwt_app_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select auth.jwt() -> 'app_metadata' ->> 'role';
$function$;

CREATE OR REPLACE FUNCTION private.jwt_org_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION private.sync_profile_organization()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'INSERT' then
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

CREATE OR REPLACE FUNCTION public.create_organization (
  name text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  org_id uuid;
begin
  if caller is null or private.jwt_app_role() is distinct from 'client' then
    raise exception 'not_a_client';
  end if;

  if exists (select 1 from public.organization_members m where m.user_id = caller) then
    raise exception 'already_member';
  end if;

  insert into public.organizations (name, created_by)
  values (create_organization.name, caller)
  returning id into org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (org_id, caller, 'owner');

  update public.profiles
  set organization_id = org_id
  where id = caller and organization_id is distinct from org_id;

  return org_id;
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

  if user_role is not null then
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      (coalesce(claims -> 'app_metadata', '{}'::jsonb) - 'organization_id')
        || jsonb_build_object('role', user_role::text)
        || case
             when user_org is not null then jsonb_build_object('organization_id', user_org::text)
             else '{}'::jsonb
           end,
      true
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  requested_role text := new.raw_app_meta_data ->> 'role';
  requested_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (id, role, full_name, locale)
  values (
    new.id,
    case
      when requested_role in ('client', 'expert', 'ops') then requested_role::public.app_role
      else 'client'::public.app_role
    end,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when requested_locale in ('de', 'en') then requested_locale else 'de' end
  );
  return new;
end;
$function$;

ALTER TABLE "public"."organization_members"
  ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."organizations"
  ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."organization_members"
  ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_locale_check" CHECK ((locale = ANY (ARRAY['de'::text, 'en'::text])));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX organization_members_user_id_idx ON public.organization_members USING btree (user_id);

CREATE INDEX organizations_created_by_idx ON public.organizations USING btree (created_by);

CREATE INDEX profiles_organization_id_idx ON public.profiles USING btree (organization_id);

CREATE TRIGGER organization_members_set_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER organization_members_sync_profile_organization
  AFTER INSERT OR DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_profile_organization();

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "organization_members: members read their organization" ON "public"."organization_members"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "organization_members: ops full access" ON "public"."organization_members"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "organization_members: owners delete within their organization" ON "public"."organization_members"
  FOR DELETE
  TO "authenticated"
  USING (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND ( SELECT private.is_org_owner(organization_members.organization_id) AS is_org_owner)));

CREATE POLICY "organization_members: owners insert within their organization" ON "public"."organization_members"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND ( SELECT private.is_org_owner(organization_members.organization_id) AS is_org_owner)));

CREATE POLICY "organization_members: owners update within their organization" ON "public"."organization_members"
  FOR UPDATE
  TO "authenticated"
  USING (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND ( SELECT private.is_org_owner(organization_members.organization_id) AS is_org_owner)))
  WITH CHECK (((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND ( SELECT private.is_org_owner(organization_members.organization_id) AS is_org_owner)));

CREATE POLICY "organizations: members read their organization" ON "public"."organizations"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "organizations: ops full access" ON "public"."organizations"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "organizations: owners update their organization" ON "public"."organizations"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_org_owner(organizations.id) AS is_org_owner))
  WITH CHECK (( SELECT private.is_org_owner(organizations.id) AS is_org_owner));

CREATE POLICY "profiles: members read their organization" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "profiles: ops read all" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "profiles: ops update all" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "profiles: users update their own row" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

COMMENT ON COLUMN "public"."organizations"."archived_at" IS 'A closed account that keeps its data until an erasure request (feature 14).';

COMMENT ON COLUMN "public"."profiles"."organization_id" IS 'The user''s current organization, kept in step with organization_members by a trigger (foreign key declared in 10_organizations.sql).';

COMMENT ON FUNCTION "public"."create_organization"(text) IS 'Creates an organization with the caller as owner. Client role only, one organization per user.';

COMMENT ON TABLE "public"."organization_members" IS 'Membership of a user in an organization with the role owner or member.';

COMMENT ON TABLE "public"."organizations" IS 'A client company account, the tenant every kind T table belongs to. Insert only through create_organization.';

COMMENT ON TABLE "public"."profiles" IS 'App profile per auth user: role, current organization, display name and locale.';

REVOKE ALL ON FUNCTION "private"."is_ops"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_ops"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."is_org_owner"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_org_owner"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."jwt_app_role"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."jwt_app_role"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."jwt_org_id"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."jwt_org_id"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."sync_profile_organization"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."sync_profile_organization"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."create_organization"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_organization"(text) TO "authenticated", "postgres", "service_role";

-- Hand added: the default privileges of schema public grant execute to anon at creation and the
-- diff does not see that. Only signed in clients may call create_organization.
REVOKE EXECUTE ON FUNCTION "public"."create_organization"(text) FROM "anon";

GRANT USAGE ON SCHEMA "private" TO "authenticated";

GRANT CREATE, USAGE ON SCHEMA "private" TO "postgres";

GRANT USAGE ON SCHEMA "private" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organization_members" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organizations" TO "anon", "authenticated", "postgres", "service_role";

-- Hand ordered: revoking a table privilege also drops the column privileges, so the table
-- revoke comes first and the column grants (full_name, locale) after it.
REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."profiles" TO "authenticated";

GRANT UPDATE ("full_name") ON TABLE "public"."profiles" TO "authenticated";

GRANT UPDATE ("locale") ON TABLE "public"."profiles" TO "authenticated";
