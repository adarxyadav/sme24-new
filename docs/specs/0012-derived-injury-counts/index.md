# 0012. Derived injury counts as a display only snapshot block, not new KPI rows

**Date**: 2026-09-08
**Status**: Accepted

The decision history (context, the options weighed, the reasoning and the sources) is in [rationale.md](rationale.md).

## Summary

The dashboard shows a client its injury rates (LTIFR, TRIFR) and an annual cost in CHF, but nothing bridges the two. This spec adds two calculated numbers, "about how many recordable injuries a year" and "about how many lost time injuries a year", worked out from the client's own rates and headcount. They are not new KPIs: nothing new goes in the `kpi_definitions` catalogue and no new row goes in `company_kpis`, so no client facing value gains a third kind of source. The numbers live in a new `derived` column of the benchmark snapshot (one nullable jsonb column, added by a small migration), appear inside the opportunity card above the CHF figure, and carry a distinct "Calculated" badge that names the figure and the year they came from, so a client can never mistake a calculated number for one that was researched or one they typed in themselves.

## Requirements

**User stories**:
- As a client, I want to see roughly how many injuries a year my rates imply, so that the CHF figure reads as a consequence of my own numbers rather than an assertion.
- As a client, I want to tell at a glance that a number was calculated rather than researched or entered by me, so that I know which numbers to challenge and which to correct.
- As ops, I want existing snapshots to keep rendering after this ships, so that no client sees a broken dashboard between the deploy and the recompute.

**Acceptance criteria**:
- **AC-1**: When a company has a lost time rate (LTIFR, or the Suva accident rate as fallback) and a headcount, the opportunity card shows a derived lost time injury count above the CHF figure, phrased as a yearly expectation.
- **AC-2**: When a company has TRIFR and a headcount, the same block shows a derived recordable injury count.
- **AC-3**: Each derived count carries a "Calculated" badge that is visually distinct from both the confidence badge on a researched value and the "Your figure" badge on a client value.
- **AC-4**: Each derived count names the figure and reporting year it came from, in the form "derived from your LTIFR for 2024" or "derived from the researched LTIFR for 2024", following the source of the input row.
- **AC-5**: No derived count carries a confidence score, in the badge or anywhere else.
- **AC-6**: The two counts are independently nullable: a missing TRIFR hides only the recordable count and leaves the lost time count showing.
- **AC-7**: With no headcount, or no usable rate at all, the whole derived block is absent and the opportunity card renders exactly as it does today.
- **AC-8**: Values are shown to one decimal place, so a company whose rates imply 0.4 injuries a year sees 0.4 and not 0.
- **AC-9**: The derived counts and the cost line's `incidents` are produced by one shared pure function, so they cannot disagree.
- **AC-10**: The counts use the same `inputs.fte` and the same `hours_per_fte` assumption the cost line uses.
- **AC-11**: Whenever a derived count is produced, `hours_per_fte` appears in the snapshot's `assumptions` block, including when the cost line used the Suva accident rate and would not otherwise have recorded it.
- **AC-12**: A snapshot written before this change (`model_version` `benchmark-model@1`) still parses and renders, showing every existing element and no derived block. `SNAPSHOT_SCHEMAS` holds both versions under literal keys, so bumping `MODEL_VERSION` never removes the old one.
- **AC-13**: `kpi_definitions` gains no rows and `company_kpis.source` gains no values. The only schema change is one nullable `derived jsonb` column on `benchmark_snapshots`.
- **AC-14**: Every string on the derived block exists in both `messages/de-CH.json` and `messages/en-CH.json`, and the block passes axe on the dashboard.
- **AC-15**: The `benchmark-company` task validates and writes the derived block, so a block `computeBenchmark` produced is never silently dropped before the insert.
- **AC-16**: When the `hours_per_fte` assumption row is absent, the derived block is absent rather than showing a nonsense value.

## Decision

**Chosen option**: Option 2: A `derived` block in the snapshot.

The derived recordable and lost time counts are a display only block of the benchmark snapshot, computed by the pure model from the same exposure helper the cost line uses, marked in the UI with a "Calculated" badge and a provenance line naming the input rate and its year, carrying no confidence and no peer comparison. Nothing changes in the database.

**Implementation skills**: `recharts` (`andy-spike/skills`, `.claude/skills/recharts/`, only if the block gains any visual scale) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`)

## Feature design

**Data model sketch**:

`kpi_definitions`, `company_kpis`, `benchmark_peers` and `benchmark_assumptions` are all untouched, including the `company_kpis.source` check constraint, which stays `('research', 'client')`.

One migration, on `benchmark_snapshots` only. The table stores each block as its own top level jsonb column (`inputs`, `results`, `gaps`, `cost`, `assumptions`), so a sixth block needs a sixth column:

```sql
alter table public.benchmark_snapshots add column derived jsonb null;
```

Nullable with no default, so every existing row and every pgTAP insert that names an explicit column list keeps working unchanged. No policy change: the table's existing policies are column blind, and only the service role writes it. The declarative source is `supabase/schemas/26_benchmark_snapshots.sql`, then `pnpm db:diff`, `db:reset`, `test:db`, `db:types` as usual.

The matching TypeScript shape, in `src/features/benchmark/snapshot.ts`:

```
derivedCountSchema = {
  count:        number            // the derived count, unrounded
  fromKey:      "ltifr" | "trifr" | "accident_rate_per_1000_fte"
  fromValue:    number            // the rate it was derived from
  fromSource:   "research" | "client"
  fromYear:     number            // the input row's period_year
}

derivedSchema = {
  fte:          number            // the same inputs.fte the cost line used
  hoursPerFte:  number            // the assumption value applied
  lostTime:     derivedCount | null
  recordable:   derivedCount | null
}
```

`snapshotBlocksV2Schema` = `snapshotBlocksV1Schema` plus `derived: derivedSchema.nullable()`.

`SNAPSHOT_SCHEMAS` today is `{ [MODEL_VERSION]: snapshotBlocksV1Schema }`, a single entry keyed by the live constant, so bumping `MODEL_VERSION` would rename the only key rather than add one and would make every stored `@1` row unreadable. It must be restructured to literal keys before the bump:

```ts
export const SNAPSHOT_SCHEMAS = {
  "benchmark-model@1": snapshotBlocksV1Schema,
  "benchmark-model@2": snapshotBlocksV2Schema,
};
```

`MODEL_VERSION` then supplies only the write time value and becomes `benchmark-model@2`. `parseSnapshotBlocks` and `SnapshotRowLike` gain `derived` in the parsed object; a `@1` row parses under its own schema, which has no `derived` key, and readers treat it as absent.

**State transitions**: none. The derived block is recomputed whole on every `benchmark-company` run, exactly like every other block.

**API surface**: no new endpoint, route or server action. The derivation happens inside `computeBenchmark` (pure), which the existing `benchmark-company` task already calls on its three existing triggers (`research`, `client_edit`, `recompute`); the block reaches the browser through the existing `loadLatestSnapshot` read in `src/features/benchmark/queries.ts`.

Two existing call sites in `src/trigger/benchmark-company.ts` must move with it, or the block is produced and then silently lost. The task imports `snapshotBlocksV1Schema` by name and parses against it before the insert, and zod strips unknown keys by default, so a `derived` block would vanish there with no error. And the `.insert({...})` call names each block column explicitly, so `derived` has to be added to it. Both change together (AC-15).

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `computeBenchmark` | `derived.fte` | `inputs.fte`, already derived from `companies.employees_count` (spec 0008) |
| `computeBenchmark` | `derived.hoursPerFte` | the `hours_per_fte` row of `benchmark_assumptions`, the same value `costAt` reads; the whole block is `null` when that row is absent (AC-16) |
| `computeBenchmark` | `derived.lostTime.count` | `exposureCount("per_million_hours", ltifr rate, fte, hoursPerFte)`, the shared helper lifted out of `costAt` |
| `computeBenchmark` | `derived.lostTime.fromKey` | `ltifr` when an LTIFR input row exists, else `accident_rate_per_1000_fte` when one exists (then the helper is called with `"per_1000_fte"`), else the count is `null` |
| `computeBenchmark` | `derived.recordable.count` | `exposureCount("per_million_hours", trifr rate, fte, hoursPerFte)`; `null` when no TRIFR input row exists |
| `computeBenchmark` | `derived.*.fromValue`, `.fromSource`, `.fromYear` | the matching `InputKpi` in `inputs.kpis`, which already carries `value`, `source` and `periodYear` |
| `computeBenchmark` | `assumptions` includes `hours_per_fte` | `usedAssumptionKeys.add("hours_per_fte")` whenever either derived count is produced, in addition to the existing LTIFR condition |
| `BenchmarkSegment` | the displayed count, one decimal | `format.number(count, { maximumFractionDigits: 1, minimumFractionDigits: 1 })` on the stored unrounded value |
| `BenchmarkSegment` | the "Calculated" badge label and look | `benchmark.derived.calculated` in both catalogs, on `<Badge variant="outline">` with a calculator icon: outline reads as neither the filled confidence badge (`success`, `warning`, `secondary`) nor the `secondary` "Your figure" badge |
| `BenchmarkSegment` | the order of the two counts | fixed: lost time first, recordable second, so the number that drives the CHF figure sits nearest to it |
| `BenchmarkSegment` | the provenance line | `benchmark.derived.fromClient` or `benchmark.derived.fromResearch`, interpolating the localized KPI name (`kpi_definitions.name[locale]`, read the same way the KPI table does) and `fromYear`. When `fromKey` is `accident_rate_per_1000_fte` the dedicated pair `benchmark.derived.fromClientSuva` and `fromResearchSuva` is used instead, with the short phrase "your Suva accident rate" or "die Suva Unfallrate", because the catalogue name interpolates into an unreadable sentence |
| `BenchmarkSegment` | the exposure line, if shown | `derived.fte` and `derived.hoursPerFte` from the block, never recomputed |

**Key invariants**:
- One exposure formula. `exposureCount(shape, rate, fte, hoursPerFte)` is the only place a rate becomes a count; `costAt` calls it and the derived block calls it. A change to it moves both or neither (AC-9). It dispatches on the rate's **shape**, `"per_1000_fte"` (`rate * fte / 1000`) or `"per_million_hours"` (`rate * fte * hoursPerFte / 1_000_000`), not on `costAt`'s `incidentKpi` union, which has only two arms and no `trifr`. LTIFR and TRIFR both take the per million hours branch; the Suva accident rate takes the other. `costAt` keeps computing `costPerCase` and `annual` itself and delegates only the `incidents` line.
- The whole `derived` block is `null` when the `hours_per_fte` assumption row is absent, rather than multiplying by `undefined` and storing `NaN` (AC-16).
- `derived.lostTime.count` and `cost.incidents` are the same number whenever both exist and `cost.incidentKpi` equals `derived.lostTime.fromKey`. A Vitest assertion pins this.
- A derived count is never stored in `company_kpis` and never appears in `inputs.kpis`, `results` or `gaps`. `KPI_KEYS` is unchanged.
- The whole `derived` block is `null` when `inputs.fte` is null or not positive. There is no partial block without an FTE (AC-7).
- No derived value carries a `confidence` field. The type has no such key, so it cannot be added by accident (AC-5).
- `benchmark-model@1` stays in `SNAPSHOT_SCHEMAS` unchanged and unwidened. It is never given an optional `derived` key (AC-12).

**Security model**: unchanged. The new column inherits the table's existing policies, which are column blind. The derived block is computed by the `benchmark-company` task under the service client (already the only writer of `benchmark_snapshots`) and read through the existing snapshot select policy, which is organization scoped. Assigned experts and ops read it under their existing policies. No new data class, no new PII: the block holds two numbers derived from figures the reader already sees, so nothing becomes visible to anyone who could not already see its inputs.

**Configuration required**: none. No new env var, no new assumption row, no feature flag. `hours_per_fte` already exists in `benchmark_assumptions`.

**Critical test scenarios**:
- Happy path: a company with LTIFR 4.2, TRIFR 9.1 and 120 FTE produces both counts, and the lost time count equals `cost.incidents`, verifies **AC-1**, **AC-2**, **AC-9**.
- Partial inputs: the same company with TRIFR removed shows the lost time count and no recordable count, verifies **AC-6**.
- Fallback rate: a company with the Suva accident rate but no LTIFR derives the lost time count from the Suva rate and records `hours_per_fte` in `assumptions`, verifies **AC-11**.
- No exposure: a company with rates but no headcount produces `derived: null` and an opportunity card identical to today's, verifies **AC-7**.
- Small company rounding: rates and headcount implying 0.4 injuries a year render as 0.4, not 0 and not 1, verifies **AC-8**.
- Provenance follows source: a client entered LTIFR yields "derived from your LTIFR for 2024"; a researched one yields the researched wording; neither shows a confidence badge, verifies **AC-4**, **AC-5**.
- Backward compatibility: a stored `benchmark-model@1` row parses under the two version map, renders every existing element and shows no derived block, verifies **AC-12**.
- Round trip through the task: a computed block survives the task's parse and reaches the inserted row, rather than being stripped by a schema that does not know the key, verifies **AC-15**.
- Missing assumption: with no `hours_per_fte` row, the block is absent and no `NaN` is stored or shown, verifies **AC-16**.
- Accessibility and locale: the block passes axe on `/app` and every string resolves in both catalogs, verifies **AC-14**.

## Build plan

The project builds by Tracer Bullet, so the thin thread comes first: one count, running end to end from the migration through the pure model, the task and the snapshot read to the card. The version safety work leads, because getting it wrong makes every existing snapshot unreadable, and the rest thickens from there.

1. [x] Restructure `SNAPSHOT_SCHEMAS` in `snapshot.ts` to literal version keys (`"benchmark-model@1"`), leaving `MODEL_VERSION` as the write time value only, with a Vitest assertion that a `@1` row still parses. This lands before the bump, so it is independently revertible, satisfies **AC-12**.
2. [x] Migration: `add column derived jsonb null` on `benchmark_snapshots` via `supabase/schemas/26_benchmark_snapshots.sql` and `pnpm db:diff`, then `db:reset`, `test:db`, `db:types`. Confirm the existing pgTAP inserts in `supabase/tests/benchmark_snapshots.test.sql` still pass untouched (they name explicit column lists, and the column is nullable), satisfies **AC-13**.
3. [x] Lift the exposure arithmetic out of `costAt` into an exported pure `exposureCount(shape, rate, fte, hoursPerFte)` in `model.ts`, dispatching on rate shape rather than the incident KPI union so TRIFR has an arm, and have `costAt` call it for its `incidents` line only, with a Vitest assertion that the cost line's numbers are unchanged, satisfies **AC-9**.
4. [x] Add `derivedCountSchema`, `derivedSchema` and `snapshotBlocksV2Schema` to `snapshot.ts`, register `"benchmark-model@2"` beside `@1`, extend `SnapshotRowLike` and `parseSnapshotBlocks` with `derived`, and bump `MODEL_VERSION` in `catalogue.ts`, satisfies **AC-12**.
5. [x] Update the four places pinned to the old literal, deliberately rather than incidentally: `tests/features/benchmark/catalogue.test.ts:103`, `tests/trigger/benchmark-company.test.ts:339`, `tests/features/benchmark/ui/helpers.tsx:264` and `tests/features/research/queries.test.ts:304`. The last three should keep asserting a `@1` row still renders, satisfies **AC-12**.
6. [x] Build the derived block in `computeBenchmark`: the lost time count from LTIFR with the Suva fallback, the recordable count from TRIFR, each nullable, provenance copied from the matching `InputKpi`, the block null without a positive FTE or without the `hours_per_fte` row, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-6**, **AC-7**, **AC-16**.
7. [x] Carry the block through `src/trigger/benchmark-company.ts`: parse against `snapshotBlocksV2Schema` (or the version keyed lookup) instead of `snapshotBlocksV1Schema` by name, and add `derived` to the `.insert({...})` column list, satisfies **AC-15**.
8. [x] Register `hours_per_fte` in `usedAssumptionKeys` whenever a derived count is produced, so the disclosure names it even on the Suva path, satisfies **AC-11**, **AC-10**.
9. [x] Render the block in the opportunity card in `src/features/benchmark/ui/benchmark-segment.tsx`, above the CHF figure: lost time first then recordable, each at one decimal, the outline `Calculated` badge with its icon, the provenance line per count including the Suva variant, and the `benchmark.derived.*` keys in both catalogs, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-8**.
10. [x] Add a section to the ops only `/admin/design` gallery for the Calculated badge so axe scans it, and confirm it reads distinctly beside the confidence and "Your figure" badges, satisfies **AC-3**, **AC-14**.
11. [x] Vitest over the model: both counts, each missing input path, the Suva fallback, the missing assumption guard, the rounding boundary, the `cost.incidents` equality, and a `@1` snapshot parsing with no derived block; plus a Playwright assertion that the badge and counts render on a seeded company, with axe, satisfies **AC-6**, **AC-7**, **AC-8**, **AC-9**, **AC-12**, **AC-14**, **AC-16**.
12. [x] Document the block in `docs/benchmark.md` (what is derived, from what, why it is not a KPI, the `MODEL_VERSION` bump and the two version schema map), and note the post deploy `pnpm benchmarks:recompute` step in the runbook, satisfies **AC-13**.

## Migration plan

**Strategy**: additive migration (one nullable column, backward compatible per the `AGENTS.md` add, switch, remove later rule), then a versioned snapshot addition with a post deploy recompute.

**Phases**:
1. Land the schema map restructure (build task 1) on its own. `MODEL_VERSION` is still `@1`, behaviour is identical, and it can be reverted with one commit. This is the step that makes the bump safe.
2. Migrate: `add column derived jsonb null`. Previews share staging, so the column must land before or with the code that writes it; nullable and unread by the old code, so the currently deployed build is unaffected.
3. Deploy the code. `MODEL_VERSION` is now `@2`, but every stored row is still `@1` and parses under its own schema, showing no derived block. Nothing breaks and nothing changes for a client yet.
4. Run `pnpm benchmarks:recompute` against the target environment. Every company with a snapshot gets a fresh `@2` row and the derived block appears. Snapshots are insert only, so the `@1` rows stay in place as history.
5. Companies whose research finishes or whose figures change after phase 3 get an `@2` row on their own, with no ops action.

**Rollback**: revert the deploy. `@2` rows written in phase 4 become unreadable to the reverted code, which returns them as `unknown model version` and falls back to the waiting state; that is the wrong client experience, so the honest rollback is to re run `benchmarks:recompute` on the reverted build, which writes fresh `@1` rows on top. A revert before phase 4 needs no cleanup at all. The column itself is left in place on any rollback: dropping it is a separate later migration, and a nullable unread column costs nothing.

**Risks**:
- The schema map restructure is the load bearing step. Bumping `MODEL_VERSION` without it silently makes every existing snapshot unreadable, and the failure is quiet: the dashboard drops to a waiting state and the only signal is a Sentry warning per read. Phase 1 exists to keep that from happening in one commit.
- Recomputing every company at once puts a burst on the `benchmark-company` queue and on Trigger.dev concurrency. The script already exists and was used for feature 9, so the shape is known, but the run should be watched rather than fired and forgotten.
- A recompute recomputes everything, not just the derived block. A company whose peer rows or assumptions changed since its last snapshot will see other numbers move at the same time. Worth checking the seed data is stable before phase 4, and worth knowing when a client asks why their CHF figure shifted.
- Three worktrees share one local Supabase stack, so `db:reset` can skip a migration silently. Confirm the `derived` column actually exists after the reset before building on it.

## Consequences

**Positive**:
- The CHF figure gains the intuitive step it was missing, in whole injuries rather than rates, at the exact place a reader asks for it.
- The schema cost stays small: one nullable column on a service role only table, no RLS policy, no widened constraint, no backfill and no new writer class to reason about.
- Provenance stays sharp. Three visually distinct kinds of number (researched with confidence, client entered, calculated with a named input) instead of two kinds and an ambiguous third.
- The exposure formula gets a name and one home, which is a small correctness win for the cost line independently of this feature.

**Negative / tradeoffs**:
- `SNAPSHOT_SCHEMAS` now carries two versions permanently, and its shape changes from one self referential key to literal keys. Every future block change has to keep `@1` valid or consciously retire it, and the reader has two shapes to hold in mind. The upside is that the map finally does what its comment always claimed.
- The counts are invisible outside the snapshot. A later gap report, expert view or CSV export wanting them reads `benchmark_snapshots` rather than `company_kpis`, which is a slightly awkward source for a per company number.
- The dashboard needs a recompute run to show anything for existing clients, so there is a window where new and old companies see different cards.
- One more element in the opportunity card, on a page that is already long. The block has to stay small or it competes with the CHF figure it exists to support.
- These numbers will be quoted back at you. A client who reads "about 3 lost time injuries a year" and had two will treat it as a claim about their record rather than an expectation from their own rate, so the wording carries real weight and should be reviewed by someone who talks to clients.

**Neutral**:
- `MODEL_VERSION` moves to `benchmark-model@2`, which is the documented mechanism working as designed, not an exception.
- TRIFR stays out of `COST_LINKED_KPIS`. It gains a derived count for context but no CHF saving, and its peer comparison and distance ranking are unchanged.
- The derived block is a candidate for reuse later: if counts ever need peer comparison, promoting them is a migration plus a catalogue entry, not a rewrite, because the derivation already lives in the pure model.

## Follow-up

- [x] Enrolled as feature 27 in `docs/scope/client.md`, Slice 2, at spec capture.
- [ ] Review the two English and two German phrasings with someone who talks to pilot clients before the deploy. "About 3 lost time injuries a year" is an expected rate, not a count of events that happened, and the wording is what carries that distinction.
- [ ] Decide whether the block should also state its exposure inline ("based on 120 FTE and 1,800 hours each"). The data is in the block either way; this is a copy density call best made once the card is on screen.
- [ ] Watch the Trigger.dev queue during the phase 4 recompute, and confirm the seed data has not changed since the last run so no client sees an unrelated CHF shift at the same time.
- [ ] Latent bug found while writing this spec, out of scope here: `costAt` reads `values.hours_per_fte` unguarded, so a missing `hours_per_fte` assumption row yields `NaN` in the CHF figure rather than a null cost. The derived block guards it (AC-16); the cost line still does not. On the scope Deferred list.
- [ ] Decide when an old snapshot version is retired. `SNAPSHOT_SCHEMAS` grows by one entry per formula change with no rule for removing one, and the answer is probably "once no live row carries it", which needs a query rather than a guess. Not urgent at two versions; on the scope Deferred list.
