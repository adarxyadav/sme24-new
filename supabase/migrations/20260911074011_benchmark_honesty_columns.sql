ALTER TABLE "public"."benchmark_assumptions"
  ADD COLUMN "is_assumption" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."benchmarks"
  ADD COLUMN "source_key" text;

ALTER TABLE "public"."benchmarks"
  ADD COLUMN "basis" jsonb;

ALTER TABLE "public"."benchmarks"
  ADD COLUMN "is_assumption" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."benchmarks"
  ADD CONSTRAINT "benchmarks_basis_check" CHECK (((basis IS NULL) OR ((jsonb_typeof(basis) = 'object'::text) AND (basis ? 'de'::text) AND (basis ? 'en'::text))));

COMMENT ON COLUMN "public"."benchmark_assumptions"."is_assumption" IS 'True when no published source exists for the value and it is a declared modelling assumption (spec 0016), as distinct from provisional, which means not yet read from its named source. The three indirect_multiplier rows carry true.';

COMMENT ON COLUMN "public"."benchmarks"."basis" IS 'Localized {de, en} sentence saying what the quartiles actually describe (spec 0016); this is the caveat the client sees, unlike source_note.';

COMMENT ON COLUMN "public"."benchmarks"."is_assumption" IS 'True when the value is a declared modelling assumption with no published source (spec 0016), as distinct from provisional, which means not yet read from its named source. No seeded peer row sets it true.';

COMMENT ON COLUMN "public"."benchmarks"."source_key" IS 'The source''s own classification the row was read from, for example "Suva class 22A" (spec 0016). Null when the source publishes on the same axis the row is keyed by.';

-- Hand fix (AGENTS.md, the four diff cases): `pnpm db:diff` also emitted a REVOKE ALL plus a full
-- DML GRANT on public.assigned_expert_summaries for `authenticated`, widening the view from SELECT
-- to insert, update and delete. That view is untouched by spec 0016 and its live grant is SELECT
-- only, which is correct, so both statements were removed rather than committed.
