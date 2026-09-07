ALTER TABLE "public"."benchmark_snapshots"
  ADD COLUMN "derived" jsonb;

COMMENT ON COLUMN "public"."benchmark_snapshots"."derived" IS 'Display only counts computed from the stored rates and headcount (spec 0012); null on a benchmark-model@1 row and whenever no count could be derived.';
