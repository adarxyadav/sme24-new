SET local check_function_bodies = off;

DROP FUNCTION "public"."accept_terms"();

ALTER TABLE "public"."profiles"
  ADD COLUMN "terms_version" text NOT NULL DEFAULT '1'::text;

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
  key_column text;
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

  -- Most audited tables are keyed on `id`. A table keyed on something else (expert_profiles and
  -- expert_ops_notes are keyed on expert_id, spec 0012) would otherwise write a null row_id and
  -- fail the not null constraint, which is why the tables keyed on `key` or `event_id` are simply
  -- not audited. An access control table has to be audited, so the key column is read from the
  -- catalog instead: single column primary keys only, which every audited table has.
  if subject ? 'id' then
    key_column := 'id';
  else
    select a.attname into key_column
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = tg_relid and i.indisprimary and i.indnatts = 1;
  end if;

  if key_column is null then
    raise exception 'private.audit_row cannot audit %: no id column and no single column primary key', tg_table_name;
  end if;

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
    subject ->> key_column,
    lower(tg_op),
    row_old,
    row_new,
    changed
  );
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_terms (
  version text DEFAULT '1'::text
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
      '1'
    )
  );
  return new;
end;
$function$;

COMMENT ON COLUMN "public"."profiles"."terms_version" IS 'Which terms version the user accepted (spec 0015). Compared with equality only; set by handle_new_user or accept_terms(), not writable through the API.';

COMMENT ON FUNCTION "public"."accept_terms"(text) IS 'Records the caller''s acceptance of a terms version and returns when it was given. The only API write path for profiles.terms_accepted_at and terms_version.';

REVOKE ALL ON FUNCTION "public"."accept_terms"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."accept_terms"(text) TO "authenticated", "postgres", "service_role";

-- Hand fix (AGENTS.md): the diff never emits the anon revoke for a new public function. The
-- REVOKE FROM PUBLIC above does not reach anon, which holds the grant in its own right.
REVOKE EXECUTE ON FUNCTION "public"."accept_terms"(text) FROM "anon";

-- Hand fix (AGENTS.md, the diff's known gaps): the generated diff re-emits this unchanged view's
-- grant widened from SELECT to full DML. The view is read only for the app roles, so only SELECT
-- is granted back. Left as the diff wrote it, an expert could write through the view.
REVOKE ALL ON TABLE "public"."assigned_expert_summaries" FROM "authenticated";

GRANT SELECT ON TABLE "public"."assigned_expert_summaries" TO "authenticated";
