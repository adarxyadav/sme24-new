# Verify: derived injury counts · spec 0012 · updated 2026-09-08
_Steps derived from spec 0012 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Set up once, then work down. The dashboard company needs rates and a headcount, and a snapshot has to exist:
the block only appears on a `benchmark-model@2` row, so recompute after any change to the figures.

## UI / manual

- [x] Sign in as a client whose company has LTIFR, TRIFR and a headcount, open `/en/app`, and read the opportunity card → a "What that means in injuries" block sits above the CHF figure, showing a lost time count and a recordable count → AC-1, AC-2
- [x] Read the order of the two counts → lost time first, recordable second, so the number driving the CHF figure sits nearest to it → AC-1
- [x] Look at the badge on each count → an outline "Calculated" badge with a calculator icon, visibly different from the filled confidence badge lower in the same card and from the "Your figure" badge in the KPI table → AC-3
- [x] Read the line under each count → it names the figure and its reporting year, in the form "Calculated from the researched LTIFR for 2024" → AC-4
- [x] Enter your own LTIFR for that year in the "Your figures" card, save, and wait for the recompute → the lost time line now reads "Calculated from your LTIFR for 2024" → AC-4 (`fromSource` follows the input row)
- [x] Scan the whole derived block for a confidence score or percentage → none anywhere, in the badge or beside it → AC-5
- [x] Clear the TRIFR value and recompute → the recordable count disappears and the lost time count stays → AC-6
- [x] Clear the headcount on the same company and recompute → the whole block is gone and the card renders as it did before this feature → AC-7
- [x] Use a company whose rates and headcount imply under one injury a year (for example 5 employees at LTIFR 45) → the count reads 0.4, not 0 and not 1 → AC-8
- [x] Switch to `/de/app` → every string is German ("Was das an Unfällen bedeutet", "Berechnet", "Berechnet aus der recherchierten LTIFR für 2024") and the number still uses a decimal point, the Swiss convention → AC-14
- [x] Open `/admin/design` as ops and find the benchmark section → the Calculated badge appears there beside the confidence badge, and the page passes axe → AC-3, AC-14
- [x] Open a company whose newest snapshot predates this change (a stored `benchmark-model@1` row) → the card shows the CHF figure, the range, both savings, the confidence line and the compared count, and no derived block → AC-12

## Value sourcing (vary the input, check the output moves)

- [x] Change the headcount and recompute → both counts scale with it, and the exposure line under the block names the new headcount → `derived.fte` from `inputs.fte`
- [x] Use a company with the Suva accident rate and no LTIFR → the lost time count is derived from the Suva rate, uses the per 1000 FTE arm (`rate × fte ÷ 1000`, so 68 at 420 employees is 28.6), and the line reads "Calculated from the researched Suva accident rate for …", the short phrase rather than the catalogue name → AC-4, `fromKey` fallback
- [x] On that same Suva company, open "How this is calculated" → `hours_per_fte` is listed among the assumptions used, even though the cost line took the path that would not have recorded it → AC-11
- [x] Compare a company where the cost line and the derived block name the same rate → `derived.lostTime.count` equals `cost.incidents` exactly → AC-9
- [x] Compare a company where they differ (Suva rate present *and* LTIFR present) → the cost line uses Suva, the derived block uses LTIFR, and the two counts are deliberately different numbers → AC-9 boundary

## Commands

- [x] `pnpm test` → 1256 tests pass, including the derived model suite, the `exposureCount` dispatch, the version map and the segment tests with axe → AC-6, AC-7, AC-8, AC-9, AC-12, AC-14, AC-16
- [x] `pnpm test:db` → 466 pgTAP tests pass, including `has_column` and `col_is_null` on `benchmark_snapshots.derived` and a service role write of a version 2 row → AC-13
- [x] `psql $DB -c "select count(*) from kpi_definitions"` before and after a recompute → unchanged, and `select distinct source from company_kpis` still returns only `research` and `client` → AC-13
- [x] `psql $DB -c "\d public.benchmark_snapshots"` → exactly one new column, `derived jsonb`, nullable, no default → AC-13
- [x] `psql $DB -c "select derived from benchmark_snapshots order by created_at desc limit 1"` after a run on a company with rates and a headcount → a block holding `fte`, `hoursPerFte`, `lostTime` and `recordable`; not null, and no `NaN` anywhere → AC-15
- [x] Delete the `hours_per_fte` row from `benchmark_assumptions`, recompute, and read the stored block → `derived` is null, and no `NaN` reaches the row or the card → AC-16
- [x] `pnpm build` → compiles, and `/app` still renders → AC-14
- [x] `pnpm test:e2e -- benchmark.spec.ts` with the local stack and `pnpm trigger:dev` in fixture mode → the derived assertions pass on the seeded Suva company, with axe → AC-1, AC-3, AC-4, AC-5, AC-6

_Verified 2026-09-08. The client source step and the headcount scaling step were exercised against the
pure `computeBenchmark`, not the form, because the fixture research provider always writes `source
'research'`; the values and the provenance they produce are the same ones the form path feeds in.
`pnpm test:db` was blocked on the first attempt, because three worktrees share one local Supabase
stack and it carried another worktree's migrations, so `benchmark_snapshots.derived` was absent and
every file aborted. Re-run 2026-09-08 on an uncontended stack after `pnpm db:reset`: 466 tests across
20 files pass, `Result: PASS`, including the three AC-13 assertions on the `derived` column and the
service role write of a `benchmark-model@2` row._

## Post deploy

- [ ] Deploy with the migration, before any recompute → every stored row is still `@1`, every dashboard renders, and no client sees a broken card → AC-12
- [ ] Run `pnpm benchmarks:recompute` against the environment and watch the Trigger.dev queue → each company gets a fresh `@2` row and the counts appear; confirm the seed data has not changed first, because a recompute moves every number, not only the derived block

## Acceptance-criteria coverage

- AC-1 · covered by the card and order steps, and the e2e run
- AC-2 · covered by the card step
- AC-3 · covered by the badge step and the `/admin/design` step
- AC-4 · covered by the provenance step, the client edit step and the Suva phrase step
- AC-5 · covered by the confidence scan step
- AC-6 · covered by the cleared TRIFR step
- AC-7 · covered by the cleared headcount step
- AC-8 · covered by the small company step
- AC-9 · covered by the two equality steps (same key, and the differing key boundary)
- AC-10 · covered by the headcount change step and the `hours_per_fte` disclosure step
- AC-11 · covered by the Suva disclosure step
- AC-12 · covered by the stored version 1 row step and the pre recompute deploy step
- AC-13 · covered by the three psql steps and `pnpm test:db`
- AC-14 · covered by the German step, the gallery axe step and `pnpm build`
- AC-15 · covered by the stored block psql step
- AC-16 · covered by the deleted assumption step
