SET local check_function_bodies = off;

CREATE TABLE "public"."profiles" (
  "id"              uuid                     NOT NULL,
  "organization_id" uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."scaffold_checks" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "run_id"     text                     NOT NULL,
  "message"    text                     NOT NULL,
  "status"     text                     NOT NULL DEFAULT 'running'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "scaffold_checks_pkey" PRIMARY KEY (id),
  CONSTRAINT "scaffold_checks_status_check" CHECK ((status = ANY (ARRAY['running'::text, 'done'::text, 'failed'::text])))
);

ALTER TABLE "public"."scaffold_checks"
  ENABLE ROW LEVEL SECURITY;

CREATE TYPE "public"."app_role" AS ENUM (
  'client',
  'expert',
  'ops'
);

ALTER TABLE "public"."profiles"
  ADD COLUMN "role" public.app_role NOT NULL DEFAULT 'client'::public.app_role;

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
begin
  select role into user_role
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  if user_role is not null then
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb) || jsonb_build_object('role', user_role::text),
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
begin
  insert into public.profiles (id, role)
  values (
    new.id,
    case
      when requested_role in ('client', 'expert', 'ops') then requested_role::public.app_role
      else 'client'::public.app_role
    end
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX scaffold_checks_created_at_idx ON public.scaffold_checks USING btree (created_at DESC);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER scaffold_checks_set_updated_at
  BEFORE UPDATE ON public.scaffold_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "profiles: auth admin reads for the token hook" ON "public"."profiles"
  FOR SELECT
  TO "supabase_auth_admin"
  USING (true);

CREATE POLICY "profiles: users read their own row" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "scaffold_checks: ops read" ON "public"."scaffold_checks"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text)) = 'ops'::text));

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."scaffold_checks";

COMMENT ON TABLE "public"."profiles" IS 'App profile per auth user: role and organization. Feature 3 extends it.';

COMMENT ON TABLE "public"."scaffold_checks" IS 'Scaffold smoke test rows written by the scaffold-check task. Ops only.';

REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"(jsonb) FROM PUBLIC;

-- Supabase default privileges grant execute on new functions to anon and authenticated; the hook
-- must only be callable by the auth server (declared in supabase/schemas/02_access_token_hook.sql).
REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"(jsonb) FROM "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."custom_access_token_hook"(jsonb) TO "postgres", "service_role", "supabase_auth_admin";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON SCHEMA "public" FROM "supabase_auth_admin";

GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated", "postgres", "service_role";

GRANT SELECT ON TABLE "public"."profiles" TO "supabase_auth_admin";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."scaffold_checks" TO "anon", "authenticated", "postgres", "service_role";

GRANT USAGE ON TYPE "public"."app_role" TO "postgres";
