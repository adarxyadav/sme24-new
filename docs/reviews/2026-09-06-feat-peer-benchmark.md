# Review, feat/peer-benchmark, 2026-09-06

**Reviewed by**: Opus 5 (author on a different model)
**Scope**: 79 files, branch vs main (merge base `409135d`)
**Verdict**: Changes requested

## Summary

This branch builds spec 0008 end to end: three new tables with the full tenant contract on the snapshot table, a seed CSV to migration generator, a pure arithmetic model, the `benchmark-company` task, the dashboard segment, the ready email, the failure alert, a recompute script and a runbook. The engineering is careful and the spec is followed closely: the model is genuinely pure, the snapshot copies every input it used, the grants and pgTAP assertions are the strongest in the repo so far, and 891 Vitest tests pass with typecheck and Biome clean.

Two things should be fixed before merge. The company facts form renders twice on the same page in a state the feature is explicitly built for, which duplicates DOM ids and breaks the project's WCAG 2.2 AA rule. And the benchmark ready email can be permanently lost on a retry, which contradicts the "never lost" claim the task's own JSDoc and AC-5 make, even though the idempotency key that would make it safe is already in place. The rest is minors and nits.

## Major

### 🟠 Two facts forms on one page duplicate every DOM id, `src/features/benchmark/ui/benchmark-segment.tsx:286`

**Problem**: In the `ready` state the disclosure always renders a `FactsForm` (line 140) and `OpportunityCard` renders a second one whenever the cost is `null` (line 286). `FactsForm` hard codes `id="facts-industry"`, `id="facts-employees"`, `id="facts-employees-hint"`, `id="facts-industry-error"` and `id="facts-employees-error"` (`src/features/benchmark/ui/facts-form.tsx:117-167`), so both instances claim the same ids on the same document.

**Why it matters**: A snapshot with `cost: null` is exactly the case AC-11 exists for: no headcount, or no incident rate KPI. So the state is reachable on a normal first run, not an exotic corner. Duplicate ids fail axe (`duplicate-id-active`, `duplicate-id-aria`) and break the label to control association, so a screen reader user gets one label pointing at whichever control the browser resolves first, and clicking a label can focus the wrong form's field. The project rule is WCAG 2.2 AA with axe as the second net, so this is a stated requirement, not a preference. The e2e spec only walks the cost present path (`e2e/benchmark.spec.ts:205`), so axe never sees the two form page.

**Suggested fix**: Give `FactsForm` an id prefix. Either take an optional `idPrefix` prop and derive every id from it, or generate one with React's `useId` and build the ids from that. Then add an axe assertion over the missing input state so the regression cannot come back.

### 🟠 The benchmark ready email is lost, not deferred, when an attempt dies after the insert, `src/trigger/benchmark-company.ts:160`

**Problem**: The task inserts the snapshot, then calls `isFirstSnapshot`, then sends. If the attempt fails anywhere after the insert succeeds, the retry inserts a *second* row, `isFirstSnapshot` returns false, and no email is ever sent. The window is real, not theoretical: `sendBenchmarkReady` throws on the `organization_members` query (line 232), and `isFirstSnapshot` itself throws on a query failure (line 395), both after the insert has already committed.

**Why it matters**: AC-5 states the email "is sent by the attempt that inserted the oldest row, never twice and never lost", and the task's JSDoc repeats it. A transient PostgREST hiccup between the insert and the send silently costs the client their only benchmark ready email, with nothing in the logs saying it was skipped for that reason rather than the ordinary "not first" reason. The retry then looks successful.

**Suggested fix**: The duplicate guard is already the idempotency key `benchmark-ready/<companyId>/<userId>` at global scope with a 30 day TTL (line 241). That key alone makes a second send a no op, so the `isFirstSnapshot` gate does not need to carry the "never twice" job. Send whenever the company had no snapshot *before* this insert (read the count or the oldest row id before inserting), or simply attempt the send on every stored snapshot and let the key dedupe. Either way the retry sends the email that the crashed attempt owed.

## Minor

### 🟡 `benchmarks:recompute` silently stops at the PostgREST row cap, `scripts/benchmarks-recompute.mts:42`

**Problem**: The script selects `company_id` from `benchmark_snapshots` with no `range` and no pagination. `supabase/config.toml:18` sets `max_rows = 1000`, and the hosted default is the same, so PostgREST returns at most 1000 rows with no error and no indication the result was cut.

**Why it matters**: The table holds one row per computation, not per company, so a company that has been recomputed a few times contributes several rows. The cap is reached long before 1000 clients. The script then prints a confident "queued N of N companies" line while quietly skipping everyone past the cut, and the launch gate in `docs/benchmark.md` depends on this script refreshing every client after the owner replaces the provisional seed. A partial refresh that reports success is worse than a failure.

**Suggested fix**: Page with `.range(from, to)` until a short page comes back, or select distinct company ids through an RPC. Print the page count so a truncation is visible.

### 🟡 A missing assumption row fails the task with a Zod path, not a named cause, `src/features/benchmark/model.ts:272`

**Problem**: `values` is built with `Object.fromEntries(...)` and cast to `Record<AssumptionKey, number>`, so a key absent from `benchmark_assumptions` reads back as `undefined`. The arithmetic then produces `NaN` for `costPerCase` and `annual`, and `snapshotBlocksV1Schema.parse` (`src/trigger/benchmark-company.ts:106`) rejects it, because Zod v4's `z.number()` refuses `NaN`.

**Why it matters**: The failure mode is safe (no corrupt snapshot is stored, the task retries and the `benchmark.failed` alert fires), which is why this is a minor rather than a blocker. But the alert reads `cost.annual: Invalid input: expected number, received NaN` instead of "the `hours_per_fte` assumption is missing", so ops get a puzzle rather than an answer. There is no test for an assumptions table missing a key.

**Suggested fix**: Validate the assumption set once where it is loaded, with a message naming the missing keys, and add a Vitest case for it.

### 🟡 The disclosure's assumption rows are read from the live table, not the snapshot, `src/features/benchmark/ui/calculation-content.tsx:36`

**Problem**: `labelOf` looks the label up in the `assumptions` prop, which `getCompanyDashboard` fills from `loadAssumptionRows` (the current table). The values, units, sources and provisional marks all come from the snapshot block, which is right, but the *label* comes from today's row.

**Why it matters**: AC-10 says the disclosure reads "all of it" from the snapshot's blocks, and the spec's critical scenario is explicit: "a changed table value does not change the open snapshot". A renamed or deleted assumption key changes what an old snapshot appears to say, and a deleted key falls back to the raw key string. The numbers stay correct, so the traceability promise mostly holds; it is the wording that drifts.

**Suggested fix**: Either copy the label into the `assumptions` block (a `benchmark-model@2` change, so probably not now) or note the deliberate exception in `docs/benchmark.md` so the next reader does not treat it as a bug.

### 🟡 The assumptions query is a serial round trip after the parallel batch, `src/features/research/queries.ts:97`

**Problem**: `const benchmarkAssumptions = benchmark ? await loadAssumptionRows(supabase) : [];` runs alone, after the `Promise.all` above it has already resolved.

**Why it matters**: It adds one sequential database round trip to every dashboard render that has a snapshot, which is the common case once the feature is live. The table holds seven rows, so it is cheap, but it is latency on the critical path of an authenticated page for no reason.

**Suggested fix**: Fold it into the same `Promise.all` as `loadLatestSnapshot` and discard the result when there is no snapshot, or cache it, since seven global rows change only by migration.

### 🟡 A peer p25 of 0 reports "no reference" rather than the full saving, `src/features/benchmark/model.ts:297`

**Problem**: `reference()` returns `null` when the chosen quartile is 0, so `atTop` and `savingTop` are `null` whenever the peer p25 for the incident KPI is 0.

**Why it matters**: A p25 of 0 is a meaningful, likely value (the safest quarter of a peer group had no recordable incidents), and its correct reading is that reaching the top quarter saves the whole annual cost. The card instead shows "no reference", which understates the opportunity in exactly the situation with the largest one. AC-18 does say `null` "when that peer value is 0", so the code follows the spec as written; the spec rule looks like it was aimed at a missing median.

**Suggested fix**: Confirm the intent with the spec owner. If a zero quartile should price at zero, drop the `=== 0` guard for `p25` and keep it only where a zero would divide.

## Nits

- ⚪ `src/trigger/benchmark-company.ts:182`, `organizationId` falls back to `""` in `onFailure` when the company row is gone, which reaches Sentry tags and the log as an empty string; `null` reads better than an empty id.
- ⚪ `src/features/benchmark/snapshot.ts:56`, `resultSchema.key` is `z.enum(KPI_KEYS)`, so retiring a KPI key later makes every older snapshot unreadable rather than just that entry. Worth a line in the runbook beside the version map.
- ⚪ `src/lib/email/render.ts:41`, the `entry.Component as (props: TemplateProps<unknown>) => ReactElement` cast is well explained but now load bearing for two templates; a discriminated helper keyed by template name would keep the types honest as the registry grows.
- ⚪ `src/features/benchmark/ui/benchmark-segment.tsx:368`, `GapItem` is keyed by `gap.key` in both lists; `gap.rank` is the stabler key since the KPI key is the thing being ranked.
- ⚪ `src/features/benchmark/catalogue.ts:41`, `SectionLetter` is derived as `(typeof NOGA_SECTIONS)[number]["letter"]`, which is just `string` because `letter` is typed `string`; a literal union would let `t(\`noga.sections.${letter}\`)` drop the `as "A"` casts that appear in three files.
- ⚪ `supabase/seed-data/benchmarks.csv:3`, the section rows carry `p25 = median = p75` because only a class mean is published. It is honest and the `provisional` flag says so, but a degenerate band puts every company in `top_quarter` or `bottom_quarter` with nothing in between; worth calling out in the runbook's source checklist.

## Strengths

- The model is genuinely pure and genuinely tested. `computeBenchmark` takes plain data and returns plain data, and `tests/features/benchmark/model.test.ts` walks each AC-4 and AC-18 rule with a worked example: the LTIFR fallback, the ISO share rule, rung 4, `nearest` year, headcount 0, a median of 0, the solo move for lost days, the fatality rank and a tie broken by `sort_order`. This is the part of the feature most likely to be argued with by a client, and it can be argued about in a unit test.
- The grant story on `benchmark_snapshots` is the right one and is proved, not asserted. The write verbs are revoked from the app roles so a member's insert fails on the grant rather than on a policy, the revokes are re added by hand in the migration per the known diff gotcha, and `supabase/tests/benchmark_snapshots.test.sql` checks both organizations, the assigned expert, anon, ops and the audit actor across 20 assertions.
- Immutability is carried through end to end: every peer row and assumption the computation used is copied into the snapshot, the version map decides the reader's schema, and an unreadable row degrades to "absent" with a Sentry warning instead of throwing at a client.
- `queryError` (commit a7f5d2b) is a good catch on the reviewer's own work: supabase-js hands back a plain object, and the previous code would have shown ops "[object Object]" in the failure alert. The fix is small, shared with the research task and covered by a regression test.
- The seed path is honest and deterministic: CSV in, Zod validation with a real line number, upserts keyed on the natural unique key so a rerun is a no op, a timestamp guaranteed later than the newest migration, and every row shipping `provisional` with a launch gate query in the runbook.

## Test coverage

Strong, and unusually so for a feature this size. 891 Vitest tests pass, along with typecheck and Biome. The model, catalogue, seed generator, snapshot version map, dashboard state rule, server action mapping, task (including the email path, the "not first" case and the `onFailure` alert), alert registry, email template and both UI primitives all have suites. pgTAP covers the three tables against AC-15. Playwright drives the whole local thread behind `TRIGGER_DEV_RUNNING=1` with axe on each state.

Three gaps, all named above as findings rather than repeated here: no test renders the segment in the `ready` with `cost: null` state, which is where the duplicate form ids appear and where axe would have caught them; no test covers an assumptions table missing a key; and nothing exercises `benchmarks:recompute` against more than a page of snapshot rows. The retry that loses the email is untestable as written, since the current test asserts the "not first" branch sends nothing, which is the behavior at issue.
