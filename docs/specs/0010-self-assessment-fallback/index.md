# 0010. Self assessment fallback: client entered KPIs

**Date**: 2026-09-06
**Status**: Accepted

## Summary

When the research pipeline finds little or nothing, or found a wrong number, the client types the same eight safety KPIs by hand in a "Your figures" card under the KPI table on the dashboard. Every hand entered value belongs to one reporting year chosen once for the whole form (a year picker that defaults to the newest year already on file), a value the client clears is simply deleted so the research value for that year shows again, and every save or clear queues the existing benchmark task so the peer comparison and the CHF estimate update within a minute. Nothing changes in the database schema: the `company_kpis` table, its policies and the `company_kpi_current` view (the query that prefers a client row over a research row for the same year) already support this, so the work is a form, two server actions, a badge in the table and tests.

## Requirements

**User stories**:
- As a client whose research came back empty, I want to enter our safety figures for one reporting year so that the benchmark and the CHF estimate are computed from real numbers.
- As a client who spots a wrong research value, I want to overwrite that one number for that year so that the dashboard and the benchmark use my figure.
- As a client who entered a figure by mistake, I want to clear it so that the research value (or "not found") is back and the benchmark recomputes.
- As a client, I want to see at a glance which numbers came from research and which I entered so that I trust the benchmark I quote.
- As an expert or ops user, I want a client's figures marked as such in the data so that a client entered number is never mistaken for a sourced one.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: `/app` renders a "Your figures" section (`<section aria-labelledby="self-assessment-heading" data-self-assessment>`) whenever the organization has a company, in every run state (no run yet, queued, running, succeeded, empty, failed). Its position is one absolute rule: immediately after the KPI table section when the latest run finished (`succeeded` or `empty`), else immediately after the alert block (the failed alert), else immediately after the progress section; always before the rerun form and the source list. It holds one `Card` with the year picker of AC-2, one field per active `kpi_definitions` row in `sort_order` (AC-3), a "Save and recalculate" button and the per field clear buttons of AC-7. The strings live in a `selfAssessment` namespace in both catalogs, the namespace is added to the page's `clientMessages` list, and the page passes axe with the section present.
- **AC-2**: The year picker is a `Select` listing one contiguous run of years, newest first, from the current calendar year (the `Europe/Zurich` year of the server clock, computed by a pure `currentYear(now)`) down to the smaller of the current year minus four and the oldest `period_year` on file for the company, never below 2000 and never above the current year (so in September 2026 with rows for 2023 and 2024 the list is 2026, 2025, 2024, 2023, 2022). The default is the newest `period_year` in `company_kpi_current` for the company, else the current year minus one. Both rules are pure functions `yearOptions({ yearsOnFile, currentYear })` and `defaultYear({ yearsOnFile, currentYear })` in `src/features/self-assessment/years.ts` with a Vitest table (no rows, a row older than four years, a row in the current year, `currentYear` across the New Year boundary).
- **AC-3**: The field kind follows the research catalogue `format`: `decimal2` and `percent1` are text inputs with `inputMode="decimal"` that accept `.` or `,` as the decimal separator and at most two decimals (a percent is typed as the plain percentage, `4.2` for 4.2 percent, exactly as research stores it); `integer` is a text input with `inputMode="numeric"` accepting whole numbers only; `yesNo` is a `Select` with "not set", "yes" (stored `1`) and "no" (stored `0`). The label is `kpi_definitions.name` in the reader's language, the description sits under the label, the unit (`kpi_definitions.unit`) sits beside the input. The initial value of a field is the `company_kpi_current` row for (KPI, chosen year): the client value when one exists, else the research value, else empty; a caption under the field reads "Your figure", "From research" or "Not on file" from `row.source`. Changing the year refills every field from the rows the form received (AC-10), with no round trip; unsaved edits for the previous year are dropped.
- **AC-4**: `clientKpisFormSchema(currentYear)` in `src/features/self-assessment/schema.ts` is a factory (so tests pin the year) returning `z.object({ companyId: z.uuid(), periodYear, values, locale: z.string().optional() })` where `periodYear` is an integer from 2000 to `currentYear` (else the issue `yearInvalid`) and `values` is `z.object` built from `KPI_KEYS` with one key aware field per KPI, `kpiValueField(KPI_CATALOGUE[key])`, so every issue lands on the path `['values', key]` and `zodResolver` attaches it to the form field `values.<key>`. Each field accepts `string | number | null | undefined`: an empty string, whitespace or `null` becomes `undefined` (never sent, so blanking a prefilled field is a no op with no message); a comma is normalised to a dot; the parsed number must have at most two decimals, be an integer for `integer` KPIs, be `0` or `1` for `yesNo` KPIs, and satisfy `inRange(key, value)` from `src/features/research/catalogue.ts`, else the issue `valueInvalid`. A top level refine fires `nothingToSave` on `periodYear` when every value is `undefined`. The output type of the schema types the form. The browser sends only the fields the client changed (`react-hook-form` `dirtyFields` against the prefilled values), so an untouched research value is never copied into a client row. Every message key exists in both catalogs under `selfAssessment.validation`.
- **AC-5**: `saveClientKpis(previous, input)` in `src/features/self-assessment/actions.ts` returns `{ ok: true, data: { companyId, periodYear, saved: KpiKey[], benchmarkQueued } }` or `{ ok: false, error: 'validation' | 'forbidden' | 'not_found' | 'conflict' | 'unexpected' }` and never throws for an expected failure. It requires the `client` role with an organization claim (else `forbidden`), parses with AC-4 (else `validation`), confirms the company belongs to the organization and is not archived with a `select id` (else `not_found`), then writes in two steps because the client unique index is partial and PostgREST cannot upsert onto it: it reads the existing client rows (`id`, `kpi_key`) for (company, year, the sent keys), updates each one's `value` by `id` with `.select('id, updated_at')`, and inserts the rest in one statement, also with `.select('id, updated_at')`, carrying `source 'client'`, `organization_id` from the claim, `company_id`, `kpi_key`, `period_year`, `value`, `created_by` the caller's `sub`, `confidence null`, `sources []`, `research_run_id null`, `note null`. An update that returns zero rows (the row exists but was created by another user, which the members update policy rejects) answers `forbidden` and stops before the insert; a `23505` on the insert (a second tab saved the same KPI and year in between) answers `conflict`. It then triggers `benchmark-company` with `{ companyId, triggerKind: 'client_edit' }` under the key `benchmark/kpis/<companyId>/<the maximum updated_at across every row the updates and the insert returned>` with a 1 hour `idempotencyKeyTTL`; `benchmarkQueued` is `false` when `TRIGGER_SECRET_KEY` is unset or the trigger throws (logged, sent to Sentry, the save still answers `ok`). It logs `client kpis saved` with `organizationId`, `companyId`, `periodYear`, `keys` and `benchmarkQueued`.
- **AC-6**: `clearClientKpi(previous, input)` in the same file parses `{ companyId: uuid, kpiKey: KpiKey, periodYear: integer, locale? }`, requires the `client` role, deletes the one row `where company_id = $1 and kpi_key = $2 and period_year = $3 and source = 'client'` through the members delete policy with `.select('id')`, answers `not_found` when zero rows were deleted, and triggers the benchmark under `benchmark/kpis-clear/<deleted row id>` with the same payload and TTL as AC-5. Result `{ companyId, kpiKey, periodYear, benchmarkQueued }`. After a clear, `company_kpi_current` returns the research row for that year when one exists, else nothing, without any further code: the view's ordering does it.
- **AC-7**: The form (`src/features/self-assessment/ui/kpi-form.tsx`, browser) follows the facts form pattern: `useActionState` over `saveClientKpis`, `react-hook-form` with `zodResolver` and `zodLocaleError`, a pending label on the submit, and on `ok` a success line ("Saved. We are recalculating your benchmark." or the not queued variant) plus `router.refresh()`. `conflict` shows "Someone saved these figures at the same time. Reload the page and try again."; `forbidden`, `not_found` and `unexpected` map to `selfAssessment.errors.*`. Blanking a prefilled field is a no op (AC-4); the clear button is the only way to remove a client value. A clear button (accessible name "Clear {kpi}") appears beside a field only when a client row exists for that KPI and the chosen year; it calls `clearClientKpi` through its own `useActionState`, refreshes on success and shows the same error mapping. When the chosen year is older than the newest `period_year` on file for at least one KPI, one hint line above the submit lists those KPIs: "The benchmark uses the newest year on file per KPI. For {kpis} the value from {year} still applies." computed by the pure `newerYearsThan(rows, year)` in `years.ts`.
- **AC-8**: In the KPI table a cell renders the "Your figure" badge (`Badge` variant `secondary`, `data-source="client"`, string `research.table.clientValue`) when its row has `source = 'client'`, else the confidence badge when `confidence` is not null; a client row shows no "not verified" mark (its `validation` is `passed` because it has no run) and no sources popover (its `sources` is empty). Client rows count in the coverage line and enter the three newest years exactly like research rows (`newestYears` is unchanged). The "How this is calculated" disclosure keeps listing the source kind per input (spec 0008 AC-10, no change), which is where the benchmark side of "which values came from the client" is shown.
- **AC-9**: A save or a clear leads to a new `benchmark_snapshots` row with `trigger_kind` `client_edit` computed by the unchanged `benchmark-company` task from the highest `period_year` row per KPI in `company_kpi_current` (the client row wins for its year, confidence `1` for a client row, spec 0008 AC-4 and AC-18). The Realtime channel on `benchmark_snapshots` in `run-progress.tsx` refreshes the page when the row lands; that component renders whenever the latest run exists, and a company always has a run because `requestResearch` inserts the company and its first run together, so the segment shows the new numbers without a reload in every state the form appears in. While the first snapshot computes after an `empty` run, AC-13 makes the segment show `calculating` and keeps the poll running. No email is sent (the benchmark ready email fires only on the first snapshot per company). Saving while a research run is queued or running is allowed: research rows and client rows sit under different unique indexes, and the two benchmark computations each write their own immutable snapshot.
- **AC-10**: `getCompanyDashboard` additionally returns `kpiRows`: every `company_kpi_current` row of the company narrowed to `readonly { id: string; kpiKey: KpiKey; periodYear: number; value: number; source: 'research' | 'client'; updatedAt: string }[]` (the view's columns are all nullable in the generated types: a row whose `id`, `kpi_key`, `period_year`, `value`, `source` or `updated_at` is null, or whose key fails `isKpiKey`, is dropped), ordered by `kpi_key`, `period_year` desc, read from the same query that already loads the current rows; and `clientKpiUpdatedAt`, the maximum `updatedAt` among the rows with `source = 'client'`, `null` when there is none. The page passes `kpiRows`, the catalogue rows, the company id and `currentYear(new Date())` to the form.
- **AC-11**: Tests. Vitest: a table over `clientKpisFormSchema` (comma decimal, three decimals rejected, integer KPI with a decimal rejected, `yesNo` with `2` rejected, one out of range value per KPI, all empty gives `nothingToSave`, year bounds), the `years.ts` functions (AC-2) and `newerYearsThan`, the form component (captions per source, refill on a year change, clear button visibility, the hint, only dirty fields sent), the table badge, and the two actions with a mocked Supabase client (forbidden for an expert claim, `not_found` for a foreign company, the update and insert split, `23505` to `conflict`, `benchmarkQueued` false without the key). pgTAP: `company_kpis.test.sql` already proves member insert, update and delete of their own client rows, the unique client row per year, the view preference, tenant isolation and that a member cannot update or delete a research row; add one assertion that a member's update of a client row created by another member of the same organization affects zero rows (the `forbidden` path of AC-5). Playwright `e2e/self-assessment.spec.ts`: a confirmed client with a company, a `succeeded` run and research rows seeded through a new `seedCompanyKpi` helper beside the account helpers in `e2e/db.ts` (service client, `source 'research'`) opens `/app`, sees the form defaulting to the newest year on file with the research values prefilled, enters a figure, sees "Your figure" in the table for that year, clears it and sees the research value again; with `TRIGGER_DEV_RUNNING=1` it also waits for the `client_edit` snapshot; axe runs on the dashboard with the form present. Every language string is asserted through the catalogs, not hard coded.
- **AC-12**: `docs/benchmark.md` gets a "Client figures" section: the year rule, the view preference, clearing as a delete, the two idempotency keys, the partial index write path, and the feature 22 policy note of the Follow-up. `docs/research.md` gets one line pointing there from the KPI table description.
- **AC-13**: `benchmarkStateOf` in `src/features/benchmark/queries.ts` takes a third moment, `clientKpiUpdatedAt` (AC-10), beside the run's `finished_at` and the company's `updated_at`: with no snapshot yet, a client save within `BENCHMARK_WAIT_MS` yields `calculating` (the segment renders its calculating state and the poll in `run-progress.tsx` runs) instead of `unavailable`. With a snapshot the state stays `ready` and the previous snapshot stays visible until the new one lands, as after a facts edit. After a clear the deleted row carries no moment; the form's success line and the Realtime refresh cover that case. The Vitest table for `benchmarkStateOf` gains the new moment.

## Decision

**Chosen option**: Option 1: One card, one year, plain rows

A "Your figures" card under the KPI table with a form level year picker writes ordinary `company_kpis` rows with `source = 'client'`, clearing deletes the row, and every write queues the existing benchmark task under a `client_edit` trigger; no schema change.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

## Feature design

**Data model sketch** (no migration; every table exists):

| Entity | Kind | What this feature does with it | Keys and rules |
|---|---|---|---|
| `company_kpis` | T, exists | Client rows: `source` `client`, `research_run_id` null, `confidence` null, `sources` `[]`, `note` null, `created_by` the signed in user, `period_year` from the picker, `value` inside the catalogue range | Unique `(company_id, kpi_key, period_year) where source = 'client'` (partial: no PostgREST upsert, see AC-5); members insert, update and delete their own client rows; the identity trigger and the audit trigger record every change |
| `company_kpi_current` | view, exists | Unchanged: per (company, KPI, year) the client row first, then the newest research row, so a clear falls back to research by itself | Read through the members select policy |
| `benchmark_snapshots` | T, exists | New rows with `trigger_kind` `client_edit` after each save or clear | Written only by the task |
| `companies` | T, exists | Read for the ownership check (`id`, `organization_id`, `archived_at`) | |
| `kpi_definitions` | G, exists | Labels, descriptions, units and the field order | `sort_order`, `is_active` |

**State transitions**: none; a client row exists or does not.

**API surface** (server actions, client member only):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `saveClientKpis` | server action | `companyId: uuid` (req), `periodYear: int` (req), `values: Partial<Record<KpiKey, string \| number \| null>>` (req, at least one defined), `locale` (opt) | `companyId`, `periodYear`, `saved: KpiKey[]`, `benchmarkQueued` | signed in `client` role with an organization claim | `validation`, `forbidden`, `not_found` (company not in the organization or archived), `conflict` (concurrent insert, `23505`), `unexpected` |
| `clearClientKpi` | server action | `companyId: uuid` (req), `kpiKey: KpiKey` (req), `periodYear: int` (req), `locale` (opt) | `companyId`, `kpiKey`, `periodYear`, `benchmarkQueued` | same | `validation`, `forbidden`, `not_found` (no client row), `unexpected` |
| `getCompanyDashboard` | server query | `organizationId` | adds `kpiRows` | server component | throws |
| `benchmark-company` | Trigger.dev task, exists | `{ companyId, triggerKind: 'client_edit' }` | one snapshot | service role inside the task | retries three times, `benchmark.failed` alert on the last failure (spec 0008) |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| page | the current calendar year | `currentYear(new Date())`, the `Europe/Zurich` year of the server clock |
| page | the rows the form prefills from | `company_kpi_current` for the company (`kpiRows`, AC-10), the client row already first per year by the view order |
| form | the years offered | `yearOptions({ yearsOnFile, currentYear })`, the contiguous rule of AC-2 over the distinct `period_year` values of `kpiRows` |
| form | the default year | `defaultYear`: newest `period_year` in `kpiRows`, else the current year minus one |
| page | `clientKpiUpdatedAt` for the benchmark state | the maximum `updatedAt` among `kpiRows` with `source = 'client'` (AC-10), fed to `benchmarkStateOf` (AC-13) |
| form | a field's initial value | the `kpiRows` entry for (key, chosen year) |
| form | the caption under a field | that entry's `source` (`client` gives "Your figure", `research` gives "From research"), no entry gives "Not on file" |
| form | the field kind and the range | `KPI_CATALOGUE[key].format` and `.range` in `src/features/research/catalogue.ts` |
| form | the label, description and unit | `kpi_definitions.name`, `.description` (localized with `localizedText`) and `.unit` |
| form | the clear button visibility | an entry with `source = 'client'` exists for (key, chosen year) |
| form | the older year hint | `newerYearsThan(kpiRows, chosenYear)`: keys whose newest `period_year` on file is greater than the chosen year |
| form | which fields are sent | `react-hook-form` `dirtyFields` against the prefilled values |
| save | `organization_id` | `organizationIdFromClaims(claims)` |
| save | `created_by` | `claims.sub` |
| save | the stored number | the schema's normalised value (comma to dot, `yesNo` to `1` or `0`) |
| save | `confidence` | `null` on the row; the task applies `1` to a client row at compute time (spec 0008 AC-18) |
| save | rows to update versus insert | a select of existing client rows for (company, year, sent keys) |
| save | `forbidden` on an update | zero rows returned by an update (the members update policy requires `created_by = auth.uid()`) |
| save | the idempotency key | `benchmark/kpis/<companyId>/<max updated_at across the rows returned by the updates and the insert>` |
| clear | the row | (`company_id`, `kpi_key`, `period_year`, `source = 'client'`) |
| clear | the idempotency key | `benchmark/kpis-clear/<deleted row id>` |
| table | the "Your figure" badge | `company_kpi_current.source` on the cell's row |
| benchmark | every number | unchanged, spec 0008 (the highest year per KPI, client wins per year) |

**Key invariants**:
- A client row never carries `research_run_id`, `sources` or a `confidence`; a research row is never written or deleted by the app.
- At most one client row per company, KPI and year (the partial unique index); the action never bypasses it, a race answers `conflict`.
- Every save or clear that touches a row queues exactly one benchmark computation per distinct write moment (the idempotency keys), and the benchmark reads only stored rows.
- The view, not the app, decides which row is current; the app never computes "current" itself.
- Only fields the client changed reach the server; a research value is never silently re stored as a client value.

**Security model**:
- Members of the organization (role `client`) read, insert, update and delete client rows of their own company through the existing policies; the action re checks the role and the claim (authorization lives in the action, not only in the proxy) and the company ownership.
- Update and delete policies also require `created_by = auth.uid()`; with one member per organization this is invisible, feature 22 owes the relaxation (Follow-up).
- Assigned experts read, ops have full access (existing policies); neither sees `/app`, and an expert or ops claim calling either action gets `forbidden`.
- KPI figures are company data, not personal data; the audit trigger on `company_kpis` records every client write and delete. No new compliance scope.

**Configuration required**: none. `TRIGGER_SECRET_KEY` is already required for the benchmark trigger; without it the save still succeeds and reports `benchmarkQueued` false.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: research found five KPIs for 2024; the client opens `/app`, the form defaults to 2024 with those values prefilled, types the missing LTIFR, saves, the table shows "Your figure" for LTIFR 2024 and a `client_edit` snapshot arrives with six KPIs compared, verifies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-8**, **AC-9**
- Correction and clear: the client overwrites the 2024 accident rate, the table shows the new value with the badge and the research badge is gone; clearing it brings the research value and its confidence badge back and queues another snapshot, verifies **AC-6**, **AC-7**, **AC-8**
- Older year: the client picks 2023 while 2024 is on file, the hint lists the KPIs with a 2024 value, the save stores 2023 rows and the next snapshot still uses the 2024 values, verifies **AC-2**, **AC-7**, **AC-9**
- Failure case: two tabs insert the same KPI and year; the second answers `conflict` and the form asks for a reload; an update of a client row created by another member returns zero rows and answers `forbidden`; a save with `TRIGGER_SECRET_KEY` unset answers `ok` with `benchmarkQueued` false and the not queued message, verifies **AC-5**, **AC-7**
- Empty run: research came back `empty`, so no snapshot exists; the client saves three figures, the segment shows `calculating` and the poll runs until the first `client_edit` snapshot lands through Realtime, verifies **AC-9**, **AC-13**
- Validation: `2,5` is accepted for LTIFR, `2.555` and `250` are rejected, `1.5` is rejected for fatalities, an all empty form gives `nothingToSave`, verifies **AC-4**
- Auth/permission: an expert claim calling `saveClientKpis` gets `forbidden`; a member of organization B saving for organization A's company gets `not_found`; a member's delete of a research row affects zero rows, verifies **AC-5**, **AC-6**, **AC-11**

## Build plan

Tracer Bullet: the first slice runs one hand entered value end to end from the form through the action, the row, the task and back to the table and the segment; the next slices thicken the form and the failure rail; the last hardens and documents. No migration in any slice.

1. Thin thread: `src/features/self-assessment/{schema.ts, years.ts, actions.ts, ui/kpi-form.tsx}` with the year picker, the eight text fields (`yesNo` as a plain select is fine here), the save action with the read then write path and the `client_edit` trigger, `kpiRows` on `getCompanyDashboard`, the section on `/app` in every run state, the "Your figure" badge in the KPI table, the third moment in `benchmarkStateOf`, the `selfAssessment` namespace in both catalogs, one manual run proving a new snapshot lands and refreshes the segment, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-5**, **AC-8**, **AC-9**, **AC-10**, **AC-13**, and **AC-3** in part
2. Thicken the form: prefill captions per source, the refill on a year change, the typed field kinds with comma decimals and the `yesNo` select, the clear action with its per field button, the older year hint, the conflict and error states, the not queued message, axe over the section, satisfies **AC-3**, **AC-6**, **AC-7**, completes **AC-1**
3. Harden and document: the Vitest tables and component tests, the action tests with the mocked client, the one pgTAP assertion, the `seedCompanyKpi` helper and `e2e/self-assessment.spec.ts` with axe, the "Client figures" section in `docs/benchmark.md` and the pointer in `docs/research.md`, satisfies **AC-11**, **AC-12**

## Consequences

**Positive**:
- No migration, no new table, no task change: the whole feature is one feature folder, one query field, one badge and strings, and it reuses every guard that already exists (policies, the partial unique index, the audit trigger, the view, the immutable snapshots).
- Clearing is a delete, so the fallback to research is automatic and there is no "cleared" state to teach the benchmark or the table.
- A client row is visible as such everywhere it appears (table badge, disclosure source line, `inputs.kpis[].source` in the snapshot), so an expert can always tell a sourced value from a client one.

**Negative / tradeoffs**:
- The save is not atomic: it is one select, up to eight updates and one insert. A failure midway leaves some values saved; the refresh shows exactly what landed and a retry saves the rest. Accepted for a Beta tier feature over a SQL function (which would need a migration and the `anon` execute revoke).
- A client cannot "confirm" a research value: an untouched field is not sent, so the row keeps its research source and confidence. To adopt a research number as their own they must change it.
- The update and delete policies are per creator, so once feature 22 adds teammates, a colleague can neither edit nor clear another member's figure until the policy is relaxed (Follow-up).
- The dashboard gets longer; a client with a full research result still sees an eight field card below the table.
- Two tabs can race; the loser sees a `conflict` message and must reload.
- Two clears in a row, or a save followed by a clear, produce two snapshots: each clear key is the deleted row id and each save key is a write moment, so only saves inside the same moment collapse. Two snapshots a minute apart are expected behaviour, not a defect; the dashboard reads the newest.

**Neutral**:
- The coverage line keeps its "n of 8 KPIs found" wording and now counts client rows.
- The benchmark segment keeps showing the previous snapshot while the new one computes (as after a facts edit); the success line says it is recalculating and Realtime swaps the numbers in.
- The current year is computed from the server clock in `Europe/Zurich`; a request in the first hour of New Year's Day in UTC still gets the Zurich year.

## Follow-up

- [ ] Feature 22 (client team invitations): relax `company_kpis` update and delete policies for client rows from `created_by = auth.uid()` to organization scope, update `company_kpis.test.sql`, and note it in the feature 22 scope row before that build starts.
- [ ] If a client asks to dismiss a research value without replacing it ("we have no reliable figure"), that is a new decision (a dismissal flag or table, and a benchmark rule), not a variant of clearing.
- [ ] Feature 15 (analytics): capture `kpi.client_saved` and `kpi.client_cleared` with the KPI key and the year once the event taxonomy exists.
- [ ] `/sync` records `src/features/self-assessment/` and the `selfAssessment` namespace in `AGENTS.md` after the merge.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
