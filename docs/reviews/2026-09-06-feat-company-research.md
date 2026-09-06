# Review, feat/company-research, 2026-09-06

**Reviewed by**: Claude Sonnet 5 (author on Claude Sonnet 5)
**Scope**: 91 files, feat/company-research vs main (commits `1b56066..HEAD`, spec 0007 only; the stacked transactional-email/English-default commits already merged and reviewed are excluded)
**Verdict**: Approve with nits

## Summary

This is the company lookup and research pipeline (spec 0007): a form on `/app` that kicks off a Trigger.dev task, which drives Parallel's Task API (or a deterministic fixture) to research a company's safety KPIs, validates every value against its citation with a Claude call through the AI Gateway, and lands the result on a live dashboard over Supabase Realtime. The implementation is unusually disciplined: the task keys every read/write by the ids on the loaded run row (never the payload), every terminal write is guarded by the row's current status so the sweep and a slow attempt can never double-alert, the quota and the open-run index live in the database rather than in application code, and the hand-added column grants and RLS policies in the migration match the AGENTS.md pgdelta gotcha exactly. The one real correctness gap is that the AI validator's `sourceIndexes` field — the mechanism by which Claude is supposed to say *which* citations support a value — is validated by the schema and requested in the prompt but never consumed, so every kept value's `sources` array carries every citation for that provider field rather than only the supporting ones. A handful of minors and nits round out an otherwise clean, well-tested slice.

## Major

### 🟠 `sourceIndexes` requested from Claude but never used to filter stored sources, `src/lib/research/resolve.ts:71`
**Problem**: AC-5 says the validator returns `sourceIndexes` (citation indexes into the field's basis) so the stored value's sources are the ones that actually support it. The prompt (`src/lib/ai/prompts/research-validation.ts:40`) asks for it, `researchValidationSchema` (`src/lib/ai/schemas/research-validation.ts:24`) validates it, but `validate.ts`'s `Verdict` map (`src/lib/research/validate.ts:59-65`) never carries the field through, and `resolveValues` (`resolve.ts:71`) always uses `candidate.sources`, i.e. every citation the provider attached to that field, unfiltered.
**Why it matters**: The dashboard's whole trust pitch (AC-7: "every KPI value ... shows where it came from") depends on the sources shown for a value actually supporting that value. Today a kept value can show a citation Claude itself judged irrelevant to it, silently. It won't cause a crash or wrong numbers, but it quietly breaks a promise the spec calls out by name and that a client-facing confidence UI leans on.
**Suggested fix**: Thread `sourceIndexes` through `Verdict`, and in `resolveValues` (or a small helper) filter `candidate.sources` down to the indexes Claude named before storing them, falling back to the full list only when `sourceIndexes` is empty (e.g. a validation-skipped run).

## Minor

### 🟡 Race between the `company_exists` check and the company insert can create two companies per organization, `src/features/research/actions.ts:81-104`
**Problem**: `requestResearch` selects for an existing non-archived company and only inserts a new one if none exists; there is no unique constraint on `companies (organization_id)` (only `(organization_id, uid)` where `uid is not null`, see `supabase/schemas/21_companies.sql:26`). Two concurrent submits (a double click, two tabs) can both pass the check and both insert a company plus a run.
**Why it matters**: `getCompanyDashboard` always picks the earliest company by `created_at` (`queries.ts:82-93`), so the second company/run pair becomes permanently invisible in the UI even though it was billed against the daily quota and may have started a real (paid, in production) research run. The spec does note "one company per organization in this feature (by the actions, not by the schema)" as a deliberate simplification, but doesn't discuss this double-submit path specifically, unlike the analogous quota overshoot which is explicitly accepted with a stated bound.
**Suggested fix**: Either add a partial unique index on `companies (organization_id) where archived_at is null` (aligning the schema with the stated one-company invariant) or debounce/disable the lookup form submit more defensively; a `select ... for update` inside a transaction is not available through PostgREST, so the index is the simpler fix.

### 🟡 `insertKpis`' per-row retry fallback does up to 24 sequential round trips, `src/trigger/research-company.ts:459-465`
**Problem**: When the bulk insert hits a unique violation (a resumed attempt with some rows already stored), the code falls back to inserting every kept row one at a time in a loop, rather than only the rows not already present.
**Why it matters**: In the worst case (23 of 24 rows already stored) this is 23 extra sequential database round trips inside a task that's already budgeted at up to 20 minutes; not likely to blow the budget, but it's needless latency on every resumed attempt, and it's the kind of thing that will look wasteful in a future performance pass.
**Suggested fix**: Reuse the same `existing` set already computed above the bulk insert (it's already fetched) to also drive the fallback loop, or catch the per-row unique violation as this does but skip rows already known to be in `stored`.

### 🟡 `getCompanyDashboard`'s quota count can diverge from the SQL helper's on a null `error_code`, `src/features/research/queries.ts:159-160`
**Problem**: The TypeScript quota courtesy count uses `.or("error_code.is.null,error_code.neq.trigger_failed")`, which is equivalent to the SQL helper's `error_code is distinct from 'trigger_failed'` — this is correct. However, unlike the SQL helper (`private.research_run_allowed`, which is the actual guard), this query has no test asserting the two produce the same count; a future edit to one and not the other would silently desync the displayed "n of 5 runs left" from what the policy actually enforces.
**Why it matters**: Low risk today (the two expressions are equivalent), but there's no test tying them together, so a future change to only one side would ship a UI that lies about the remaining quota without any test failing.
**Suggested fix**: A Vitest or pgTAP test that seeds the same run set and asserts `loadQuota`'s `used` equals `private.research_run_allowed`'s implied count would catch drift; not urgent given TESTS = configured and the current code is correct, but worth a short note in `docs/research.md` if not added now.

## Nits

- ⚪ `src/trigger/research-company.ts:512-515`: `coverageOf` casts through `as Record<KpiKey, "found" | "not_found">` — `Object.fromEntries` over `KPI_LIST` already guarantees every key is present, so the cast is safe, but a small typed builder (`reduce` into a fully-typed object) would avoid the cast entirely.
- ⚪ `src/lib/research/candidates.ts:57-61`: `sourcesOf` takes only `citation.excerpts[0]`, discarding any additional excerpts a citation might carry; harmless today since Parallel typically returns one excerpt per citation, but worth a one-line comment saying so if intentional.
- ⚪ `src/features/research/schema.ts:33-46`: `websiteField`'s comment says "the browser resolver already transforms the values" — true for the lookup form, but `rerunResearch` is also called by a Vitest-only path and possibly future callers without a browser resolver; the schema still normalises correctly either way, so this is just a slightly stale comment scope, not a bug.
- ⚪ `src/lib/ai/gateway.ts:33`: `structuredOutput`'s `maxRetries` default of 2 is undocumented against AC-5's "when the call still fails after the SDK's retries" — a one-line JSDoc cross-reference to the AC would help a future reader confirm the retry count matches the spec's intent.

## Strengths

- The task's "key everything by the loaded run row's ids, never the payload" discipline (AC-14) is applied consistently and even covered by a dedicated Vitest suite (`tests/trigger/research-company.test.ts`) with a fake client asserting every write is scoped.
- Every terminal write (task, `onFailure`, sweep) uses a status-guarded update and checks the affected row count before alerting, so the race between a slow attempt and the stale sweep genuinely cannot double-fire an alert — and this exact scenario is pgTAP/Vitest tested, not just asserted in a comment.
- The migration's hand-added grants (column grants after the table-level `REVOKE ALL`, the `anon`/`public` execute revoke on the new `private.research_run_allowed`) match the AGENTS.md pgdelta gotcha precisely, and the pgTAP suite (`research_runs.test.sql`) exercises the exact column-grant boundary (can set `trigger_run_id`, cannot touch `summary`, cannot move a `running` row).
- `src/lib/research/candidates.ts`, `resolve.ts`, `catalogue.ts` and `fixture.ts` are pure, well-documented, and independently unit tested, which made the one real gap (`sourceIndexes`) straightforward to trace precisely because everything else is this legible.
- The privacy boundary (AC-13) is enforced by an actual test (`tests/lib/research/privacy.test.ts`) that builds both the Parallel input and the Claude prompt from a run row carrying secrets and asserts none leak — a good pattern other features should copy.

## Test coverage

Strong. 176 new Vitest tests plus pgTAP additions cover: the catalogue/migration key match, the error-code mapping against exact recorded Postgres error shapes, the resolve/validate conflict and drop rules, the fixture provider's three outcomes, the RLS/column-grant boundary and the transition matrix, the payload privacy boundary, and the dashboard UI components. The one gap worth naming: no test exercises `sourceIndexes` end to end (consistent with it not being wired up — see the Major finding above), and no test pins down the `getCompanyDashboard` vs. `private.research_run_allowed` quota-count equivalence (Minor above). Given `TESTS = configured`, both are fair findings rather than "no safety net" noise.
