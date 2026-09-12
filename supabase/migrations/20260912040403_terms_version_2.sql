SET local check_function_bodies = off;

DROP FUNCTION "public"."accept_terms"(text);

ALTER TABLE "public"."profiles"
  ALTER COLUMN "terms_version" SET DEFAULT '2'::text;

CREATE OR REPLACE FUNCTION public.accept_terms (
  version text DEFAULT '2'::text
)
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

  if version is null or version !~ '^[A-Za-z0-9._-]{1,16}$' then
    raise exception 'invalid_terms_version';
  end if;

  -- Equality, never ordering: the column is text, so '10' < '2' and a comparison would treat a
  -- tenth version as older than a second one (spec 0015, AC-10).
  update public.profiles
  set terms_accepted_at = now(), terms_version = version
  where id = caller and (terms_accepted_at is null or terms_version is distinct from version);

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

  insert into public.profiles (id, role, full_name, locale, terms_accepted_at, terms_version)
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
    case when requested_locale in ('de', 'en') then requested_locale else 'en' end,
    consent,
    -- Spec 0015 (AC-10): the version the sign up form showed, when it carries one and it looks
    -- like a version; anything else falls back to the column default. A sign up without consent
    -- still gets the default, which is correct: the version only means something once
    -- terms_accepted_at is set, and the two are read together everywhere.
    coalesce(
      nullif(
        case
          when new.raw_user_meta_data ->> 'terms_version' ~ '^[A-Za-z0-9._-]{1,16}$'
            then new.raw_user_meta_data ->> 'terms_version'
        end,
        ''
      ),
      -- The current version, the third mirror of CURRENT_TERMS_VERSION beside the column default
      -- and the accept_terms default (spec 0018 moved all three to '2').
      '2'
    )
  );
  return new;
end;
$function$;

COMMENT ON FUNCTION "public"."accept_terms"(text) IS 'Records the caller''s acceptance of a terms version and returns when it was given. The only API write path for profiles.terms_accepted_at and terms_version.';

REVOKE ALL ON FUNCTION "public"."accept_terms"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."accept_terms"(text) TO "authenticated", "postgres", "service_role";

-- Hand fixes (AGENTS.md): the generator re-emitted a widening of the assigned_expert_summaries
-- view grant from SELECT to full DML for authenticated, removed here so the view keeps its select
-- only grant; and Supabase's default privileges grant execute to anon on a re-created public
-- function, which REVOKE ... FROM PUBLIC above does not remove.
REVOKE EXECUTE ON FUNCTION "public"."accept_terms"(text) FROM "anon";
