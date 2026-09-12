CREATE TABLE "public"."questionnaire_items" (
  "id"          text                     NOT NULL,
  "version_key" text                     NOT NULL,
  "position"    integer                  NOT NULL,
  "parent_id"   text,
  "section_key" text                     NOT NULL,
  "group_key"   text,
  "label"       text                     NOT NULL,
  "rateable"    boolean                  NOT NULL,
  "title"       jsonb                    NOT NULL,
  "requirement" jsonb,
  "question"    jsonb                    NOT NULL,
  "de_reviewed" boolean                  NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "questionnaire_items_id_matches" CHECK ((id = ((version_key || '/'::text) || ("position")::text))),
  CONSTRAINT "questionnaire_items_label_check" CHECK (((char_length(label) >= 1) AND (char_length(label) <= 20))),
  CONSTRAINT "questionnaire_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "questionnaire_items_position_check" CHECK (("position" >= 1)),
  CONSTRAINT "questionnaire_items_question_check" CHECK (((jsonb_typeof(question) = 'object'::text) AND (question ? 'de'::text) AND (question ? 'en'::text))),
  CONSTRAINT "questionnaire_items_requirement_check"
    CHECK (((requirement IS NULL) OR ((jsonb_typeof(requirement) = 'object'::text) AND (requirement ? 'de'::text) AND (requirement ? 'en'::text)))),
  CONSTRAINT "questionnaire_items_title_check" CHECK (((jsonb_typeof(title) = 'object'::text) AND (title ? 'de'::text) AND (title ? 'en'::text))),
  CONSTRAINT "questionnaire_items_version_key_position_key" UNIQUE (version_key, "position")
);

ALTER TABLE "public"."questionnaire_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."questionnaire_versions" (
  "key"               text                     NOT NULL,
  "questionnaire_key" text                     NOT NULL,
  "version"           integer                  NOT NULL,
  "title"             jsonb                    NOT NULL,
  "sections"          jsonb                    NOT NULL,
  "item_count"        integer                  NOT NULL,
  "source_note"       text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "questionnaire_versions_item_count_check" CHECK ((item_count >= 0)),
  CONSTRAINT "questionnaire_versions_key_check" CHECK ((key ~ '^[a-z][a-z0-9_]*@[0-9]+$'::text)),
  CONSTRAINT "questionnaire_versions_key_matches" CHECK ((key = ((questionnaire_key || '@'::text) || (version)::text))),
  CONSTRAINT "questionnaire_versions_pkey" PRIMARY KEY (key),
  CONSTRAINT "questionnaire_versions_questionnaire_key_check" CHECK ((questionnaire_key ~ '^[a-z][a-z0-9_]*$'::text)),
  CONSTRAINT "questionnaire_versions_questionnaire_key_key_key" UNIQUE (questionnaire_key, key),
  CONSTRAINT "questionnaire_versions_questionnaire_key_version_key" UNIQUE (questionnaire_key, VERSION),
  CONSTRAINT "questionnaire_versions_sections_check" CHECK ((jsonb_typeof(sections) = 'array'::text)),
  CONSTRAINT "questionnaire_versions_title_check" CHECK (((jsonb_typeof(title) = 'object'::text) AND (title ? 'de'::text) AND (title ? 'en'::text))),
  CONSTRAINT "questionnaire_versions_version_check" CHECK ((version >= 1))
);

ALTER TABLE "public"."questionnaire_versions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."questionnaire_items"
  ADD CONSTRAINT "questionnaire_items_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.questionnaire_items(id) ON DELETE CASCADE;

ALTER TABLE "public"."questionnaire_items"
  ADD CONSTRAINT "questionnaire_items_version_key_fkey" FOREIGN KEY (version_key) REFERENCES public.questionnaire_versions(key) ON DELETE CASCADE;

CREATE INDEX questionnaire_items_parent_id_idx ON public.questionnaire_items USING btree (parent_id);

CREATE INDEX questionnaire_items_version_section_position_idx ON public.questionnaire_items USING btree (version_key, section_key, "position");

CREATE TRIGGER questionnaire_items_set_updated_at
  BEFORE UPDATE ON public.questionnaire_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER questionnaire_versions_set_updated_at
  BEFORE UPDATE ON public.questionnaire_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "questionnaire_items: ops insert" ON "public"."questionnaire_items"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "questionnaire_items: ops update" ON "public"."questionnaire_items"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "questionnaire_items: signed in users read" ON "public"."questionnaire_items"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "questionnaire_versions: ops insert" ON "public"."questionnaire_versions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "questionnaire_versions: ops update" ON "public"."questionnaire_versions"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_ops() AS is_ops))
  WITH CHECK (( SELECT private.is_ops() AS is_ops));

CREATE POLICY "questionnaire_versions: signed in users read" ON "public"."questionnaire_versions"
  FOR SELECT
  TO "authenticated"
  USING (true);

COMMENT ON COLUMN "public"."questionnaire_items"."id" IS '<version key>/<position>, for example iso45001@1/12.';

COMMENT ON COLUMN "public"."questionnaire_items"."parent_id" IS 'The clause an annex sub item belongs to; null for a top level item.';

COMMENT ON COLUMN "public"."questionnaire_versions"."key" IS '<questionnaire key>@<version>, for example iso45001@1.';

COMMENT ON COLUMN "public"."questionnaire_versions"."sections" IS 'The outline in display order: [{key, label, title: {de, en}, groups: [{key, label, title: {de, en}}]}].';

COMMENT ON TABLE "public"."questionnaire_items" IS 'Every item of a questionnaire version in document order (spec 0019). Identity is the position; the label is display text. Every signed in user reads; ops and migrations write.';

COMMENT ON TABLE "public"."questionnaire_versions" IS 'One row per seeded questionnaire version (spec 0019): the outline of sections and groups. Every signed in user reads; ops and migrations write.';

REVOKE ALL ON TABLE "public"."questionnaire_items" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."questionnaire_items" TO "anon";

REVOKE ALL ON TABLE "public"."questionnaire_items" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."questionnaire_items" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."questionnaire_items" TO "postgres";

REVOKE ALL ON TABLE "public"."questionnaire_items" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."questionnaire_items" TO "service_role";

REVOKE ALL ON TABLE "public"."questionnaire_versions" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."questionnaire_versions" TO "anon";

REVOKE ALL ON TABLE "public"."questionnaire_versions" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."questionnaire_versions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."questionnaire_versions" TO "postgres";

REVOKE ALL ON TABLE "public"."questionnaire_versions" FROM "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE ON TABLE "public"."questionnaire_versions" TO "service_role";

-- Re added by hand (AGENTS.md gotcha): the diff renders the schema's `revoke truncate` only as a
-- grant list without TRUNCATE; the explicit revoke keeps the intent readable and holds even if a
-- later default privilege hands it back (spec 0019, AC-2).
REVOKE TRUNCATE ON TABLE "public"."questionnaire_versions", "public"."questionnaire_items" FROM "anon", "authenticated", "service_role";
