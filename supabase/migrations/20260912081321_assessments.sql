SET local check_function_bodies = off;

CREATE TABLE "public"."assessment_answers" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid                     NOT NULL,
  "assessment_id"   uuid                     NOT NULL,
  "item_id"         text,
  "section_key"     text,
  "rating"          text,
  "note"            text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "assessment_answers_exclusion_has_no_rating" CHECK (((item_id IS NOT NULL) OR (rating IS NULL))),
  CONSTRAINT "assessment_answers_item_or_section" CHECK (((item_id IS NULL) <> (section_key IS NULL))),
  CONSTRAINT "assessment_answers_note_check" CHECK (((note IS NULL) OR (char_length(note) <= 4000))),
  CONSTRAINT "assessment_answers_pkey" PRIMARY KEY (id),
  CONSTRAINT "assessment_answers_rating_check" CHECK (((rating IS NULL) OR (rating = ANY (ARRAY['compliant'::text, 'partial'::text, 'non_compliant'::text]))))
);

ALTER TABLE "public"."assessment_answers"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."assessments" (
  "id"                        uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"           uuid                     NOT NULL,
  "company_id"                uuid                     NOT NULL,
  "order_id"                  uuid,
  "questionnaire_key"         text                     NOT NULL,
  "questionnaire_version_key" text                     NOT NULL,
  "expert_id"                 uuid                     NOT NULL,
  "status"                    text                     NOT NULL DEFAULT 'draft'::text,
  "site"                      text,
  "conducted_on"              date,
  "submitted_at"              timestamp with time zone,
  "created_at"                timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "assessments_pkey" PRIMARY KEY (id),
  CONSTRAINT "assessments_site_check" CHECK (((site IS NULL) OR ((char_length(site) >= 1) AND (char_length(site) <= 200)))),
  CONSTRAINT "assessments_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text]))),
  CONSTRAINT "assessments_submitted_at_matches_status" CHECK (((status = 'submitted'::text) = (submitted_at IS NOT NULL)))
);

ALTER TABLE "public"."assessments"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.can_edit_assessment (
  assessment_id uuid,
  org           uuid
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
  if caller is null or assessment_id is null or org is null then
    return false;
  end if;
  return exists (
    select 1
    from public.assessments a
    where a.id = can_edit_assessment.assessment_id
      and a.organization_id = org
      and a.expert_id = caller
      and a.status = 'draft'
  )
  and private.is_assigned_expert(org);
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_assessment_open()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  parent uuid;
begin
  foreach parent in array array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.assessment_id end,
    case when tg_op in ('INSERT', 'UPDATE') then new.assessment_id end
  ], null)
  loop
    if exists (
      select 1 from public.assessments a
      where a.id = parent and a.status = 'submitted'
    ) then
      raise exception 'assessment_locked: %', parent
        using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_assessment_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  unrated integer;
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'submitted' then
    -- Rateable top level items of the pinned version (sub items never count, invariant 4) whose
    -- section is not excluded and that have no answer row with a rating. A note without a rating
    -- counts as unrated.
    select count(*)
    into unrated
    from public.questionnaire_items i
    where i.version_key = new.questionnaire_version_key
      and i.rateable
      and i.parent_id is null
      and not exists (
        select 1 from public.assessment_answers x
        where x.assessment_id = new.id
          and x.item_id is null
          and x.section_key = i.section_key
      )
      and not exists (
        select 1 from public.assessment_answers r
        where r.assessment_id = new.id
          and r.item_id = i.id
          and r.rating is not null
      );
    if unrated > 0 then
      raise exception 'assessment_incomplete: % items unrated', unrated
        using errcode = 'check_violation';
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
    return new;
  end if;

  raise exception 'invalid assessments transition % -> % on %', old.status, new.status, old.id
    using errcode = 'check_violation';
end;
$function$;

CREATE OR REPLACE FUNCTION private.owns_assessment (
  assessment_id uuid
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
  if caller is null or assessment_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.assessments a
    where a.id = owns_assessment.assessment_id
      and a.expert_id = caller
  );
end;
$function$;

ALTER TABLE "public"."assessment_answers"
  ADD CONSTRAINT "assessment_answers_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.questionnaire_items(id);

ALTER TABLE "public"."assessment_answers"
  ADD CONSTRAINT "assessment_answers_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."assessments"
  ADD CONSTRAINT "assessments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;

ALTER TABLE "public"."assessments"
  ADD CONSTRAINT "assessments_expert_id_fkey" FOREIGN KEY (expert_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."assessments"
  ADD CONSTRAINT "assessments_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE "public"."assessments"
  ADD CONSTRAINT "assessments_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE "public"."assessment_answers"
  ADD CONSTRAINT "assessment_answers_assessment_id_fkey" FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;

ALTER TABLE "public"."assessments"
  ADD CONSTRAINT "assessments_questionnaire_version_fkey" FOREIGN KEY (questionnaire_key, questionnaire_version_key)
    REFERENCES public.questionnaire_versions(questionnaire_key, key);

CREATE VIEW "public"."expert_bookings" WITH (security_invoker=false) AS  SELECT id,
    organization_id,
    company_id,
    reference,
    package_key,
    package_name_snapshot,
    status,
    scheduled_at,
    delivered_at
   FROM public.orders o
  WHERE ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'delivered'::text])) AND ((assigned_expert_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_ops() AS is_ops)));

CREATE INDEX assessment_answers_assessment_id_idx ON public.assessment_answers USING btree (assessment_id);

CREATE UNIQUE INDEX assessment_answers_assessment_id_item_id_idx ON public.assessment_answers USING btree (assessment_id, item_id)
  WHERE (item_id IS NOT NULL);

CREATE UNIQUE INDEX assessment_answers_assessment_id_section_key_idx ON public.assessment_answers USING btree (assessment_id, section_key)
  WHERE (item_id IS NULL);

CREATE INDEX assessment_answers_organization_id_created_at_idx ON public.assessment_answers USING btree (organization_id, created_at DESC);

CREATE INDEX assessments_company_id_idx ON public.assessments USING btree (company_id);

CREATE INDEX assessments_expert_id_status_idx ON public.assessments USING btree (expert_id, status);

CREATE UNIQUE INDEX assessments_one_draft_per_company_questionnaire_idx ON public.assessments USING btree (company_id, questionnaire_key)
  WHERE (status = 'draft'::text);

CREATE INDEX assessments_order_id_idx ON public.assessments USING btree (order_id)
  WHERE (order_id IS NOT NULL);

CREATE INDEX assessments_organization_id_created_at_idx ON public.assessments USING btree (organization_id, created_at DESC);

CREATE TRIGGER assessment_answers_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.assessment_answers
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER assessment_answers_check_open
  BEFORE INSERT OR DELETE OR UPDATE ON public.assessment_answers
  FOR EACH ROW
  EXECUTE FUNCTION private.check_assessment_open();

CREATE TRIGGER assessment_answers_set_updated_at
  BEFORE UPDATE ON public.assessment_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER assessments_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.assessments
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_row();

CREATE TRIGGER assessments_check_transition
  BEFORE UPDATE OF status ON public.assessments
  FOR EACH ROW
  EXECUTE FUNCTION private.check_assessment_transition();

CREATE TRIGGER assessments_set_updated_at
  BEFORE UPDATE ON public.assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "assessment_answers: experts delete on their open draft" ON "public"."assessment_answers"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT private.can_edit_assessment(assessment_answers.assessment_id, assessment_answers.organization_id) AS can_edit_assessment));

CREATE POLICY "assessment_answers: experts insert on their open draft" ON "public"."assessment_answers"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.can_edit_assessment(assessment_answers.assessment_id, assessment_answers.organization_id) AS can_edit_assessment));

CREATE POLICY "assessment_answers: experts read their own assessments" ON "public"."assessment_answers"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.owns_assessment(assessment_answers.assessment_id) AS owns_assessment));

CREATE POLICY "assessment_answers: experts update their open draft" ON "public"."assessment_answers"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.can_edit_assessment(assessment_answers.assessment_id, assessment_answers.organization_id) AS can_edit_assessment))
  WITH CHECK (( SELECT private.can_edit_assessment(assessment_answers.assessment_id, assessment_answers.organization_id) AS can_edit_assessment));

CREATE POLICY "assessment_answers: ops full access" ON "public"."assessment_answers"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "assessments: assigned experts read" ON "public"."assessments"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_assigned_expert(assessments.organization_id) AS is_assigned_expert));

CREATE POLICY "assessments: experts read their own rows" ON "public"."assessments"
  FOR SELECT
  TO "authenticated"
  USING ((expert_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "assessments: experts start a draft for an assigned organization" ON "public"."assessments"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    ((( SELECT private.is_assigned_expert(assessments.organization_id) AS is_assigned_expert) AND (expert_id = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::text) AND (EXISTS
    ( SELECT 1
   FROM public.companies c
  WHERE ((c.id = assessments.company_id) AND (c.organization_id = assessments.organization_id)))) AND ((order_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.expert_bookings b
  WHERE ((b.id = assessments.order_id) AND (b.organization_id = assessments.organization_id)))))));

CREATE POLICY "assessments: experts update their own draft" ON "public"."assessments"
  FOR UPDATE
  TO "authenticated"
  USING (((expert_id = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::text) AND ( SELECT private.is_assigned_expert(assessments.organization_id) AS is_assigned_expert)))
  WITH CHECK (((expert_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_assigned_expert(assessments.organization_id) AS is_assigned_expert)));

CREATE POLICY "assessments: members read their organization" ON "public"."assessments"
  FOR SELECT
  TO "authenticated"
  USING ((organization_id = ( SELECT private.jwt_org_id() AS jwt_org_id)));

CREATE POLICY "assessments: ops full access" ON "public"."assessments"
  FOR ALL
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

COMMENT ON COLUMN "public"."assessment_answers"."item_id" IS 'The rated item; null on a section exclusion row.';

COMMENT ON COLUMN "public"."assessment_answers"."section_key" IS 'The excluded section; null on an item answer row.';

COMMENT ON COLUMN "public"."assessments"."order_id" IS 'The booking this assessment delivers, or null when it was started without one.';

COMMENT ON COLUMN "public"."assessments"."questionnaire_version_key" IS 'The questionnaire_versions row this assessment is rated against, pinned for life.';

COMMENT ON COLUMN "public"."assessments"."submitted_at" IS 'Written by private.check_assessment_transition on the draft -> submitted edge; never by a caller.';

COMMENT ON TABLE "public"."assessment_answers" IS 'One row per rated item or per excluded section of an assessment (spec 0019). Writable by the assessment''s expert while it is a draft; frozen for every role once submitted.';

COMMENT ON TABLE "public"."assessments" IS 'One questionnaire run by an expert for a client company (spec 0019): pinned to a version, drafted, submitted once. No score column: the score is computed from the answers.';

COMMENT ON VIEW "public"."expert_bookings" IS 'The bookings an expert is the assessor of (spec 0019): what, when and for whom, never the money. Definer view: the where clause is the access boundary.';

REVOKE ALL ON FUNCTION "private"."can_edit_assessment"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_edit_assessment"(uuid, uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "private"."check_assessment_open"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_assessment_open"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."check_assessment_transition"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_assessment_transition"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."owns_assessment"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."owns_assessment"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."assessment_answers" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."assessment_answers" TO "anon";

REVOKE ALL ON TABLE "public"."assessment_answers" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."assessment_answers" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assessment_answers" TO "postgres";

REVOKE ALL ON TABLE "public"."assessment_answers" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."assessment_answers" TO "service_role";

REVOKE ALL ON TABLE "public"."assessments" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."assessments" TO "anon";

REVOKE ALL ON TABLE "public"."assessments" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."assessments" TO "authenticated";

-- Hand fix (AGENTS.md): the table level REVOKE above drops the column grant the declarative
-- schema gives back, so it is re added here. Experts and ops update status, site and
-- conducted_on through the API and nothing else (spec 0019, AC-3).
GRANT UPDATE ("status", "site", "conducted_on") ON TABLE "public"."assessments" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assessments" TO "postgres";

REVOKE ALL ON TABLE "public"."assessments" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."assessments" TO "service_role";

-- Hand fix (AGENTS.md): the diff widens the view grant to full DML. expert_bookings is a read
-- only window on orders for the assessor: select for authenticated, nothing for anon; the
-- service role keeps the default privileges Supabase grants on creation.
REVOKE ALL ON TABLE "public"."expert_bookings" FROM "anon", "authenticated";

GRANT SELECT ON TABLE "public"."expert_bookings" TO "authenticated";
