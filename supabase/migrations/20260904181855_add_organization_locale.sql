SET local check_function_bodies = off;

ALTER TABLE "public"."organizations"
  ADD COLUMN "locale" text NOT NULL DEFAULT 'de'::text;

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
    raise exception 'only name and locale are editable by an owner'
      using errcode = 'check_violation';
  end if;
  return new;
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

  insert into public.organizations (name, created_by, locale)
  values (
    create_organization.name,
    caller,
    coalesce((select p.locale from public.profiles p where p.id = caller), 'de')
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

ALTER TABLE "public"."organizations"
  ADD CONSTRAINT "organizations_locale_check" CHECK ((locale = ANY (ARRAY['de'::text, 'en'::text])));

COMMENT ON COLUMN "public"."organizations"."locale" IS 'Language of the organisation''s documents and organisation wide mail: de or en. Copied from the creator''s profile, editable by an owner.';
