-- private.audit_row() gains a primary key fallback for row_id (spec 0013). expert_profiles
-- and expert_ops_notes are keyed on expert_id rather than id, and an access control table has
-- to be audited, so the trigger reads the key column from the catalog when there is no `id`.
-- Replacing the function is backward compatible: every existing audited table has an `id` and
-- takes the same branch it always did.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  -- expert_ops_notes are keyed on expert_id, spec 0013) would otherwise write a null row_id and
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
$$;

SET local check_function_bodies = off;

CREATE TABLE "public"."expert_ops_notes" (
  "expert_id"  uuid                     NOT NULL,
  "notes"      text                     NOT NULL DEFAULT ''::text,
  "updated_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "expert_ops_notes_notes_check" CHECK ((char_length(notes) <= 4000)),
  CONSTRAINT "expert_ops_notes_pkey" PRIMARY KEY (expert_id)
);

ALTER TABLE "public"."expert_ops_notes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."expert_profiles" (
  "expert_id"         uuid                     NOT NULL,
  "email"             text                     NOT NULL,
  "status"            text                     NOT NULL DEFAULT 'invited'::text,
  "headline"          text,
  "bio"               text,
  "competencies"      text[]                   NOT NULL DEFAULT '{}'::text[],
  "industries"        text[]                   NOT NULL DEFAULT '{}'::text[],
  "standards"         text[]                   NOT NULL DEFAULT '{}'::text[],
  "languages"         text[]                   NOT NULL DEFAULT '{}'::text[],
  "regions"           text[]                   NOT NULL DEFAULT '{}'::text[],
  "availability"      text                     NOT NULL DEFAULT 'available'::text,
  "available_from"    date,
  "availability_note" text,
  "years_experience"  integer,
  "phone"             text,
  "photo_path"        text,
  "invited_by"        uuid,
  "invited_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "onboarded_at"      timestamp with time zone,
  "deactivated_at"    timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "expert_profiles_availability_check" CHECK ((availability = ANY (ARRAY['available'::text, 'limited'::text, 'unavailable'::text]))),
  CONSTRAINT "expert_profiles_availability_note_check" CHECK ((char_length(availability_note) <= 300)),
  CONSTRAINT "expert_profiles_bio_check" CHECK (((char_length(bio) >= 1) AND (char_length(bio) <= 800))),
  CONSTRAINT "expert_profiles_check" CHECK ((photo_path ~ (('^'::text || (expert_id)::text) || '/photo\.(jpg|png|webp)$'::text))),
  CONSTRAINT "expert_profiles_competencies_check" CHECK ((competencies <@ ARRAY['compliance'::text, 'management_system'::text, 'safety_culture'::text])),
  CONSTRAINT "expert_profiles_email_check" CHECK ((email = lower(email))),
  CONSTRAINT "expert_profiles_email_key" UNIQUE (email),
  CONSTRAINT "expert_profiles_headline_check" CHECK (((char_length(headline) >= 1) AND (char_length(headline) <= 120))),
  CONSTRAINT "expert_profiles_industries_check"
    CHECK
    ((industries <@ ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text, 'G'::text, 'H'::text, 'I'::text, 'J'::text, 'K'::text, 'L'::text, 'M'::text, 'N'::text,
    'O'::text, 'P'::text, 'Q'::text, 'R'::text, 'S'::text, 'T'::text, 'U'::text])),
  CONSTRAINT "expert_profiles_languages_check" CHECK ((languages <@ ARRAY['de'::text, 'fr'::text, 'it'::text, 'en'::text])),
  CONSTRAINT "expert_profiles_phone_check" CHECK ((char_length(phone) <= 30)),
  CONSTRAINT "expert_profiles_pkey" PRIMARY KEY (expert_id),
  CONSTRAINT "expert_profiles_regions_check"
    CHECK
    ((regions <@ ARRAY['AG'::text, 'AI'::text, 'AR'::text, 'BE'::text, 'BL'::text, 'BS'::text, 'FR'::text, 'GE'::text, 'GL'::text, 'GR'::text, 'JU'::text, 'LU'::text, 'NE'::text,
    'NW'::text, 'OW'::text, 'SG'::text, 'SH'::text, 'SO'::text, 'SZ'::text, 'TG'::text, 'TI'::text, 'UR'::text, 'VD'::text, 'VS'::text, 'ZG'::text, 'ZH'::text])),
  CONSTRAINT "expert_profiles_standards_check"
    CHECK
    ((standards <@ ARRAY['iso_45001'::text, 'iso_14001'::text, 'iso_9001'::text, 'iso_50001'::text, 'ekas_6508'::text, 'suva_asa'::text, 'arg_argv'::text, 'vuv'::text,
    'stfv'::text, 'scc'::text, 'iso_31000'::text, 'esti'::text, 'bauav'::text, 'psa'::text])),
  CONSTRAINT "expert_profiles_status_check" CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'inactive'::text]))),
  CONSTRAINT "expert_profiles_years_experience_check" CHECK (((years_experience >= 0) AND (years_experience <= 60)))
);

ALTER TABLE "public"."expert_profiles"
  ENABLE ROW LEVEL SECURITY;

create or replace function private.check_expert_assignable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expert_status text;
begin
  if private.jwt_app_role() in ('client', 'expert') then
    return new;
  end if;

  select e.status into expert_status
  from public.expert_profiles e
  where e.expert_id = new.expert_id;

  if expert_status is distinct from 'active' then
    raise exception 'expert_not_active: % is %', new.expert_id, coalesce(expert_status, 'without a profile')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.assigned_organization_contacts (
  org uuid
)
  RETURNS TABLE (
    user_id   uuid,
    full_name text,
    email     text,
    role      text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  if not (private.is_assigned_expert(org) or private.is_ops()) then
    raise exception 'not_assigned';
  end if;

  return query
    select m.user_id, p.full_name, u.email::text, m.role
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.organization_id = org
    order by m.role, p.full_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_expert_photo (
  path text
)
  RETURNS public.expert_profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  row public.expert_profiles;
begin
  if caller is null then
    raise exception 'not_signed_in';
  end if;

  if path is not null and path !~ ('^' || caller::text || '/photo\.(jpg|png|webp)$') then
    raise exception 'invalid_path';
  end if;

  update public.expert_profiles e
  set photo_path = path
  where e.expert_id = caller
  returning * into row;

  if not found then
    raise exception 'not_found';
  end if;

  return row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_expert_status (
  target uuid,
  next   text
)
  RETURNS public.expert_profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  caller_is_ops boolean := private.is_ops();
  row public.expert_profiles;
begin
  if caller is null then
    raise exception 'not_signed_in';
  end if;

  if next not in ('invited', 'active', 'inactive') then
    raise exception 'invalid_transition';
  end if;

  select * into row from public.expert_profiles e where e.expert_id = target for update;

  if not found then
    raise exception 'not_found';
  end if;

  -- Only ops act on someone else's row; the expert reaches this function through onboarding alone.
  if not caller_is_ops and caller is distinct from target then
    raise exception 'forbidden';
  end if;

  if row.status = next then
    return row;
  end if;

  if caller_is_ops then
    if not (
      (row.status = 'invited' and next in ('active', 'inactive'))
      or (row.status = 'active' and next = 'inactive')
      or (row.status = 'inactive' and next = 'invited' and row.onboarded_at is null)
      or (row.status = 'inactive' and next = 'active' and row.onboarded_at is not null)
    ) then
      raise exception 'invalid_transition';
    end if;
  else
    -- The expert's one move: finishing onboarding on their own row.
    if not (row.status = 'invited' and next = 'active') then
      raise exception 'invalid_transition';
    end if;
  end if;

  update public.expert_profiles e
  set status = next,
      onboarded_at = case
        when next = 'active' then coalesce(e.onboarded_at, now())
        else e.onboarded_at
      end,
      deactivated_at = case when next = 'inactive' then now() else null end
  where e.expert_id = target
  returning * into row;

  return row;
end;
$function$;

ALTER TABLE "public"."expert_ops_notes"
  ADD CONSTRAINT "expert_ops_notes_expert_id_fkey" FOREIGN KEY (expert_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."expert_ops_notes"
  ADD CONSTRAINT "expert_ops_notes_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."expert_profiles"
  ADD CONSTRAINT "expert_profiles_expert_id_fkey" FOREIGN KEY (expert_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."expert_profiles"
  ADD CONSTRAINT "expert_profiles_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE VIEW "public"."assigned_expert_summaries" WITH (security_invoker=false) AS  SELECT a.organization_id,
    a.id AS assignment_id,
    a.started_at,
    p.id AS expert_id,
    p.full_name,
    e.headline,
    e.bio,
    e.competencies,
    e.industries,
    e.standards,
    e.languages,
    e.photo_path
   FROM ((public.expert_assignments a
     JOIN public.profiles p ON ((p.id = a.expert_id)))
     JOIN public.expert_profiles e ON ((e.expert_id = a.expert_id)))
  WHERE ((a.status = 'active'::text) AND (e.status = 'active'::text) AND ((a.organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) OR ( SELECT private.is_ops() AS is_ops) OR (a.expert_id = ( SELECT auth.uid() AS uid))));

CREATE INDEX expert_ops_notes_updated_by_idx ON public.expert_ops_notes USING btree (updated_by);

CREATE INDEX expert_profiles_competencies_idx ON public.expert_profiles USING gin (competencies);

CREATE INDEX expert_profiles_industries_idx ON public.expert_profiles USING gin (industries);

CREATE INDEX expert_profiles_invited_at_idx ON public.expert_profiles USING btree (invited_at DESC);

CREATE INDEX expert_profiles_invited_by_idx ON public.expert_profiles USING btree (invited_by);

CREATE INDEX expert_profiles_languages_idx ON public.expert_profiles USING gin (languages);

CREATE INDEX expert_profiles_regions_idx ON public.expert_profiles USING gin (regions);

CREATE INDEX expert_profiles_status_idx ON public.expert_profiles USING btree (status);

CREATE TRIGGER expert_assignments_check_assignable
  BEFORE INSERT ON public.expert_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.check_expert_assignable();

CREATE TRIGGER expert_ops_notes_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.expert_ops_notes
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER expert_ops_notes_set_updated_at
  BEFORE UPDATE ON public.expert_ops_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER expert_profiles_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.expert_profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER expert_profiles_set_updated_at
  BEFORE UPDATE ON public.expert_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "expert_ops_notes: ops full access" ON "public"."expert_ops_notes"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "expert_profiles: experts read their own row" ON "public"."expert_profiles"
  FOR SELECT
  TO "authenticated"
  USING ((expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "expert_profiles: experts update their own row" ON "public"."expert_profiles"
  FOR UPDATE
  TO "authenticated"
  USING ((expert_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "expert_profiles: ops insert" ON "public"."expert_profiles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "expert_profiles: ops read all" ON "public"."expert_profiles"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "expert_profiles: ops update all" ON "public"."expert_profiles"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "expert photos: assigned clients read" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'expert-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.expert_assignments a
  WHERE (((a.expert_id)::text = (storage.foldername(objects.name))[1]) AND (a.organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)) AND (a.status = 'active'::text))))));

CREATE POLICY "expert photos: experts delete their own" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'expert-photos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "expert photos: experts read their own" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'expert-photos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "expert photos: experts replace their own" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'expert-photos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)))
  WITH CHECK (((bucket_id = 'expert-photos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "expert photos: experts upload their own" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'expert-photos'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

CREATE POLICY "expert photos: ops read" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'expert-photos'::text) AND ( SELECT private.is_ops() AS is_ops)));

COMMENT ON COLUMN "public"."expert_profiles"."email" IS 'Copied from the invite so the ops list is one query. Not kept in step with auth.users automatically.';

COMMENT ON COLUMN "public"."expert_profiles"."photo_path" IS 'Object path in the private expert-photos bucket. Written only by public.set_expert_photo.';

COMMENT ON COLUMN "public"."expert_profiles"."status" IS 'invited → active → inactive. Written only by public.set_expert_status.';

COMMENT ON FUNCTION "public"."assigned_organization_contacts"(uuid) IS 'Members of an organization for an assigned expert or ops (spec 0013). Raises not_assigned for anyone else.';

COMMENT ON FUNCTION "public"."set_expert_photo"(text) IS 'The only write path for expert_profiles.photo_path (spec 0013). Writes the caller''s own row and pins the path to their folder.';

COMMENT ON FUNCTION "public"."set_expert_status"(uuid, text) IS 'The only write path for expert_profiles.status (spec 0013). Enforces the state machine and stamps onboarded_at and deactivated_at.';

COMMENT ON TABLE "public"."expert_ops_notes" IS 'Ops only notes about an expert (spec 0013). Never readable by the expert.';

COMMENT ON TABLE "public"."expert_profiles" IS 'One row per expert account (spec 0013). status and photo_path move only through set_expert_status and set_expert_photo.';

COMMENT ON VIEW "public"."assigned_expert_summaries" IS 'The client visible half of an assigned expert''s profile (spec 0013). Definer view: the where clause is the access boundary.';

REVOKE ALL ON FUNCTION "private"."check_expert_assignable"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_expert_assignable"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."assigned_organization_contacts"(uuid) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."assigned_organization_contacts"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_expert_photo"(text) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."set_expert_photo"(text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_expert_status"(uuid, text) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."set_expert_status"(uuid, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."expert_ops_notes" FROM "anon";

REVOKE ALL ON TABLE "public"."expert_ops_notes" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."expert_ops_notes" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expert_ops_notes" TO "postgres";

REVOKE ALL ON TABLE "public"."expert_ops_notes" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."expert_ops_notes" TO "service_role";

REVOKE ALL ON TABLE "public"."expert_profiles" FROM "anon";

REVOKE ALL ON TABLE "public"."expert_profiles" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."expert_profiles" TO "authenticated";

-- Re added by hand, and deliberately after the table level REVOKE ALL above: the generated
-- diff emits these column grants before that revoke, which drops every one of them again and
-- leaves the expert unable to edit their own profile (AGENTS.md, the first of the three things
-- the diff misses). Ops and the expert share this grant; the policies are what separate them.
GRANT UPDATE ("availability") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("availability_note") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("available_from") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("bio") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("competencies") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("headline") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("industries") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("languages") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("phone") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("regions") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("standards") ON TABLE "public"."expert_profiles" TO "authenticated";
GRANT UPDATE ("years_experience") ON TABLE "public"."expert_profiles" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expert_profiles" TO "postgres";

REVOKE ALL ON TABLE "public"."expert_profiles" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."expert_profiles" TO "service_role";

-- Re added by hand: the diff replays the default privileges, which grant every command to
-- authenticated (TRUNCATE and UPDATE on a view) and leave anon holding select on a definer
-- view. The schema file grants select alone.
REVOKE ALL ON TABLE "public"."assigned_expert_summaries" FROM "anon", "authenticated";

GRANT SELECT ON TABLE "public"."assigned_expert_summaries" TO "authenticated";

GRANT ALL ON TABLE "public"."assigned_expert_summaries" TO "postgres", "service_role";
