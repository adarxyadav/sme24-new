# Review, feat/derived-injury-counts, 2026-09-08

**Reviewed by**: Claude Opus 5 (fresh model, did not write the code)
**Scope**: feature 27 only (derived injury counts, spec 0012), the 11 commits `24cb9cd~1..affaef7`; the migration and schema file, `model.ts` (the `exposureCount` lift, the derived block, the assumption disclosure), `snapshot.ts` (`SNAPSHOT_SCHEMAS`, `parseSnapshotBlocks`), `catalogue.ts` (`MODEL_VERSION`), the `benchmark-company` task, `benchmark-segment.tsx`, both message catalogs, and the Vitest, pgTAP and Playwright suites
**Verdict**: Approve (one major raised and, after checking it against the spec, withdrawn; two minors fixed)

## Summary

Feature 27 adds a display only `derived` block to the benchmark snapshot: an expected yearly lost time injury count and recordable injury count, computed by the pure model from the same exposure helper the CHF cost line uses, marked with a "Calculated" badge and a provenance line naming the input rate and its year. The shape of the change is right. The exposure arithmetic is lifted out of `costAt` into one exported `exposureCount(shape, rate, fte, hoursPerFte)` dispatching on rate shape rather than the cost model's two-arm incident union, so TRIFR gets an arm without distorting the cost path; `costAt` delegates only its `incidents` line and its numbers are unchanged. The version bump is handled the way the benchmark rule requires — `MODEL_VERSION` moves to `benchmark-model@2`, `SNAPSHOT_SCHEMAS` keeps `@1` and `@2` under literal keys, and no stored row is rewritten. The database change is the minimum the spec allows: one nullable `derived jsonb` column on a table only the service role writes, no `kpi_definitions` rows and no new `company_kpis.source` value.

Verified green at review time: Vitest 1262 across 121 files, pgTAP 466 with the `derived` column confirmed present after a `db:reset`, `pnpm typecheck` and `pnpm lint` (476 files) clean, tree clean, nothing pushed.

## Major, raised then withdrawn

### 🔴→⚪ The derived block and the cost line prefer different lost time rates, `src/features/benchmark/model.ts:424`

**What was raised**: the cost line picks the Suva accident rate before LTIFR (`incidentInput = accidentRate ?? ltifr`), while the derived block picks LTIFR before the Suva rate (`lostTimeInput = ltifr ?? accidentRate`). A company carrying both — the seeded fixture, and the ordinary research outcome — therefore has a displayed count of 1.8 lost time injuries a year sitting on the same card as a CHF headline priced off 28.56 incidents, with the exposure formula published in the assumption disclosure. The proposed fix was a one line alignment of the derived precedence to `cost.incidentKpi`.

**Why it is withdrawn**: the spec anticipated this exact change and rejected it in writing, and the reviewer had not read the rationale before raising it. `docs/specs/0012-derived-injury-counts/rationale.md:74` answers the narrower "read the lost time count straight from `cost.incidents`" variant on two grounds, the second of which is precisely this one:

> `cost.incidentKpi` is chosen by the cost model's own precedence (the Suva rate before LTIFR), which need not be the rate the derived block should name to the reader. The apparent duplication of `count`, `fte` and `hoursPerFte` is what keeps the derived block a self contained statement, and AC-9 plus its test are what keep it honest.

Two further corrections to the finding as raised:

- **AC-9 does not say what the finding assumed.** It requires that the derived counts and `cost.incidents` be "produced by one shared pure function, so they cannot disagree" — a single source of truth for the *formula*, which `exposureCount` satisfies. It does not require the two lines to select the same input rate. `verify.md:28` verifies the differing-rate case as an intended boundary, not as a defect.
- **The card does not show the two numbers side by side.** `cost.incidents` is never rendered; only the CHF headline is. The derived row carries its own inline provenance ("Calculated from the researched LTIFR for 2024"). The disagreement is reconstructible by a reader who does the arithmetic from the disclosure, but it is not the bare "1.8 above 28.56" the finding described.

Applying the fix would have required deleting the AC-9 divergence test, amending `rationale.md` and `verify.md`, and changing the displayed count from 1.8 to 28.6 — overturning a decision the spec reached deliberately, on a reviewer's misreading of one acceptance criterion. The residual question (should the disclosure let a reader derive a conflicting count?) is a product question, not a code defect; it was put to the owner on 2026-09-08 and the answer was to keep the spec as written.

**Outcome**: no code change. Precedence stands as specified.

## Minors, both fixed in `98cd29f`

### 🟡 The `Record<AssumptionKey, number>` cast lies at runtime, `src/features/benchmark/model.ts:296`
**Problem**: `values` is built with `Object.fromEntries` over whatever assumption rows the database returned and cast to `Record<AssumptionKey, number>`. Any key whose row is absent reads back `undefined` while TypeScript still types it `number`, so the `typeof hoursPerFte === "number"` guard in the derived block is load bearing and invisible to the type checker.
**Why it matters**: a future reader trusting the type would be entitled to delete the guard as redundant, reintroducing the `NaN` the guard exists to prevent (AC-16).
**Fix applied**: a comment at the cast naming the lie, marking the guards as load bearing, and pointing at the deferred `costAt` item that has the same hazard unguarded.

### 🟡 `shortKpiName` depends on an unstated catalogue naming convention, `src/features/benchmark/ui/benchmark-segment.tsx:199`
**Problem**: it splits a catalogue name on `" ("` to strip the parenthetical gloss for the provenance sentence, which holds only while a parenthesis in a KPI name opens a gloss and never forms part of the term itself.
**Why it matters**: a future `kpi_definitions` name that breaks the convention is silently truncated mid-sentence in the UI, in either language, with no test to catch it.
**Fix applied**: the assumption is stated on the JSDoc, so a new catalogue name is written against a rule that is written down.

## Nits
- ⚪ `src/features/benchmark/model.ts:425-438`, the derived block reuses the `derivedFrom` closure for both counts but passes the key twice at the lost time call site (`ltifr ? "ltifr" : "accident_rate_per_1000_fte"` alongside the already-selected `lostTimeInput`); a single `{ input, key }` selection would remove the chance of the two drifting. Correct as written and covered by tests.
- ⚪ `docs/specs/0012-derived-injury-counts/index.md:28`, AC-9's wording ("so they cannot disagree") is what led this review to raise the withdrawn major. It means "cannot disagree about the formula"; a reader can take it as "cannot produce different numbers". Worth six words of disambiguation the next time the spec is touched.

## Strengths
- The `exposureCount` lift dispatches on rate **shape**, not on `costAt`'s `incidentKpi` union. That is the detail that lets TRIFR share the formula without widening a cost-model type that has no business knowing about it, and it is what makes AC-9 true in the sense the spec means.
- The version bump is done correctly rather than conveniently: `SNAPSHOT_SCHEMAS` is keyed by literal versions with `@1` retained, and a test proves an `@1` row still parses and renders with no derived block (AC-12). Nothing rewrites history.
- The AC-15 regression is pinned by mechanism, not by effect. The task previously named `snapshotBlocksV1Schema` directly and zod silently stripped the unknown `derived` key before the insert; the new tests assert the write schema is looked up by `MODEL_VERSION` *and* that an unknown version throws rather than writing partial blocks, so the next bump cannot regress the same way.
- The `dd`-internal provenance line (`c835395`) is the right fix for the axe `definition-list` rule rather than the easy one — a wrapper inside a `dl` may hold only `dt` and `dd`, and the fix respects that instead of dropping the list semantics.
- `hours_per_fte` is added to the disclosure whenever a derived count used it, including on the Suva path where the cost line would not have recorded it (AC-11). Easy to miss, and directly tested.

## Test coverage
Strong and matched to the risk. `model.test.ts` covers both counts, each independently missing input (AC-6), the no-headcount and no-rate absence (AC-7), the missing `hours_per_fte` guard (AC-16), the one-decimal boundary (AC-8), the `cost.incidents` equality where the keys agree and the deliberate divergence where they do not (AC-9 and its boundary), and the disclosure assertion (AC-11). `benchmark-company.test.ts` covers the null-derived row and the two AC-15 mechanism tests described above. `snapshot` tests cover the `@1` parse. Playwright asserts the block, both values, the "Calculated" badge, the provenance text and the absence of any confidence badge on a seeded company, with axe. pgTAP confirms the column and the service-role-only write path. No gap worth flagging.
