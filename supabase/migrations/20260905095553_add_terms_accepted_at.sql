SET local check_function_bodies = off;

ALTER TABLE "public"."profiles"
  ADD COLUMN "terms_accepted_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION public.accept_terms()
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  accepted_at timestamptz;
begin
  if caller is null then
    raise exception 'not_signed_in';
  end if;

  update public.profiles
  set terms_accepted_at = now()
  where id = caller and terms_accepted_at is null;

  select p.terms_accepted_at into accepted_at
  from public.profiles p
  where p.id = caller;

  if accepted_at is null then
    raise exception 'no_profile';
  end if;

  return accepted_at;
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
  consent timestamptz;
begin
  begin
    consent := (new.raw_user_meta_data ->> 'terms_accepted_at')::timestamptz;
  exception when others then
    consent := null;
  end;

  insert into public.profiles (id, role, full_name, locale, terms_accepted_at)
  values (
    new.id,
    case
      when requested_role in ('client', 'expert', 'ops') then requested_role::public.app_role
      else 'client'::public.app_role
    end,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    case when requested_locale in ('de', 'en') then requested_locale else 'de' end,
    consent
  );
  return new;
end;
$function$;

COMMENT ON COLUMN "public"."profiles"."terms_accepted_at" IS 'When the user accepted the terms (spec 0005). Set once by handle_new_user or accept_terms(); not writable through the API.';

COMMENT ON FUNCTION "public"."accept_terms"() IS 'Records the caller''s consent once and returns when it was given. The only API write path for profiles.terms_accepted_at.';

REVOKE ALL ON FUNCTION "public"."accept_terms"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."accept_terms"() TO "authenticated", "postgres", "service_role";

-- Added by hand (AGENTS.md, database changes): Supabase's default privileges hand every new
-- public function to anon at creation, and the declarative diff only revokes from PUBLIC.
REVOKE ALL ON FUNCTION "public"."accept_terms"() FROM "anon";
