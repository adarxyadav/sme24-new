# 0016. Peer data curation and model honesty

**Date**: 2026-09-11
**Status**: Accepted

## Summary

The benchmark presents modelled estimates as if they were measured peer statistics. Research done for this spec established three facts: no Swiss or European body publishes the indirect to direct accident cost ratio the CHF figure multiplies by, no Swiss source publishes safety outcomes by company size band, and the Suva accident tables use their own premium class scheme rather than NOGA sections. On top of that, eleven of the twenty two seeded peer rows carry one number repeated as all three quartiles, so a client in those sectors is told they are in the "Top quarter" of a distribution that does not exist.

This spec changes what the product claims rather than the arithmetic behind it. The CHF headline becomes a range, a peer row records whether it holds a real distribution or a single point and is described accordingly, every KPI declares whether a Swiss source exists for it, and the launch gate learns the difference between a value nobody has read yet and a value nobody publishes. The peer values themselves stay yours to replace afterwards; this delivers the schema, the model and the wording that make replacing them honest.

## Requirements

**User stories**:

- As a client, I want the franc figure to show me how uncertain it is, so that I do not quote a precise number to my board that rests on a contested assumption.
- As a client in a sector with thin data, I want to be told that my comparison rests on a single sector figure, so that I do not believe I am in the top quarter of a peer group that was never measured.
- As a client, I want a KPI with no Swiss source to say so, so that I stop waiting for data that is never coming.
- As the owner, I want the launch gate to distinguish an unread value from a declared assumption, so that the gate can pass without either lying or being switched off.
- As the owner, I want replacing a seed value to fail the build when it invalidates a public claim, so that the marketing figure cannot quietly drift away from the model.

**Acceptance criteria** (the contract, each criterion independently checkable):

- **AC-1**: `benchmarks` gains two columns, `source_key text null` (the source's own classification, for example `Suva class 22A`) and `basis jsonb null` (a localized object with `de` and `en` keys, saying what the quartiles actually describe), both beside the existing `source_note` which keeps its current meaning and content. The seed CSV gains `source_key`, `basis_de` and `basis_en` columns, parsed by `benchmarkRowSchema` with the same both-or-neither rule that `source_note_de` and `source_note_en` already use. The schema change and the data change are **two ordered migrations, schema first**: edit `supabase/schemas/24_benchmarks.sql` and `25_benchmark_assumptions.sql`, run `pnpm db:diff` for the DDL, and only then `pnpm benchmarks:migration`, which emits `insert … on conflict` upserts and never DDL, so it fails on an unknown column if the order is reversed. Read the generated diff against the four hand fix cases in `AGENTS.md` (these are plain columns with no view or grant interaction, so none is expected to apply). All twenty two peer rows ship with `source_key` and `basis` null; filling them is curation work, not this build. `pnpm db:types` regenerates `database.types.ts`.

- **AC-2**: `benchmark_assumptions` gains `is_assumption boolean not null default false`, meaning the value is a declared modelling assumption for which no published source exists, as distinct from `provisional`, which keeps its existing meaning of "not yet read from its named source". The seed CSV gains an `is_assumption` column. The three `indirect_multiplier*` rows are seeded with `is_assumption = true` and `provisional = false`; every other assumption row keeps `is_assumption = false` and stays `provisional = true` until read. `benchmarks` gains the same column with the same default for symmetry, and no seeded peer row sets it true.

- **AC-3**: The launch gate in `docs/benchmark.md` becomes two queries rather than one. The first requires zero rows where `provisional` is true, on both tables. The second lists every row where `is_assumption` is true, which is permitted to be non empty but must match an expected set named in the runbook. The pgTAP suites `benchmarks.test.sql` and `benchmark_assumptions.test.sql` replace their "every seeded row is provisional" assertions with assertions over the two flags: every peer row is provisional and not an assumption, the four non multiplier assumptions are provisional and not assumptions, the three multiplier rows are assumptions and not provisional.

- **AC-4**: `src/features/benchmark/seed-migration.ts` derives a peer row's shape from its values: a row whose `p25`, `median` and `p75` are all equal is a `point` row, any other row is a `distribution` row. The shape is never a CSV column and never hand typed. `computeBenchmark` carries the derived shape onto the snapshot's `peer` block as `shape: "point" | "distribution"`, alongside the existing quartiles.

- **AC-5**: `POSITIONS` in `snapshot.ts` gains `above_average` and `below_average`. `positionOf` returns one of those two, and only those two, when the peer row's shape is `point`: at or better than the single value gives `above_average`, worse gives `below_average`, using the same direction rule as today. A `distribution` row keeps the existing four band behaviour unchanged. **The `iso_45001_certified` branch is routed through the same rule**: today it returns early at `model.ts:145` with `above_median` or `below_median` before any shape is consulted, so a certified share (one number, therefore always a point row by AC-4) would print the word median about a point. It keeps its `value >= 1` test and gains the shape branch, giving `above_average` or `below_average` on a point row and the existing two values on a distribution row. With that branch fixed, the four quartile positions are unreachable for a point row by construction rather than by wording.

- **AC-6**: The positions list renders a point row without a `QuartileBand` and without a replacement graphic: text only, showing the company value against one labelled sector figure and the band label from the two new positions. The peer label names the source's own classification from `source_key` when the row carries one, and falls back to the existing `peerLabel()` section, band and year string unchanged when `source_key` is null, which is every row on day one. The words "quarter", "quartile" and "median" do not appear for a point row in either language. A distribution row renders exactly as it does today. The `srBand` narration for a point row names one sector figure and never three identical quartiles.

- **AC-6b**: The peer label surfaces a broadened peer group. When the selected row came from rung 3 or 4 of the `selectPeer` ladder, meaning the company's own section had no row and the match fell back to `ALL`, the label says so, as it already does for a nearest year match. This matters because the shape can flip on fallback: a company in a single point section whose row is removed during curation would otherwise silently gain a `QuartileBand` drawn from the `ALL` row, which does carry real spread, with no signal that the comparison group changed.

- **AC-7**: `KPI_CATALOGUE` in `src/features/research/catalogue.ts` gains `peerStatus: "sourced" | "pending" | "no_source"` and `peerNote`, a per KPI sentence key explaining the status. `fatalities` and `near_miss_rate` are `no_source`; `absenteeism_rate`, `ltifr`, `trifr`, `lost_days_per_incident` and `iso_45001_certified` are `pending`; `accident_rate_per_1000_fte` is `sourced`. The existing Vitest test that keeps the catalogue equal to the `kpi_definitions` seed is extended to assert every key carries a status and a note key present in both catalogs.

- **AC-8**: A KPI whose `peerStatus` is `no_source` renders its own sentence from `peerNote` rather than the shared "No peer data yet", and a `pending` KPI keeps a "not yet" wording that names what is awaited. The positions list still shows every active KPI including the sourceless ones, so the fatality ranking rule in `computeBenchmark` is untouched.

- **AC-9**: The opportunity card leads with the cost range and carries the point estimate beneath it as the working estimate, reversing today's arrangement. The range ends are rounded outward at the `roundChf` step, low rounded down and high rounded up, by a new pure function beside `roundChf`, so the displayed band always contains the computed one. The point figure keeps `roundChf` as today.

- **AC-10**: The calculation disclosure names each multiplier boundary with its source and states plainly that the low bound comes from the ILO accident cost iceberg, the high bound from Heinrich (1931) which modern safety science disputes, and that the middle value is the product's own estimate rather than a published Swiss figure. The three multiplier rows carry that wording in their `note` column, and the disclosure renders the `note` for any assumption where `is_assumption` is true. `assumptionUsedSchema` gains `note` and `isAssumption` so the snapshot carries them.

- **AC-11**: The peer caveat reaches the client. `assumptionUsedSchema` already carries the source; the snapshot's `peer` block gains `sourceKey` and `basis`, copied from the row, and the disclosure renders the basis sentence for any peer row that carries one. A null `basis`, which is every row on day one, renders no caveat line at all rather than an empty element or a placeholder. A value the curator wrote into `basis` is visible to the client rather than dying in the database as `source_note` does today.

- **AC-12**: `MODEL_VERSION` becomes `benchmark-model@3` and `SNAPSHOT_SCHEMAS` gains a `"benchmark-model@3"` key holding the v3 schema, keeping `@1` and `@2` in place and unrenamed. The `benchmark-company` task looks its write schema up by version rather than naming a schema, as spec 0012 requires. One watched `pnpm benchmarks:recompute` after the deploy moves every stored row to `@3`, which also clears the outstanding `@2` recompute debt.

- **AC-13**: The `benchmark_ready` email leads with the range and carries the working estimate beneath it, the same order as the card, so the artifact most likely to be forwarded to a board does not present a precise figure the dashboard has just qualified. `benchmarkReadyDataSchema` gains optional `costLowChf` and `costHighChf`; the template renders the range only when both are present and falls back to the single figure alone when either is absent. The range ends are rounded with the same outward rounding function as the card (AC-9), applied in the task before the values reach the template, so the two surfaces never show different numbers for one snapshot. Both catalogs gain the range string.

- **AC-13b**: A Vitest test asserts every `POSITIONS` value has a `positions.band.<value>` key in both message catalogs, mirroring the existing catalogue equality tests. The lookup at render time is a message key built from the stored value, so a missing key fails at runtime rather than at build, and the two new positions must not be able to ship without their labels.

- **AC-14**: A Vitest test computes the public marketing example from the committed seed CSVs through the real model, for the example company the homepage names (120 FTE, NOGA section C, the p75 accident rate), and asserts the result matches the `CHF 148 000` literal in both message catalogs. Replacing a seed value that moves the example fails the build.

- **AC-15**: A second research fixture company in a single point NOGA section joins the existing section C fixture, so both the distribution path and the point path are exercised. The Vitest model suite covers the point path (shape derivation, the two new positions, the wording rule), and the Playwright benchmark thread asserts a point row renders no `QuartileBand` and no quarter wording, with axe on that state.

- **AC-16**: The `/admin/design` gallery gains a point comparison example beside the three existing `QuartileBand` shapes, and a range led opportunity card, so axe scans both new states.

- **AC-17**: `docs/benchmark.md` records the two flag meanings, the two gate queries, the shape derivation rule, the source columns and what each is for, the per KPI peer status table, and the sources the research confirmed unreadable, so the curation pass does not re investigate dead ends: no Swiss indirect to direct ratio exists, no Swiss source publishes safety outcomes by size band, no fatality or near miss rate is published by sector, the BFS absence table is published by NOGA section and is readable, and the UVG accident tables need a Suva class to NOGA crosswalk that is not officially published.

## Decision

**Chosen option**: Option 3: Change the claims, keep the arithmetic.

The model's formula is sound and its inputs are sourced; only the multiplier is an assumption and only some peer rows carry a distribution. So the fix is in what the product says about its numbers, not in how it computes them: a range led headline, a shape aware peer comparison, declared assumptions the gate can permit by name, and per KPI source status.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`)

## Rationale

Reasoning, the options weighed and the research evidence: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

`benchmarks` (existing, kind G) gains:

| Column | Type | Null | Meaning |
|---|---|---|---|
| `source_key` | `text` | yes | The source's own classification the row was read from, for example `Suva class 22A`. Null when the source publishes on the same axis the row is keyed by. |
| `basis` | `jsonb` | yes | Localized object with `de` and `en`, saying what the quartiles describe. Same shape check as `source_note`. |
| `is_assumption` | `boolean` | no, default `false` | The value is a declared assumption with no published source. No seeded peer row sets it true. |

`benchmark_assumptions` (existing, kind G) gains `is_assumption boolean not null default false`. The three `indirect_multiplier*` rows carry `true`.

Neither table changes its primary key, its unique constraint, its policies or its grants. Both additions are nullable or defaulted, so the migration is additive and backward compatible, which previews sharing staging require.

**Snapshot body, version 3** (`snapshotBlocksV3Schema`, extending v2):

- `peerSchema` gains `shape: "point" | "distribution"`, `sourceKey: string | null`, `basis: {de, en} | null`.
- `assumptionUsedSchema` gains `isAssumption: boolean` and `note: {de, en} | null`.
- `POSITIONS` gains `above_average`, `below_average`.

**State transitions**: none. Snapshots stay insert only and immutable; a formula or body change adds a `SNAPSHOT_SCHEMAS` key and never rewrites a stored row.

**API surface**: no new endpoint or server action. The changes are to a pure model function, a schema, two tables, the rendering of an existing segment and one email template.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `pnpm benchmarks:migration` | a row's `shape` | derived in `seed-migration.ts` from `p25 == median == p75`, never a CSV column (AC-4) |
| `pnpm benchmarks:migration` | `source_key`, `basis` | new CSV columns the curator fills; null allowed |
| `computeBenchmark` | `peer.shape`, `peer.sourceKey`, `peer.basis` | copied from the selected `benchmarks` row |
| `computeBenchmark` | `position` for a point row | `positionOf` with the shape branch (AC-5); direction from `kpi_definitions.direction` as today |
| `computeBenchmark` | `assumptions[].isAssumption`, `.note` | copied from the `benchmark_assumptions` row |
| opportunity card | the range ends | `costLowChf` and `costHighChf` from the snapshot, rounded outward by the new pure function (AC-9) |
| opportunity card | the working estimate | `costChf`, `roundChf` as today |
| positions list | a point row's sector figure | `peer.median`, which for a point row equals `p25` and `p75` |
| positions list | a point row's peer label | `peer.sourceKey` when set, else the existing `peerLabel()` section, band and year string (AC-6) |
| positions list | the broadened group note | `peer.rung`, already on the snapshot, when the rung is 3 or 4 (AC-6b) |
| positions list | a `no_source` KPI's sentence | `KPI_CATALOGUE[key].peerNote`, a message key present in both catalogs (AC-7) |
| disclosure | a multiplier's caveat | the assumption row's `note`, rendered when `isAssumption` is true (AC-10) |
| disclosure | a peer row's caveat | `peer.basis` (AC-11) |
| `benchmark_ready` email | the range line | `costLowChf` and `costHighChf` on the template data, rounded outward by the AC-9 function in the task before the template sees them |
| marketing example test | the expected literal | the real model over the committed CSVs (AC-14) |

**Key invariants**:

- A peer row is a point row exactly when `p25 == median == p75`, compared with exact equality on the parsed numbers. The three CSV values of a point row are written identically rather than computed independently, so no tolerance rule is needed.
- The cost range ends are non negative by construction: `costAt` returns `incidents * costPerCase * multiplier`, and incidents, cost per case and all three multipliers are non negative, so the outward rounding function needs no defined behaviour below zero.
- A point row never yields a quartile position, and never renders the words quarter, quartile or median in either language.
- `provisional` and `is_assumption` are independent and never both true on the same row: a value is either awaiting a reading or declared unsourceable, not both.
- `gross` model behaviour is unchanged: the same inputs give the same `costChf`. Only the presentation, the peer description and the stored metadata change.
- `SNAPSHOT_SCHEMAS` keys stay literal version strings; `@1` and `@2` keep working and are never renamed (spec 0012).

**Security model**: unchanged. `benchmarks` and `benchmark_assumptions` stay readable by every signed in user and writable by ops and migrations only. `benchmark_snapshots` keeps its tenant policies and its revoked grants. The new columns carry no personal data. No compliance scope changes.

**Configuration required**: none. No new environment variable, credential or feature flag.

**Critical test scenarios**:

- Happy path, distribution: a company in section C computes a snapshot whose peer row is a distribution, renders the `QuartileBand` and a quartile position exactly as today, verifies **AC-4**, **AC-5**, **AC-6**
- Happy path, point: a company in a single point section renders the sector comparison, an `above_average` or `below_average` band, no `QuartileBand` and no quarter wording, verifies **AC-4**, **AC-5**, **AC-6**, **AC-15**
- Range presentation: the card leads with the range, the ends are rounded outward so the displayed band contains the computed one, and the working estimate sits beneath, verifies **AC-9**
- Declared assumption: the disclosure names both multiplier boundaries with their sources and the Heinrich caveat, verifies **AC-10**
- Peer caveat: a row carrying `basis` shows that sentence in the disclosure, verifies **AC-11**
- Sourceless KPI: `fatalities` renders its own sentence rather than "No peer data yet", and still ranks first when its value is above zero, verifies **AC-7**, **AC-8**
- Gate: pgTAP asserts the two flags across both tables, including that no row is both provisional and an assumption, verifies **AC-2**, **AC-3**
- Marketing drift: changing a seed value that moves the worked example fails the example test, verifies **AC-14**
- Version: a stored `@1` and `@2` row still parse and render, and a fresh computation writes `@3`, verifies **AC-12**
- Schema and seed: pgTAP proves the five new columns exist with their null and default rules and the localized `basis` shape check, and the Vitest seed suite parses the committed CSVs with the new columns and rejects a row carrying one half of a `basis` pair, verifies **AC-1**
- Email: a snapshot with a range renders the range line in both languages leading with the range, and one without `costLowChf` and `costHighChf` renders the single figure alone with no empty range, verifies **AC-13**
- Fallback signal: a company whose own section has no row falls to the `ALL` rung, and the peer label says the group was broadened rather than silently showing a `QuartileBand` from the wider row, verifies **AC-6b**
- Catalogue completeness: every `POSITIONS` value has a label key in both catalogs, so the two new positions cannot ship unlabelled, verifies **AC-13b**
- Gallery: the point comparison and the range led card render on `/admin/design` and pass axe, verifies **AC-16**
- Runbook: a Vitest check asserts `docs/benchmark.md` names both gate queries and lists the expected assumption keys, so the documented gate cannot drift from the seeded flags, verifies **AC-17**

## Migration plan

**Strategy**: additive, no data transformation, no code freeze.

**Phases**:

1. Migration adds the five columns, all nullable or defaulted, and seeds the flag values on the existing rows. Old code ignores them.
2. Deploy the model, schema and UI changes together. The `@3` schema starts being written; `@1` and `@2` rows keep rendering under their own schemas.
3. One watched `pnpm benchmarks:recompute` moves every stored row to `@3` and clears the outstanding `@2` debt at the same time.

**Rollback**: reverting the deploy leaves `@3` rows in the database. They stop parsing under the reverted code and are treated as absent by the reader, which is the existing designed behaviour for an unknown version: the dashboard shows "not available yet" rather than breaking. A recompute on the reverted code restores `@2` rows. The columns can stay; they are additive and unread by old code.

**Risks**: the recompute changes visible CHF figures for every company at once, because it moves every block and not only the new ones. Confirm the seed has not changed in the same window, or be ready to explain a shifted figure. This is the same caution spec 0012 recorded and did not fully discharge.

## Build plan

Tracer Bullet, and the thread here runs from the seed through the model to the screen. The first slice deliberately takes one honesty problem end to end (the point row, which is the live misrepresentation) rather than landing all five schema columns first, so a reviewable, shippable improvement exists after slice one.

1. [x] Migration for all five columns with the flag values seeded, the CSV columns and their Zod rules, the regenerated seed migration, `db:types`, and the pgTAP flag assertions, satisfies **AC-1**, **AC-2**, **AC-3**
2. [x] Shape derivation in `seed-migration.ts`, `peer.shape` on the snapshot, the two new positions and the `positionOf` branch, with the Vitest model table covering both paths, satisfies **AC-4**, **AC-5**
3. [x] The point row rendering: no band, the sector figure, the reworded labels and narration in both catalogs, the broadened group note on a rung 3 or 4 match, the `POSITIONS` catalogue completeness test, the second fixture, and the Playwright assertion with axe, satisfies **AC-6**, **AC-6b**, **AC-13b**, **AC-15**
4. [x] The `@3` schema and `SNAPSHOT_SCHEMAS` key, `MODEL_VERSION` bumped, the task looking its schema up by version, satisfies **AC-12**
5. [x] The range led card with the outward rounding function, and the gallery states, satisfies **AC-9**, **AC-16**
6. [x] The assumption and peer caveats through to the disclosure: `note` and `isAssumption` on the assumption block, `sourceKey` and `basis` on the peer block, the multiplier wording in the seed, satisfies **AC-10**, **AC-11**
7. [x] Per KPI peer status and notes in the catalogue with the extended equality test, and the reworded sourceless and pending states, satisfies **AC-7**, **AC-8**
8. [x] The `benchmark_ready` range line and its schema fields, satisfies **AC-13**
9. [x] The marketing example test computing from the CSVs, satisfies **AC-14**
10. [x] `docs/benchmark.md`: the two flags, the two gate queries, the shape rule, the source columns, the KPI status table and the confirmed dead ends, satisfies **AC-17**

## Consequences

**Positive**:

- A client is no longer told they are in a quarter of a distribution that was never measured, which is the same class of claim the owner removed `HeroBenchmark` for.
- The launch gate becomes passable without either lying or being disabled, because it can finally distinguish an unread value from an unsourceable one.
- The curation pass gets a schema that can record what a value actually came from, and a documented list of dead ends so it does not re investigate them.
- A seed replacement that invalidates the public worked example fails the build instead of rotting silently.
- The `@2` recompute debt is cleared as a side effect of the `@3` recompute.

**Negative / tradeoffs**:

- The headline becomes a range, which is a weaker sales figure than a single number. The product's own marketing keeps a point figure, so the app and the landing page now present the same model slightly differently, which is a deliberate but real inconsistency.
- Five new columns and a third snapshot schema version add surface to a model that already carries two versions and seven assumptions.
- The disclosure grows longer and more hedged. Some readers will trust the number less, which is the intended effect but still a cost.
- `POSITIONS` grows from four values to six, and every consumer that exhaustively switches on it gains two branches.
- None of this makes the peer data better. The values stay thin until the curation pass replaces them, and two KPIs will never have Swiss peer data at all.

**Neutral**:

- The arithmetic is untouched, so a company's computed `costChf` does not move because of this spec. It moves only when the seed values are replaced.
- `source_note` keeps its existing meaning and content; `basis` is the column whose content is actually shown.
- Row 25 of the scope loses its seller and MWST half to a new row, so this spec governs the data and model work only.

## Follow-up

- [ ] Add a `Design it (spec)` box to scope row 25 pointing at this spec. The row currently has only a `Build it` box and says the work needs no design, which this spec contradicts.
- [ ] Split the seller facts and MWST registration out of row 25 into their own row, as decided. They share nothing with the peer data but a checklist line, and they block the first sale rather than the launch.
- [ ] The curation pass itself: replace the twenty two peer rows and the four readable assumptions from the published tables. Unblocked by this spec, owner signed off, not in this build plan.
- [ ] Decide whether the eleven single point sections should keep a sector comparison at all once real data is read, or whether a section with only one Suva class should show no peer comparison. This spec keeps the comparison and labels it honestly; the curation pass may show that some sections deserve neither.
- [ ] The deferred `/admin/benchmarks` read only view (scope, from specs 0008 and 0014) stays deferred. Curation runs through the CSVs and the pull request diff for now.
- [ ] Watch the recompute after deploy rather than firing and forgetting, per the spec 0012 note that is still outstanding.
