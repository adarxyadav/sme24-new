SET local check_function_bodies = off;

CREATE TABLE "public"."directory_companies" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"            text                     NOT NULL,
  "name_normalised" text                     NOT NULL,
  "country"         text,
  "city"            text,
  "state"           text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "directory_companies_city_check" CHECK ((char_length(city) <= 200)),
  CONSTRAINT "directory_companies_country_check" CHECK ((country ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT "directory_companies_name_check" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 300))),
  CONSTRAINT "directory_companies_name_normalised_check" CHECK (((char_length(name_normalised) >= 1) AND (char_length(name_normalised) <= 300))),
  CONSTRAINT "directory_companies_pkey" PRIMARY KEY (id),
  CONSTRAINT "directory_companies_state_check" CHECK ((char_length(state) <= 200))
);

ALTER TABLE "public"."directory_companies"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."directory_contacts" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"   uuid                     NOT NULL,
  "first_name"   text,
  "last_name"    text,
  "title"        text,
  "email"        text                     NOT NULL,
  "phone"        text,
  "mobile"       text,
  "street"       text,
  "city"         text,
  "state"        text,
  "postal_code"  text,
  "country"      text,
  "source_batch" text                     NOT NULL,
  "imported_at"  timestamp with time zone NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "directory_contacts_city_check" CHECK ((char_length(city) <= 200)),
  CONSTRAINT "directory_contacts_country_check" CHECK ((country ~ '^[A-Z]{2}$'::text)),
  CONSTRAINT "directory_contacts_email_check" CHECK (((email = lower(email)) AND (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))),
  CONSTRAINT "directory_contacts_email_key" UNIQUE (email),
  CONSTRAINT "directory_contacts_first_name_check" CHECK ((char_length(first_name) <= 200)),
  CONSTRAINT "directory_contacts_last_name_check" CHECK ((char_length(last_name) <= 200)),
  CONSTRAINT "directory_contacts_mobile_check" CHECK ((char_length(mobile) <= 50)),
  CONSTRAINT "directory_contacts_phone_check" CHECK ((char_length(phone) <= 50)),
  CONSTRAINT "directory_contacts_pkey" PRIMARY KEY (id),
  CONSTRAINT "directory_contacts_postal_code_check" CHECK ((char_length(postal_code) <= 30)),
  CONSTRAINT "directory_contacts_source_batch_check" CHECK (((char_length(source_batch) >= 1) AND (char_length(source_batch) <= 200))),
  CONSTRAINT "directory_contacts_state_check" CHECK ((char_length(state) <= 200)),
  CONSTRAINT "directory_contacts_street_check" CHECK ((char_length(street) <= 300)),
  CONSTRAINT "directory_contacts_title_check" CHECK ((char_length(title) <= 300))
);

ALTER TABLE "public"."directory_contacts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."directory_credit_entries" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "expert_id"  uuid                     NOT NULL,
  "delta"      integer                  NOT NULL,
  "reason"     text                     NOT NULL,
  "order_id"   uuid,
  "unlock_id"  uuid,
  "created_by" uuid,
  "note"       text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "directory_credit_entries_check_order" CHECK (((reason <> 'purchase'::text) OR (order_id IS NOT NULL))),
  CONSTRAINT "directory_credit_entries_check_reason"
    CHECK ((((reason = ANY (ARRAY['purchase'::text, 'grant'::text])) AND (delta > 0)) OR ((reason = ANY (ARRAY['unlock'::text, 'refund'::text])) AND (delta < 0)))),
  CONSTRAINT "directory_credit_entries_delta_check" CHECK ((delta <> 0)),
  CONSTRAINT "directory_credit_entries_note_check" CHECK ((char_length(note) <= 500)),
  CONSTRAINT "directory_credit_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "directory_credit_entries_reason_check" CHECK ((reason = ANY (ARRAY['purchase'::text, 'unlock'::text, 'grant'::text, 'refund'::text])))
);

ALTER TABLE "public"."directory_credit_entries"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."directory_imports" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "source_batch"            text                     NOT NULL,
  "file_name"               text                     NOT NULL,
  "rows_read"               integer                  NOT NULL DEFAULT 0,
  "rows_loaded"             integer                  NOT NULL DEFAULT 0,
  "rows_updated"            integer                  NOT NULL DEFAULT 0,
  "rows_skipped_invalid"    integer                  NOT NULL DEFAULT 0,
  "rows_skipped_country"    integer                  NOT NULL DEFAULT 0,
  "rows_skipped_no_country" integer                  NOT NULL DEFAULT 0,
  "rows_skipped_suppressed" integer                  NOT NULL DEFAULT 0,
  "countries"               jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "excluded_countries"      text[]                   NOT NULL DEFAULT '{}'::text[],
  "dry_run"                 boolean                  NOT NULL DEFAULT false,
  "started_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at"             timestamp with time zone,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "directory_imports_file_name_check" CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 300))),
  CONSTRAINT "directory_imports_pkey" PRIMARY KEY (id),
  CONSTRAINT "directory_imports_rows_loaded_check" CHECK ((rows_loaded >= 0)),
  CONSTRAINT "directory_imports_rows_read_check" CHECK ((rows_read >= 0)),
  CONSTRAINT "directory_imports_rows_skipped_country_check" CHECK ((rows_skipped_country >= 0)),
  CONSTRAINT "directory_imports_rows_skipped_invalid_check" CHECK ((rows_skipped_invalid >= 0)),
  CONSTRAINT "directory_imports_rows_skipped_no_country_check" CHECK ((rows_skipped_no_country >= 0)),
  CONSTRAINT "directory_imports_rows_skipped_suppressed_check" CHECK ((rows_skipped_suppressed >= 0)),
  CONSTRAINT "directory_imports_rows_updated_check" CHECK ((rows_updated >= 0)),
  CONSTRAINT "directory_imports_source_batch_check" CHECK (((char_length(source_batch) >= 1) AND (char_length(source_batch) <= 200)))
);

ALTER TABLE "public"."directory_imports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."directory_suppressions" (
  "email_hash" text                     NOT NULL,
  "reason"     text                     NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "directory_suppressions_email_hash_check" CHECK ((email_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "directory_suppressions_pkey" PRIMARY KEY (email_hash),
  CONSTRAINT "directory_suppressions_reason_check" CHECK ((reason = ANY (ARRAY['data_subject_request'::text, 'bounce'::text, 'ops'::text])))
);

ALTER TABLE "public"."directory_suppressions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."directory_unlocks" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "expert_id"  uuid                     NOT NULL,
  "contact_id" uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "directory_unlocks_expert_id_contact_id_key" UNIQUE (expert_id, contact_id),
  CONSTRAINT "directory_unlocks_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."directory_unlocks"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.is_active_expert()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(
    private.jwt_app_role() = 'expert'
    and exists (
      select 1 from public.expert_profiles e
      where e.expert_id = (select auth.uid()) and e.status = 'active'
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION private.like_pattern (
  needle text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$function$;

CREATE OR REPLACE FUNCTION private.mask_email (
  address text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case
    when address is null or position('@' in address) < 2 then null
    else left(address, 1)
      || repeat('•', greatest(3, length(split_part(address, '@', 1)) - 1))
      || '@'
      || substr(address, position('@' in address) + 1)
  end;
$function$;

CREATE OR REPLACE FUNCTION private.mask_phone (
  number text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  total integer;
  masked text := '';
  position_index integer;
  ch text;
begin
  if number is null then
    return null;
  end if;
  total := length(number);
  for position_index in 1..total loop
    ch := substr(number, position_index, 1);
    if position_index <= 4 or position_index > total - 2 or ch !~ '[0-9]' then
      masked := masked || ch;
    else
      masked := masked || '•';
    end if;
  end loop;
  return masked;
end;
$function$;

CREATE OR REPLACE FUNCTION public.directory_countries()
  RETURNS TABLE (
    country  text,
    contacts bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not (private.is_ops() or private.is_active_expert()) then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return query
    select c.country, count(*)
    from public.directory_contacts c
    where c.country is not null
    group by c.country
    order by c.country;
end;
$function$;

CREATE OR REPLACE FUNCTION public.directory_search (
  q          text    DEFAULT NULL::text,
  country    text    DEFAULT NULL::text,
  title      text    DEFAULT NULL::text,
  after_name text    DEFAULT NULL::text,
  after_id   uuid    DEFAULT NULL::uuid,
  after_page integer DEFAULT NULL::integer,
  page_size  integer DEFAULT 25
)
  RETURNS TABLE (
    contact_id              uuid,
    company_id              uuid,
    company_name            text,
    company_name_normalised text,
    company_country         text,
    company_city            text,
    first_name              text,
    last_name               text,
    contact_title           text,
    contact_country         text,
    contact_city            text,
    email_masked            text,
    phone_masked            text,
    mobile_masked           text,
    unlocked                boolean,
    email                   text,
    phone                   text,
    mobile                  text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller uuid := auth.uid();
  caller_is_ops boolean := private.is_ops();
  size integer := least(greatest(coalesce(page_size, 25), 1), 25);
  query text := nullif(trim(q), '');
  title_query text := nullif(trim(title), '');
begin
  if not (caller_is_ops or private.is_active_expert()) then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  if query is not null and (length(query) < 2 or length(query) > 100) then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  if title_query is not null and (length(title_query) < 2 or length(title_query) > 100) then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  if directory_search.country is not null and directory_search.country !~ '^[A-Z]{2}$' then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  -- A courtesy limit against an accidental deep walk, not a security control: the cursor is not
  -- signed (spec 0018, AC-4).
  if after_page is not null and after_page > 40 then
    raise exception 'page_depth' using errcode = 'SM429';
  end if;

  return query
    select
      c.id,
      co.id,
      co.name,
      co.name_normalised,
      co.country,
      co.city,
      c.first_name,
      c.last_name,
      c.title,
      c.country,
      c.city,
      private.mask_email(c.email),
      private.mask_phone(c.phone),
      private.mask_phone(c.mobile),
      u.id is not null,
      case when caller_is_ops or u.id is not null then c.email end,
      case when caller_is_ops or u.id is not null then c.phone end,
      case when caller_is_ops or u.id is not null then c.mobile end
    from public.directory_contacts c
    join public.directory_companies co on co.id = c.company_id
    left join public.directory_unlocks u
      on u.contact_id = c.id and u.expert_id = caller and not caller_is_ops
    where (query is null or co.name ilike private.like_pattern(query))
      and (title_query is null or c.title ilike private.like_pattern(title_query))
      and (directory_search.country is null or c.country = directory_search.country)
      and (after_name is null or after_id is null or (co.name_normalised, c.id) > (after_name, after_id))
    order by co.name_normalised, c.id
    limit size;
end;
$function$;

ALTER TABLE "public"."directory_contacts"
  ADD CONSTRAINT "directory_contacts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.directory_companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."directory_credit_entries"
  ADD CONSTRAINT "directory_credit_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."directory_credit_entries"
  ADD CONSTRAINT "directory_credit_entries_expert_id_fkey" FOREIGN KEY (expert_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."directory_credit_entries"
  ADD CONSTRAINT "directory_credit_entries_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;

ALTER TABLE "public"."directory_suppressions"
  ADD CONSTRAINT "directory_suppressions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."directory_unlocks"
  ADD CONSTRAINT "directory_unlocks_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES public.directory_contacts(id) ON DELETE CASCADE;

ALTER TABLE "public"."directory_unlocks"
  ADD CONSTRAINT "directory_unlocks_expert_id_fkey" FOREIGN KEY (expert_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."directory_credit_entries"
  ADD CONSTRAINT "directory_credit_entries_unlock_id_fkey" FOREIGN KEY (unlock_id) REFERENCES public.directory_unlocks(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX directory_companies_name_country_idx ON public.directory_companies USING btree (name_normalised, COALESCE(country, ''::text));

CREATE INDEX directory_companies_name_normalised_idx ON public.directory_companies USING btree (name_normalised);

CREATE INDEX directory_companies_name_trgm_idx ON public.directory_companies USING gin (name extensions.gin_trgm_ops);

CREATE INDEX directory_contacts_company_id_id_idx ON public.directory_contacts USING btree (company_id, id);

CREATE INDEX directory_contacts_country_idx ON public.directory_contacts USING btree (country);

CREATE INDEX directory_contacts_last_first_idx ON public.directory_contacts USING btree (last_name, first_name);

CREATE INDEX directory_contacts_title_trgm_idx ON public.directory_contacts USING gin (title extensions.gin_trgm_ops);

CREATE INDEX directory_credit_entries_expert_id_idx ON public.directory_credit_entries USING btree (expert_id);

CREATE UNIQUE INDEX directory_credit_entries_purchase_order_idx ON public.directory_credit_entries USING btree (order_id)
  WHERE (reason = 'purchase'::text);

CREATE UNIQUE INDEX directory_credit_entries_unlock_idx ON public.directory_credit_entries USING btree (unlock_id)
  WHERE (reason = 'unlock'::text);

CREATE INDEX directory_imports_started_at_idx ON public.directory_imports USING btree (started_at DESC);

CREATE INDEX directory_unlocks_contact_id_idx ON public.directory_unlocks USING btree (contact_id);

CREATE INDEX directory_unlocks_expert_created_idx ON public.directory_unlocks USING btree (expert_id, created_at DESC, id);

CREATE TRIGGER directory_companies_set_updated_at
  BEFORE UPDATE ON public.directory_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER directory_contacts_set_updated_at
  BEFORE UPDATE ON public.directory_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER directory_credit_entries_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.directory_credit_entries
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER directory_unlocks_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.directory_unlocks
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE POLICY "directory_companies: ops read" ON "public"."directory_companies"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "directory_contacts: ops read" ON "public"."directory_contacts"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "directory_credit_entries: experts read their own" ON "public"."directory_credit_entries"
  FOR SELECT
  TO "authenticated"
  USING ((expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "directory_credit_entries: ops read" ON "public"."directory_credit_entries"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "directory_imports: ops read" ON "public"."directory_imports"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "directory_suppressions: ops read" ON "public"."directory_suppressions"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "directory_unlocks: experts read their own" ON "public"."directory_unlocks"
  FOR SELECT
  TO "authenticated"
  USING ((expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "directory_unlocks: ops read" ON "public"."directory_unlocks"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops));

COMMENT ON COLUMN "public"."directory_companies"."name_normalised" IS 'lower(trim(name)) with inner whitespace collapsed: the import upsert key (with country) and the keyset sort key of directory_search.';

COMMENT ON COLUMN "public"."directory_contacts"."email" IS 'The import upsert key, lowercased. Never returned unmasked except by directory_reveal after a debit, or to ops.';

COMMENT ON COLUMN "public"."directory_contacts"."imported_at" IS 'Written by every upsert of the import script, so a contact the latest file no longer carries can be found by its older stamp.';

COMMENT ON COLUMN "public"."directory_credit_entries"."delta" IS 'Credits added (purchase, grant) or removed (unlock, refund). Never zero; the balance is the sum.';

COMMENT ON FUNCTION "private"."mask_email"(text) IS 'First character of the local part, bullets, then @ and the full domain (spec 0018).';

COMMENT ON FUNCTION "private"."mask_phone"(text) IS 'The first four and last two characters kept, every other digit a bullet, non digits kept (spec 0018).';

COMMENT ON FUNCTION "public"."directory_countries"() IS 'The alpha 2 codes present in the directory with a contact count each (spec 0018, AC-5). Active experts and ops only.';

COMMENT ON FUNCTION "public"."directory_search"(text, text, text, text, uuid, integer, integer) IS 'The masked directory search (spec 0018, AC-4): 25 rows per page, keyset paged, raw values only for an unlocked row or ops. Active experts and ops only (SM403); SM429 past page 40.';

COMMENT ON TABLE "public"."directory_companies" IS 'A company on the purchased contact list (spec 0018). Unreadable to every app role but ops; experts see it only through directory_search. Written by the import script and directory_remove_contact.';

COMMENT ON TABLE "public"."directory_contacts" IS 'A person on the purchased contact list (spec 0018). Raw email and phones; unreadable to every app role but ops. directory_search masks them, directory_reveal returns them for one credit.';

COMMENT ON TABLE "public"."directory_credit_entries" IS 'The append only credit ledger of the contact directory (spec 0018). Balance is sum(delta); written only by settle_order, directory_reveal and a service side ops correction.';

COMMENT ON TABLE "public"."directory_imports" IS 'One row per run of pnpm directory:import (spec 0018): counts per outcome and per country, the policy applied, dry runs included. The audit of every bulk write to the directory.';

COMMENT ON TABLE "public"."directory_suppressions" IS 'SHA 256 hashes of email addresses that must never re enter the directory (spec 0018). The hash is the objection; the address itself is gone.';

COMMENT ON TABLE "public"."directory_unlocks" IS 'A contact an expert paid one credit to reveal (spec 0018). Written only by directory_reveal; its existence unmasks the row for that expert.';

REVOKE ALL ON FUNCTION "private"."is_active_expert"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_active_expert"() TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."like_pattern"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."like_pattern"(text) TO "postgres";

REVOKE ALL ON FUNCTION "private"."mask_email"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."mask_email"(text) TO "postgres";

REVOKE ALL ON FUNCTION "private"."mask_phone"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."mask_phone"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."directory_countries"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_countries"() TO "authenticated", "postgres", "service_role";

-- Hand fix (AGENTS.md): Supabase's default privileges grant execute to anon on every new public
-- function, and REVOKE ... FROM PUBLIC above does not remove that direct grant.
REVOKE EXECUTE ON FUNCTION "public"."directory_countries"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."directory_search"(text, text, text, text, uuid, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_search"(text, text, text, text, uuid, integer, integer) TO "authenticated", "postgres", "service_role";

REVOKE EXECUTE ON FUNCTION "public"."directory_search"(text, text, text, text, uuid, integer, integer) FROM "anon";

REVOKE ALL ON TABLE "public"."directory_companies" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_companies" TO "anon";

REVOKE ALL ON TABLE "public"."directory_companies" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_companies" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."directory_companies" TO "postgres";

REVOKE ALL ON TABLE "public"."directory_companies" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."directory_companies" TO "service_role";

REVOKE ALL ON TABLE "public"."directory_contacts" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_contacts" TO "anon";

REVOKE ALL ON TABLE "public"."directory_contacts" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_contacts" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."directory_contacts" TO "postgres";

REVOKE ALL ON TABLE "public"."directory_contacts" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."directory_contacts" TO "service_role";

REVOKE ALL ON TABLE "public"."directory_credit_entries" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_credit_entries" TO "anon";

REVOKE ALL ON TABLE "public"."directory_credit_entries" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_credit_entries" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."directory_credit_entries" TO "postgres";

REVOKE ALL ON TABLE "public"."directory_credit_entries" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."directory_credit_entries" TO "service_role";

REVOKE ALL ON TABLE "public"."directory_imports" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_imports" TO "anon";

REVOKE ALL ON TABLE "public"."directory_imports" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_imports" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."directory_imports" TO "postgres";

REVOKE ALL ON TABLE "public"."directory_imports" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."directory_imports" TO "service_role";

REVOKE ALL ON TABLE "public"."directory_suppressions" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_suppressions" TO "anon";

REVOKE ALL ON TABLE "public"."directory_suppressions" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_suppressions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."directory_suppressions" TO "postgres";

REVOKE ALL ON TABLE "public"."directory_suppressions" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."directory_suppressions" TO "service_role";

REVOKE ALL ON TABLE "public"."directory_unlocks" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_unlocks" TO "anon";

REVOKE ALL ON TABLE "public"."directory_unlocks" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."directory_unlocks" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."directory_unlocks" TO "postgres";

REVOKE ALL ON TABLE "public"."directory_unlocks" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."directory_unlocks" TO "service_role";

-- The generator also re-emitted a widening of the assigned_expert_summaries view grant from
-- SELECT to full DML for authenticated (the fourth hand fix AGENTS.md lists); those two
-- statements were removed here, so the view keeps its select only grant.
