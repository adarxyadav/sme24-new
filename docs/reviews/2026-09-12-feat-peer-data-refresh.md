# Review, feat/peer-data-refresh, 2026-09-12

**Reviewed by**: claude-opus-5[1m], merged from two independent review passes on the same branch
**Scope**: 33 files, branch vs `main` (merge base `7b4612e`, 11 commits)
**Verdict**: Changes requested

> **Note on this file.** Two reviewers wrote to this path concurrently and the second Write silently replaced the first. This version is a deliberate merge of both passes, reconciled and re-verified rather than either one overwriting the other. Where the two disagreed, the disagreement is resolved in the text below. Two findings from the earlier pass were dropped after checking: the German decimal nit (wrong — see "Checked and dropped") and a duplicate-of-substance report.

## Summary

The branch refreshes the peer seed from UVG-Statistik 2026 and three Eurostat tables, bumps the model to `benchmark-model@4`, adds the `costSkipped` guard that closes the long standing `NaN` path, prices a peer reference of 0 (D1), compares fatalities as a rate (D3) and scales size band rows off the Suva section rows (D4). The engineering is careful and unusually well pinned: `SNAPSHOT_SCHEMAS` grows a literal key rather than renaming one, the task still looks its write schema up by version, `costSkipped` is returned but never stored, the seed retirement delete is generated and tested, and `runbook.test.ts` computes the worked example from the committed CSVs through the real model.

Both passes independently verified the data layer and agreed: all 122 CSV rows hold quartile ordering, `provisional false`, `source_key` and `basis` on every row, empty `sample_size` on every Suva row, no duplicate conflict keys, and band rows scaled by a constant per-section ratio from the same year's section row; the five pgTAP counts (22 / 37 / 22 / 21 / 20) match the CSV exactly; the `not in` retirement delete has no NULL hazard (all four conflict columns are `not null`), is emitted after every upsert, and retires exactly the 22 stale 2022 rows.

Two things stop this being an approval. First, the refresh makes the card's "Saving at the peer median" and a gap's "per year at the median" diverge by CHF 93 000 on the very card the e2e asserts, with wording that does not tell them apart. Second, AC-18 explicitly requires `docs/benchmark.md` to be reconciled with the code, and three of its sentences now state the opposite of what the seed and the pgTAP assert. Everything else is minor.

## Major

### 🟠 Two contradictory "at the median" savings ship on one card with identical wording, `src/features/benchmark/ui/benchmark-segment.tsx:445` and `:540`

**Problem**: The card prints `card.savingMedian` ("Saving at the peer median", `messages/en-CH.json:1794`) from `snapshot.savingMedianChf`, which `reference("median")` computes by moving **both** priced inputs to their peer medians (`model.ts:438-442`). Directly below, `gaps.saving` ("{amount} per year at the median", `:1824`) prints `soloSaving`, which moves **only** that KPI and holds the other at the company's own value (`model.ts:489-502`), under a section description saying the list is "ranked by the saving at the peer median". Before this branch `lost_days_per_incident` had no peer row, so `lostDaysPeer` was always null and the two were identical by construction. Seeding the Eurostat lost days rows (AC-25) breaks that identity for every company whose lost days differ from its sector's. The e2e now asserts both on one page: `e2e/benchmark.spec.ts:107` expects CHF 1 081 000 on the card, `:152` expects CHF 1 174 000 on the one gap.

**Why it matters**: A client with a single gap sees two different francs-per-year figures for what both surfaces call "at the median", ~9 % apart, on one screen. The CFO buyer the marketing rule names is reading for exactly that number. It is not a rounding artefact and no copy distinguishes the two references, so the only available reading is that one is wrong.

**On the deferred-decision defence**: the divergence is recorded at `docs/scope/index.md:78` and in the spec's follow-up, which is the right process step, and I considered downgrading on that basis. It does not survive scrutiny: the deferred item defers the **formula** change (a `@5` bump, correctly out of scope here), not the decision to ship two contradictory figures under one label. Labelling them is a copy change that neither pre-empts the owner's formula decision nor needs a model bump, so the contradiction reaching production is not something the deferral actually authorises. It stays Major.

**Suggested fix**: Distinguish the two in copy in both catalogs so they no longer claim to be the same quantity — the card's label saying it moves every priced input to its sector figure, the gap's saying it moves this KPI alone. A one-line change in `benchmark.card.savingMedian` and `benchmark.gaps.saving`. Alternatively adopt the candidate rule already written in the deferred item, which collapses both to the same arithmetic here — but that is the `@5` change and can wait.

### 🟠 Three runbook sentences now state the opposite of the seed and the pgTAP, `docs/benchmark.md:94`, `:99`, `:102`

**Problem**: AC-18 requires the runbook to be reconciled with the code, and the big sections were. Three sentences were not (all three re-read on disk and confirmed):

- `:94` — "Both are null on every row today; filling them is the curation pass, not a code change." All 122 rows now fill `source_key` and both `basis` locales; `benchmarks.test.sql:98` and `seed.test.ts:125` assert exactly that.
- `:99` — "Eleven of the twenty two seeded rows are point rows today, because their NOGA section holds a single Suva class." The seed holds 122 rows, 84 of them point rows. "Eleven of twenty two" survives only as a coincidence of the `accident_rate_per_1000_fte` / band `all` subset, which is not what the sentence says; most point rows are now Eurostat rows, not single Suva classes.
- `:102` — "the pgTAP suites … assert every row is provisional until the launch gate below changes that expectation". The pgTAP now asserts the inverse, `no seeded peer row is provisional` (`benchmarks.test.sql:97`).

**Why it matters**: This is the exact failure mode the branch exists to fix and that `runbook.test.ts` was written to prevent — the amendment's own framing is that the runbook said `@2` while the code wrote `@3` "for a week before anyone noticed". The next curator reads `:94` and concludes the caveat columns are still empty, or reads `:102` and expects a red pgTAP run to be normal. The new test pins the version string, the map keys and the worked example, so these three sentences sit precisely in its blind spot.

**Suggested fix**: Rewrite all three to the current state. Consider extending `runbook.test.ts` with a point-row-count pin computed from the CSV, in the same style as the worked example pin, so `:99` cannot drift on the next seed edit.

## Minor

### 🟡 A `sourced` KPI with no peer row renders "No peer data yet" above the headcount sentence, `src/features/benchmark/ui/benchmark-segment.tsx:754-767`

**Problem**: `fatalities` is now `peerStatus: "sourced"` (`research/catalogue.ts:77`). The no-peer title ladder tests only `no_source` and `pending`, so a `sourced` KPI falls through to `t("positions.noPeer")` — "No peer data yet" / "Noch keine Vergleichsdaten" — and the `fatalityNeedsHeadcount` sentence renders directly beneath it. The client reads: "No peer data yet. The sector rate is per 100 000 employed persons, so the comparison needs your headcount."

**Why it matters**: The two sentences contradict each other and the first is now false — fatality peer rows exist for every section including `ALL`, so with a headcount there is always a peer. AC-23 asks for the headcount sentence "instead of the pending sentence", and the spirit of AC-8 is inverted: the client is told data is missing when only their own headcount is. `tests/features/benchmark/ui/benchmark-segment.test.tsx:678` asserts `b.positions.noPeer` is present, pinning the contradiction rather than catching it.

**Suggested fix**: Give the headcount branch its own title, or suppress the generic title when `data-fatality-needs-headcount` renders. A `sourced` KPI arriving in the no-peer branch is a state the ladder does not name at all, so handle it generally rather than only for fatalities.

### 🟡 The fatality point row narrates a count against a rate, `src/features/benchmark/ui/benchmark-segment.tsx:690-703`

**Problem**: On the point path the visible band label and sector figure are `aria-hidden`, and `positions.srSector` is the whole accessible narration. For fatalities `value` is the stored **count** in integer format (`:639`) while `sector` is now the rate per 100 000 employed persons. A screen reader hears "your value 1 is below average, the sector figure is 0.55 per 100 000 employed persons" as one sentence, reaching the compared line that supplies the conversion only afterwards.

**Why it matters**: The narrated comparison is unit-incoherent, which is what D3's `comparedValue` exists to prevent on the visual surface. The following span does carry the rate, so nothing is missing from the accessible tree and this is not a WCAG failure — but the sighted reader gets the two figures adjacent and in the right order while the screen reader user gets the mismatched pair first. (Distinct from the finding above: that one is the visible contradictory title, this is the sr-only unit mismatch, same row.)

**Suggested fix**: On the fatalities branch, narrate the compared rate rather than the count, or give fatalities their own sr-only sentence naming both the count and the rate it was compared as.

### 🟡 The three new fatality strings render on the point row path but sit outside the quartile wording guard, `tests/features/benchmark/catalogue.test.ts:142`

**Problem**: `POINT_ROW_KEYS` enumerates "the keys `benchmark-segment.tsx` reads on the point path" and asserts none carries quartile wording in either language, deliberately compensating for the component suite only reading English. Fatality peer rows are point rows by AC-26, and the point branch now renders three more keys — `positions.fatalityRate`, `positions.fatalityCompared` (`:711-717`) and `positions.fatalityNeedsHeadcount` (`:764`) — none in the list.

**Why it matters**: The strings are clean today, so nothing fails. But the guard's premise is that a translator could put "Median" or "Viertel" into a German point row string with the rest of the suite staying green; these three are now exactly that hole. `fatalityNeedsHeadcount` is the most exposed, being prose a translator is likely to reword.

**Suggested fix**: Add the three keys to `POINT_ROW_KEYS`.

### 🟡 The positions description attributes every KPI to Suva branches, `messages/en-CH.json:1830`, `messages/de-CH.json:1830`

**Problem**: The new AC-30/C3 copy reads "a spread across the Suva branches of your sector, scaled to your size band where a ratio exists, or one figure where the source publishes only one." It heads a list of eight KPIs, of which only `accident_rate_per_1000_fte` comes from Suva; `lost_days_per_incident` and `fatalities` come from Eurostat, `absenteeism_rate` from BFS.

**Why it matters**: The amendment's thesis is that the frame around the numbers misled more than the numbers did. This frame is more accurate than the one it replaces but attributes three sourced KPIs to the wrong publisher. Mitigated — each row's `basis` names its real source in the disclosure, and the description points there — so this is precision on copy the owner explicitly signed off under C3, not a correctness defect.

**Suggested fix**: Generalise to "the published sector figures" (which the sentence already opens with) and let `basis` carry per-row attribution, or name the three sources. Worth raising with the owner rather than changing unilaterally, since C3 was a recorded copy decision.

### 🟡 Duplicated describe block in the disclosure test, `tests/features/benchmark/ui/calculation-content.test.tsx:253` and `:320`

**Problem**: Confirmed by grep — two blocks named `describe("the compared fatality rate (spec 0016 amendment, AC-23)")` were added in the same commit, one nested inside `describe("CalculationContent (AC-10)")` at `:253` and one at file scope at `:320`. They cover the same three behaviours with different fixtures.

**Why it matters**: Not a correctness problem — both pass — but a maintainer fixing a rendering change has to find and update two copies, and a reader looking for the fatality coverage finds it twice under the same name. It reads as an editing accident rather than a deliberate split.

**Suggested fix**: Keep the file scope block (fuller JSDoc, plus the "no peer row on the default fixture" case) and delete the nested one, or merge the one case the nested block uniquely has.

### 🟡 Stale deferred item now contradicts the shipped catalogue, `docs/scope/index.md:68`

**Problem**: "**Peer rows for fatalities and near misses**: spec 0016 established that no Swiss source publishes either by sector, so both are declared `no_source` …". This branch moves `fatalities` to `sourced` with 22 Eurostat rows (`research/catalogue.ts:77`, asserted in `tests/features/research/catalogue.test.ts:63`). The branch correctly removed the single-class-sections deferred item that D2 closed; this one was missed.

**Why it matters**: The out-of-scope list records what the plan deliberately is not doing; a line claiming a KPI is unsourceable when it now has a full peer row set sends a later reader back to the dead end the amendment exists to close.

**Suggested fix**: Narrow the item to near misses only, which remain genuinely `no_source`.

## Nits

- ⚪ `src/features/marketing/ui/benchmark-card.tsx:18` — the JSDoc says the example is "at UVG section C's p75 of 65.8 against a median of 47.1", but `computeBenchmark` selects the `(C, 50-249)` band row for the 120 FTE example (median 54.6, p75 76.3), which is what produces the CHF 101 000 the card prints; 65.8 is the company's own rate from the `(C, all)` row, and 47.1 is not the median it is measured against. `RATE_SHARE = 75` likewise no longer matches where the value sits in the selected band. Same wording at `tests/features/marketing/benchmark-example.test.ts:23`. The franc figure is correct and pinned; only the prose explaining it is wrong.
- ⚪ `src/features/benchmark/model.ts:412-420` and `:459-469` — `neededAssumptions` and the `usedAssumptionKeys` loop encode the same arm-to-assumption mapping twice, in the same order, with the conditional `hours_per_fte` and `lost_days_per_incident_default` entries duplicated. A single source would make a future arm change a one-place edit.
- ⚪ `src/features/benchmark/model.ts:421-426` — `fte && fte > 0 && incidentInput && incidentKpi` is spelled out twice. A single `const canPrice = …` would make the "missing but otherwise priceable" and "priceable" cases read as the one decision they are, and stop the two drifting apart.
- ⚪ `src/features/benchmark/ui/benchmark-segment.tsx:72` — `formatQuartile` special-cases `fatalities` to `decimal2` inline, while the same literal repeats at three call sites across the two UI files. A named constant beside `FATALITY_RATE_PER` would keep the peer unit's display format in one place.
- ⚪ `docs/benchmark.md:104` — the sentence describing `pnpm test:db` still says the suites "assert every row is provisional until the launch gate below changes that expectation" (closely related to Major 2, `:102`).

## Checked and dropped

- **German decimal separator on `verify.md:44`** (raised in one pass as a nit, dropped after verification). The claim was that `0.55 je 100 000 Erwerbstätige` should use a comma. `node -e "new Intl.NumberFormat('de-CH',{minimumFractionDigits:2}).format(0.55)"` returns `0.55`, and `1234.56` returns `1’234.56` — de-CH uses a **period** as the decimal separator with an apostrophe group separator. The verify note is correct as written and needs no change.

## Strengths

- **The assumption guard is real, not a type-level gesture.** `missingAssumption` (`model.ts:295`) checks `typeof value !== "number" || !Number.isFinite(value)`, catching both the absent row the cast hides and a stored `NaN`/`Infinity`. The `neededAssumptions` list is correctly arm-sensitive: `hours_per_fte` only on the LTIFR arm (and `exposureCount`'s `per_1000_fte` branch genuinely never reads it, so the Suva arm's omission is sound), `lost_days_per_incident_default` only when no KPI row supplies it. `soloSaving` is reachable only when `cost` is non-null, so it inherits the guard. Neither pass could construct an input still yielding `NaN` or `Infinity` in any cost, saving or derived field.
- **Backward compatibility is proven rather than asserted.** `resultV4Schema` extends v3, `SNAPSHOT_SCHEMAS` keeps `@1`–`@3` unrenamed, the reader type marks `comparedValue` optional, both UI files read `result?.comparedValue ?? null`, and `model.test.ts` asserts a stored `@3` row parses under its own key *and* fails under `@4`. The task looks its write schema up by version and never passes `costSkipped` into it, so the new field cannot leak into the database.
- **The retirement delete is correct and its risks were thought through.** All four tuple columns are `not null`, so the `not in` has no three-valued-logic hazard; the delete follows every upsert (pinned by `seed.test.ts` comparing `indexOf` against `lastIndexOf`); the empty-CSV case returns `null` and emits no `delete` (also pinned); it retires exactly the 22 stale 2022 rows. Snapshots keep their own copy of the peer rows they used, so no stored history is invalidated.
- **The pgTAP expectations are exact, not approximate**, and the added referential assertion — that every band row has a section row of the same year to have been scaled from — encodes a D4 invariant the database could not otherwise express.
- **`runbook.test.ts` is a genuinely good test.** Parsing only the gate's own "Expected, and only these" line rather than the whole document, with the stated reason that the multiplier keys appear again in the source table, is the kind of care that stops a test passing for the wrong reason. Computing the worked example through the real model over the committed CSVs, and asserting `not.toContain("confirmed is unreadable")`, turns two classes of documentation rot into build failures — which is what makes the three sentences in Major 2 the notable miss rather than the norm.
- **The e2e spec got more deterministic, not less.** The added `await expect(accidentField).toHaveValue("60")` before `fill("61")` fixes a real hydration race (`keepDirtyValues` merging into "6061") rather than papering it with a timeout. Every changed figure derives from named constants with the arithmetic shown.
- **The two-savings discrepancy was found and escalated by the author**, with a candidate rule and a `@5` bump recorded, rather than quietly patched. Major 1 asks only that the copy stop claiming the two are the same quantity while that decision is pending.

## Test coverage

Coverage is strong and proportionate to the risk. AC-20 gets a case per arm plus a non-finite value and a "default only needed without a KPI row" case, asserting the body still parses under the write schema. D1 inverts the old "peer median of 0" case and adds a p25-of-0 case and a genuine no-peer-row case. D3 covers the conversion helpers directly, a count of 0, a count of 1, `fte` of `null` and `0`, the `kpisCompared` effect and the untouched ranking rule. AC-22 covers a stored `@3` row parsing and failing under `@4` in both directions. The retirement generator is covered through `renderSeedMigration` including ordering and the empty-CSV case.

Gaps, none blocking: `renderBenchmarkRetirement`'s `null` return is asserted only indirectly; the "sourced KPI with no peer row" title path is pinned to its current contradictory output rather than tested for intent; and the three new fatality strings sit outside `POINT_ROW_KEYS` (own Minor above).

## Resolution, 2026-09-12 (author session, after the review)

- Major, the two savings: fixed in copy, both catalogs. `benchmark.card.savingMedian` and `card.savingTop` now end in "all priced figures" and `gaps.saving` in "from this KPI alone"; `gaps.description` ranks by "each KPI's own saving". The formula decision stays with the owner (spec follow up and the deferred scope item both say so).
- Major, the three runbook sentences: rewritten to the current state, and `runbook.test.ts` gained a pin that reads the point row counts (122 rows, 84 point rows, 21 of the 59 accident rate rows) from the committed CSV.
- Minor, the guard: `fatalityRate`, `fatalityCompared` and `fatalityNeedsHeadcount` joined `POINT_ROW_KEYS`.
- Minor, the duplicated describe: the nested block in `calculation-content.test.tsx` is deleted, the file scope one stays. The same duplication existed in `benchmark-segment.test.tsx` (four cases the earlier "the fatality row" block already covered); those four are deleted too.
- Minor, the stale deferred item: narrowed to near misses, with a dated note on why fatalities left it.
- Minor, the fatality narration: the point row's screen reader sentence now carries the compared rate instead of the count, so both figures in it share one unit; the existing test asserts the new sentence.
- Nit, the marketing card prose: the JSDoc and the test comment now name the `50-249` band row the 120 FTE example actually meets, and why 75 is still the bar's share of that band.
- Nit, the German decimal in `verify.md`: not a slip. `de-CH` formats decimals with a point (the Swiss convention, `3.8%` and `0.55` on the German card, captured in the verify pass), so the record stands.
- Nit, the duplicated arm to assumption mapping in `model.ts`: left as is on purpose for this branch; a refactor of the guarded cost path is not a review fix, and the two lists are covered by the per arm tests.
