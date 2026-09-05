SET local check_function_bodies = off;

ALTER TABLE "public"."organizations"
  ALTER COLUMN "locale" SET DEFAULT 'en'::text;

ALTER TABLE "public"."profiles"
  ALTER COLUMN "locale" SET DEFAULT 'en'::text;

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
    raise exception 'not_a_client' using errcode = 'SM403';
  end if;

  -- Two concurrent calls by the same caller (two tabs, a replayed request) would both pass the
  -- membership check below. The lock lasts for this transaction and is keyed on the caller, so the
  -- second call waits, then sees the first one's membership and raises already_member.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));

  if exists (select 1 from public.organization_members m where m.user_id = caller) then
    raise exception 'already_member' using errcode = 'SM409';
  end if;

  insert into public.organizations (name, created_by, locale)
  values (
    create_organization.name,
    caller,
    coalesce((select p.locale from public.profiles p where p.id = caller), 'en')
  )
  returning id into org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (org_id, caller, 'owner');

  update public.profiles
  set organization_id = org_id
  where id = caller and organization_id is distinct from org_id;

  return org_id;
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
    case when requested_locale in ('de', 'en') then requested_locale else 'en' end,
    consent
  );
  return new;
end;
$function$;
