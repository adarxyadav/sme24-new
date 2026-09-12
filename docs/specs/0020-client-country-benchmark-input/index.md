# 0020. Client country as a benchmark input

**Date**: 2026-09-13
**Status**: Proposed

> Build order note (13 Sep 2026): the owner put row 30 (named published peers) before this one. Row 30 reads only `companies.country` as it exists today (default `CH`) and stores its own country per peer row; nothing in it waits for this spec. Spec 0021 takes `benchmark-model@6` and this spec takes `@6` (its text below says so; the `peers` block of 0021 is carried forward unchanged); when this spec is built after row 30, the peer block prices in the snapshot's currency as the contract below says.

## Summary

Today every company on SME24 is Swiss: the lookup writes `CH`, the peer benchmark reads only Swiss sector rows and the cost model prices in CHF with Swiss assumptions. This spec makes the country a real input. The client picks it when they look their company up and can correct it on the facts card, every peer row and every assumption row carries a country, the benchmark task loads only that country's rows, and the snapshot records the country and its currency so the card, the email and the gaps all print money in the right currency. Germany is the first country seeded beside Switzerland; a country without rows says "no national figure yet" and never borrows a Swiss value. Existing Swiss snapshots are not touched and render exactly as they do now.

Rows 30 (named published peers) and 31 (EU VAT and multi currency) build on the contract in [The country and currency contract](#the-country-and-currency-contract): one country catalogue in code, one currency per country, both stored on the snapshot.

## Requirements

**User stories**:
- As a client, I want to say which country my company is in, so that the benchmark compares me with my own country's figures and prices the gap in my currency.
- As a client in a country SME24 does not cover yet, I want the dashboard to say so plainly, so that I am never measured against a Swiss bar by accident.
- As the owner, I want a repeatable way to add a country (which tables to read, where the rows go, what the gate checks), so that opening the next country is an afternoon of curation rather than a code change.
- As ops, I want the launch gate to list which countries are covered, so that production never promises a benchmark it cannot deliver.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1** (the country catalogue): `src/lib/countries.ts` exports `COUNTRIES`, a readonly list of `{ code, currency }` for the 32 European codes in the [catalogue table](rationale.md#the-country-catalogue) (EU 27 plus `CH`, `LI`, `NO`, `IS`, `GB`), `COUNTRY_CODES` (the codes as a tuple for `z.enum`), `currencyOf(code)`, `isCountryCode(value)` and `countryName(code, locale)` (through `Intl.DisplayNames`, so no message keys per country; the short locale maps to the catalog tag, `de` to `de-CH` and `en` to `en-CH`). A Vitest test pins the count, that every currency is a three letter code, that `BG` maps to `EUR` (the euro since 1 Jan 2026) and `CH` and `LI` to `CHF`. The catalogue is a constant: no `countries` table.
- **AC-2** (the client sets it): `lookupSchema` in `src/features/research/schema.ts` gains `country: z.enum(COUNTRY_CODES).default('CH')`; the lookup form renders it as a required select, the third field after the website, labelled `research.lookup.country`, options built from `COUNTRIES` and labelled with `countryName` in the page locale; `requestResearch` writes the parsed value and the `COUNTRY` constant in `src/features/research/actions.ts` is deleted. The `/app` page passes `coveredCountries` (AC-12) to the form as a prop. The research task keeps sending `country` to the provider (spec 0007 AC-13) and never writes `companies.country`. The provider instructions and the Claude prompt say the industry code is the NACE Rev. 2 division (NOGA in Switzerland, WZ 2008 in Germany, ÖNACE in Austria, all the same at two digits) and ask for `canton` only when the country is `CH` (else the field is "not applicable"). The fixture provider ignores the country and returns the same Swiss facts (NOGA 23.61, 420 employees), so a `DE` fixture company lands in section C and benchmarks against German rows; that is the e2e thread of the build plan.
- **AC-3** (the client corrects it): `companyFactsFormSchema` in `src/features/benchmark/schema.ts` gains `country: z.enum(COUNTRY_CODES)` (required) and drops the `nothingToSave` refine on the two original fields; instead `updateCompanyFacts` loads the company row, works out which of the three fields differ from what is stored, answers `{ ok: false, error: 'nothingToSave' }` when none does, and otherwise writes the changed fields through the existing members update policy and triggers `benchmark-company` under the existing key `benchmark/edit/<companyId>/<updated_at>`, so a country only change is a legitimate save and an unchanged submit never triggers a recompute. Both renderers of the form (`FactsCard` and the missing input card) show the select with the stored `company.country` preselected, which `getCompanyDashboard` adds to its company facts payload together with `coveredCountries`. Until the new snapshot lands the card keeps showing the previous snapshot, whose country label and currency come from that snapshot (AC-7, AC-10), never from the company row, so a Swiss card is never relabelled German before the German numbers exist. The ops company page shows the country name, not the code.
- **AC-4** (the migration, backward compatible): from `supabase/schemas/24_benchmarks.sql`, `25_benchmark_assumptions.sql` and `26_benchmark_snapshots.sql`: `benchmarks.country text not null default 'CH' check (country ~ '^[A-Z]{2}$')`, the unique constraint becomes `(kpi_key, country, industry_section, size_band, period_year)` and an index `(country, kpi_key)` is added; `benchmark_assumptions.country text not null default 'CH' check (country ~ '^[A-Z]{2}$' or country = 'ALL')` and the primary key becomes `(key, country)`; `benchmark_snapshots.country text not null default 'CH' check (country ~ '^[A-Z]{2}$')` and `currency text not null default 'CHF' check (currency ~ '^[A-Z]{3}$')`. Every existing row reads `CH` and `CHF` through the defaults, nothing is rewritten, and an older preview keeps working against the migrated staging (the columns it does not know have defaults; its assumption keys still exist, see AC-5). The generated migration is read by hand for the four things the diff misses (root `AGENTS.md`) and keeps the existing unique constraint name on `benchmarks` when it recreates it, the pgTAP suites assert the new columns and constraints, and `pnpm db:types` is regenerated.
- **AC-5** (assumption keys per country, add then switch, remove later): `ASSUMPTION_KEYS` becomes the seven keys `hours_per_fte`, `direct_cost_per_case`, `cost_per_absence_day`, `lost_days_per_incident_default`, `indirect_multiplier_low`, `indirect_multiplier`, `indirect_multiplier_high`. The two old money keys `direct_cost_per_case_chf` and `cost_per_absence_day_chf` move to a `LEGACY_ASSUMPTION_KEYS` tuple that the `@1` to `@4` schemas in `snapshot.ts` keep in their `key` enum for good (stored rows are immutable and every Swiss snapshot names them), while the `@6` schema uses the seven keys only; the model reads only the seven. `assumptionUsedSchema` at `snapshot.ts:133` is the line that would otherwise blank every existing Swiss card, and the AC-9 regression test proves it does not. The CSV gains a `country` column. The file level rule in `seed-schema.ts` becomes: per country other than `ALL`, exactly one row of each of the four readable keys, the `unit` of the two money keys equal to `currencyOf(country)`; on `ALL`, exactly one row of each multiplier and nothing else, with the `low <= middle <= high` refine applied to the `ALL` rows; a money key on `ALL` or a multiplier on a country is refused with the file and line. For this release the `CH` file also keeps the two legacy keys (their schema entry allows `LEGACY_ASSUMPTION_KEYS` on `CH` only), so a preview built before this change still prices; removing them is a Follow-up after the merge. `renderAssumptionUpsert` in `seed-migration.ts` targets `(key, country)`, and a new `renderAssumptionRetirement` (there is none today; only peers are retired) deletes assumption rows the CSV no longer names, keyed on `(key, country)`. `tests/features/benchmark/seed.test.ts` builds its CSV lines from `ASSUMPTION_KEYS` and asserts every key reaches the SQL, so it changes with the column. The pgTAP assumption test counts nine rows in this release (seven new, two legacy) and seven after the removal.
- **AC-6** (peer selection stays inside the country): `benchmark-company` loads peer rows with `.eq('country', company.country)` and assumptions with `.in('country', [company.country, 'ALL'])`; `computeBenchmark` takes `country` in its company input, resolves an assumption by `(key, country)` first and `(key, 'ALL')` second, and runs the four rungs of spec 0008 unchanged inside that one country. No row of another country ever reaches a snapshot: a Vitest test gives a `DE` company only `CH` peer rows and asserts `kpis_compared` is 0, no position, no `atMedian`, and a country with no assumptions gives the skipped cost of AC-8.
- **AC-7** (the snapshot carries the currency): `MODEL_VERSION` becomes `benchmark-model@6` and `SNAPSHOT_SCHEMAS` gains that literal key beside `@1` to `@5`, which all stay valid. In `@6` only: `inputs` gains `country` and `countryCovered` (true when the country filtered peer query of AC-6 returned at least one row, counted before any rung matching); `cost` gains `currency` and keeps its field names; `gaps[].savingMedianChf` becomes `savingMedian`; each `assumptions[]` entry gains `country`. The task writes the scalar columns `country` (from the company row re read before computing) and `currency` (from `currencyOf(country)`); the five existing scalar money columns (`cost_chf` and the others) and the `SnapshotScalars` names stay as they are and hold the amount in that row's `currency` (a column comment says so; renaming them is a Follow-up sequenced with row 31). The reader in `queries.ts` normalises every version to one `Benchmark` type with `country`, `currency` and `countryCovered` at the top: a `@1` to `@4` row reads the column defaults `CH` and `CHF`, `countryCovered` true, and its `…Chf` block fields map onto the new names, so the UI never branches on the version. As with every earlier bump, a preview built before this release treats a `@6` row as an unknown version (absent, reported to Sentry) until it is rebuilt; that is the known cost of the literal map and is not new. `tests/features/benchmark/runbook.test.ts` pins the version and the map.
- **AC-8** (a skipped cost has a stored reason): in `@6` the `cost` block is `CostBlock | { skipped: { reason: 'no_fte' | 'no_incident_kpi' | 'missing_assumption', key?: AssumptionKey } }`, reusing the existing `missing_assumption` literal of `CostSkipped` in `model.ts`; `costSkipped` stays on `SnapshotBody` as the log source, unchanged. The card renders `missing_assumption` as "No cost model for {country} yet" (`benchmark.cost.noModelForCountry`, both languages) with the positions and gaps still shown; `no_fte` and `no_incident_kpi` render the missing input card as today; a `@1` to `@4` row with `cost` null renders as today. No `NaN` and no Swiss assumption ever fills the gap.
- **AC-9** (money is formatted with the snapshot's currency): the `chf` and `chfWhole` named formats in `src/i18n/formats.ts` stay for the checkout and the marketing pages, and the benchmark stops using them. A new `formatMoney(format, value, currency)` in `src/features/benchmark/ui/format.ts` (which today holds only `formatKpiValue`) calls `format.number(value, { style: 'currency', currency, maximumFractionDigits: 0 })`, exactly those options, and replaces every inline `format.number(x, 'chfWhole')` in `benchmark-segment.tsx` and the gaps and positions; `roundChf` and `roundChfRange` in `model.ts` become `roundMoney` and `roundMoneyRange` with the same thresholds (nearest 100 below 10 000, else nearest 1 000, rounded outward for the range) for every currency. A Vitest test renders the whole benchmark segment for the committed `@4` Swiss fixture snapshot before and after this change and asserts byte identical output (the rendered card, not only the helper); `e2e/benchmark.spec.ts` keeps its CHF assertions unchanged.
- **AC-10** (the country is named, and a missing figure is honest): the positions list and the KPI table say which country's figures the company is compared with ("Compared with Germany's national figures", key `benchmark.positions.comparedWith` with the localised name of the snapshot's country). A KPI with no row for that country shows "No national figure for {country} yet" (`benchmark.positions.peerStatus.pendingCountryTitle`, beside the existing `pendingTitle`) unless the catalogue declares `no_source`, in which case the existing universal note shows. The Swiss specific `peerNote` texts of spec 0016 and the existing `pendingTitle` render only when the country is `CH`. Never a Swiss value, a Swiss note or a Swiss source name on another country's card; a Vitest test over a `DE` snapshot asserts no string from the CH notes appears.
- **AC-11** (the email travels with the currency): `benchmarkReadyDataSchema` in `src/lib/email/schema.ts` gains `currency` (three letters, default `CHF`) and the new optional money fields `cost`, `costLow`, `costHigh` and `savingMedian`, and keeps the old optional `costChf`, `costLowChf`, `costHighChf` and `savingMedianChf` for one release so a payload queued by an older build still parses; the task fills the new fields from the normalised snapshot and `roundMoneyRange`; the template reads the new fields and falls back to the old ones, and formats with the payload currency, never a named format; the registry in `src/lib/email/registry.ts` needs no change beyond the schema; the previews gain a EUR variant per language; the Playwright Mailpit assertion on the Swiss fixture is unchanged. Dropping the old fields is the same Follow-up as the legacy assumption keys.
- **AC-12** (the country select tells the truth): both selects (AC-2, AC-3) group the options into "Benchmark available" and "No national figures yet" (`common.countryGroup.available`, `common.countryGroup.pending`, shared by both forms). The covered list is one query, `select distinct country from public.benchmarks`, read once per request on the server: the `/app` page adds `coveredCountries: string[]` to the data it hands the lookup form, and `getCompanyDashboard` adds the same to the facts payload; the forms are client components and receive it as a prop. A client may still pick an uncovered country.
- **AC-13** (an uncovered country says so): a company whose country has no peer row at all gets a snapshot with `kpis_compared` 0 and `inputs.countryCovered` false; the dashboard `noData` state then reads "No national figures for {country} yet. Your figures are saved and compared as soon as {country} is covered." (`benchmark.state.noDataCountry`) above the facts form, instead of the generic no data text, so the client can see the message is about the country and not about their data.
- **AC-14** (Germany is seeded): `supabase/seed-data/benchmarks.csv` gains `DE` rows, every first row `provisional` until read, as the runbook requires: `accident_rate_per_1000_fte` per NACE section and `ALL` from the DGUV table "Meldepflichtige Arbeitsunfälle je 1.000 Vollarbeiter nach Wirtschaftszweigen" (latest edition), with `source_key` naming the DGUV branch and `basis` saying a reportable accident is one with more than three days of incapacity, so the German bar is not the Swiss bar and the two are never compared; a NACE section with no DGUV branch of its own stays uncovered rather than borrowing the nearest branch; `fatalities` per section from Eurostat `hsw_n2_02` for `DE`; `lost_days_per_incident` per section from `hsw_n2_04` for `DE`, interpolated the way the CH rows are; `1-49`, `50-249` and `250+` rows on the accident rate scaled from the DGUV row by the `hsw_n2_05` `DE` ratios under the same floor (100 accidents and 5 000 employed persons) and the same fold of Eurostat bands, from a ratio table the owner has seen; a suppressed Eurostat cell leaves that row out and is never read as 0. Rows are written in section order A to U with `ALL` last, one block per KPI. `absenteeism_rate`, `ltifr`, `trifr`, `iso_45001_certified` and `near_miss_rate` stay uncovered for `DE` and say so through AC-10. `supabase/seed-data/benchmark-assumptions.csv` gains the four `DE` rows in EUR from the sources named in the [seed plan](rationale.md#the-per-country-seed-plan); a key with no published German source is a declared assumption (`is_assumption`) with its derivation in `note`, and the launch gate's expected list in the runbook names it. Correctness of a value is checkable only against its named source, so the checkable part is the row counts per country in the pgTAP peer suite and the `basis`, `source_key` and `source_url` presence on every row.
- **AC-15** (the Eurostat reads are repeatable by hand): the three `DE` Eurostat reads go through the Eurostat statistics API the way the CH reads of 12 Sep 2026 did (`geo=DE`, the dataset codes above), and the runbook's "Adding a country" section records the exact request per dataset, the interpolation and the fold, so the next country is the same afternoon. A `pnpm benchmarks:eurostat` script that prints the rows and the ratio table is a Follow-up, not part of this build.
- **AC-16** (the launch gate lists coverage): the runbook gains a third gate query listing, per country with at least one peer row, the count of peer rows, the count of provisional peer rows, and whether all seven assumption keys resolve through `(key, country)` or `(key, 'ALL')`; gate one (zero provisional) and gate two (the exact list of declared assumptions, now with country) are updated; the pgTAP suites assert no row is both `provisional` and `is_assumption` per country.
- **AC-17** (nothing moves for Switzerland): no recompute is owed by this deploy: a Vitest test computes the fixture company under `benchmark-model@6` with the seven keys and matches the runbook's worked figure (CHF 1 961 000 rounded); existing `@4` rows stay `@4` and render the same; `pnpm benchmarks:recompute` is not run for this feature and `scripts/benchmarks-recompute.mts` needs no change.
- **AC-18** (the marketing example stays Swiss): the marketing example literal of spec 0016 AC-27 and every public price stay in CHF for a Swiss example company, unchanged by this feature; a German marketing example is a copy decision recorded in Follow-up, not built here.
- **AC-19** (the runbook): `docs/benchmark.md` gains an "Adding a country" section (the catalogue entry, the three Eurostat reads through the script, the national accident rate source, the four assumption rows, the gate) and a coverage table per country and KPI, and its source checklist is split per country.

## Decision

**Chosen option**: Option 2: Country on every row, one country per snapshot, no fallback across countries (see [rationale.md](rationale.md#options-considered)).

The client owns the country (set at lookup, corrected on the facts card); every peer and assumption row carries a country and the benchmark task loads only that country plus the `ALL` multipliers; the snapshot stores the country and its currency and the reader normalises old rows to `CH` and `CHF`, so nothing Swiss changes; Germany is the first country seeded beside Switzerland, and a country without rows says so.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `react-email` (`resend/resend-skills`, `.claude/skills/react-email/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

**Calls made without the owner in the room** (this spec was written in a session that could not ask; each has its runner up in `rationale.md`, override any of them before `/develop`):

1. The client sets the country; the research reads it and never writes it.
2. Germany is the second country; Austria and the rest follow the runbook recipe as curation rows.
3. A country never falls back to another country's rows or to a European aggregate.
4. Assumption keys lose the `_chf` suffix; the three multipliers live once on `ALL`.
5. The snapshot scalar money columns keep their `_chf` names for now, with a `currency` column beside them.
6. A German cost figure with no published source is a declared assumption, named in the gate, rather than a blocked country.
7. The marketing example stays Swiss and CHF.

## The country and currency contract

Rows 30 and 31 depend on this; change it only through `/architect`.

- **One catalogue.** `src/lib/countries.ts` is the only list of countries and the only country to currency map in the codebase. Row 30 adds its geography ladder there (`region` per code, and the rung order) rather than in a second list. Row 31 reads `currencyOf(code)` for the settlement currency and keeps VAT treatment in its own module keyed by the same code; it never introduces a second currency map. A country's currency is a fact of the country, the same for the benchmark and the checkout.
- **Codes.** Country codes are ISO 3166-1 alpha 2, upper case, in `companies.country`, `companies` billing addresses (spec 0011 already uses `billing_country`), `benchmarks.country`, `benchmark_assumptions.country`, `benchmark_snapshots.country`, and on every named peer row row 30 adds. `ALL` is legal only on `benchmark_assumptions`. Currencies are ISO 4217, upper case, three letters, in `benchmark_snapshots.currency` and in the `unit` of a money assumption row.
- **One country and one currency per snapshot**, stored as scalar columns and in the normalised `Benchmark` type. A row 30 peer block prices the client's own saving in the snapshot's currency and never in the peer's country's currency. A row 31 order prices in the company's `currencyOf(country)`, and the benchmark's money and the order's money for one company are always the same currency.
- **Rows never cross a country.** A peer row of country X enters only a snapshot of country X. Row 30's ladder widens the geography for named peers explicitly and says so on the card; the sector statistics never widen.
- **Old rows are Swiss.** Any snapshot without a stored country is `CH` and `CHF`; the column defaults say so and the reader never guesses from the model version.
- **Adding a country is data, not code**: a catalogue entry, peer rows, four assumption rows and a gate run. Code changes only when a country needs a new KPI unit, which is a spec.

## Feature design

**Data model sketch** (no new table; four columns and two constraint swaps):

| Table | Change | Notes |
|---|---|---|
| `companies` (exists) | none | `country text not null default 'CH'` stays; the catalogue enum guards it at the boundary. Written by `requestResearch` (lookup) and `updateCompanyFacts` (facts card), read by the research task and the benchmark task |
| `benchmarks` (exists) | `+ country text not null default 'CH' check (country ~ '^[A-Z]{2}$')`; unique `(kpi_key, country, industry_section, size_band, period_year)`; index `(country, kpi_key)` | The CSV gains the column; the upsert conflict target and the retirement tuple gain it |
| `benchmark_assumptions` (exists) | `+ country text not null default 'CH' check (country ~ '^[A-Z]{2}$' or country = 'ALL')`; primary key `(key, country)` | Money keys never on `ALL`; multipliers only on `ALL` (seed schema, and a pgTAP assertion) |
| `benchmark_snapshots` (exists) | `+ country text not null default 'CH' check (…)`, `+ currency text not null default 'CHF' check (currency ~ '^[A-Z]{3}$')` | Written by the task only; the five `_chf` scalar columns hold the amount in `currency` |

The `@6` snapshot blocks, relative to `@4`: `inputs` + `country: string`, `countryCovered: boolean`; `cost` becomes `CostBlock & { currency: string } | { skipped: { reason, key? } }`; `gaps[].savingMedianChf` renamed `savingMedian`; `assumptions[]` + `country: string`; `results` and `derived` unchanged.

**State transitions**: none new. The dashboard state stays derived (spec 0008); `noData` gains the country wording when `countryCovered` is false.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `requestResearch` (exists) | server action | `name`, `website?`, `country: enum` (new) | company row with the chosen country, queued run | member | `invalid_input` when the code is not in the catalogue |
| `updateCompanyFacts` (exists) | server action | `industryCode?`, `employeesCount?`, `country: enum` (new) | updated company, benchmark triggered | member (own organization) | `invalid_input`, `forbidden` |
| `benchmark-company` (exists, task) | task | `companyId`, `triggerKind`, `researchRunId?` | one `@6` snapshot with `country` and `currency` | service role | as spec 0008 |
| `research-company` (exists, task) | task | `runId` | provider input carries the company's country; `canton` asked only for `CH` | service role | as spec 0007 |
| `getCompanyDashboard` (exists) | server component query | organization | `benchmark` normalised with `country`, `currency`, `countryCovered`; `coveredCountries` for the select | member, assigned expert | as spec 0008 |
| `sendEmail('benchmark_ready')` (exists) | task call | `companyName`, `kpisCompared`, `currency`, `cost?`, `costLow?`, `costHigh?`, `savingMedian?` (the old `…Chf` names kept optional for one release) | one delivery per member | task | logged, never thrown |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| lookup form, facts form | the country options and their labels | `COUNTRIES` (AC-1) and `Intl.DisplayNames` in the page locale |
| lookup form, facts form | which options sit under "Benchmark available" | `coveredCountries`, one `select distinct country from public.benchmarks` on the server, passed as a prop by the `/app` page and by `getCompanyDashboard` (AC-12) |
| facts form | the preselected country | `company.country` in the dashboard's company facts payload (AC-3) |
| `updateCompanyFacts` | whether anything changed | the stored company row compared with the three parsed fields (AC-3) |
| positions, card | the country label while a recompute is pending | the newest snapshot's stored `country`, never the company row (AC-3) |
| `requestResearch` | `companies.country` | the form's `country` field, parsed by `z.enum(COUNTRY_CODES)` (AC-2) |
| `updateCompanyFacts` | the new country and the recompute | the form field; the trigger key `benchmark/edit/<companyId>/<updated_at>` (spec 0008) |
| research task | the industry code family and whether to ask for a canton | `companies.country` (`CH` asks for the canton) |
| task | the peer rows and assumptions in play | `benchmarks where country = company.country`; `benchmark_assumptions where country in (company.country, 'ALL')` (AC-6) |
| task | `benchmark_snapshots.country` | the company row re read right before computing (spec 0008 `companyUpdatedAt` rule) |
| task | `benchmark_snapshots.currency`, `cost.currency` | `currencyOf(country)` (AC-1); the seed guarantees the money assumption `unit` equals it (AC-5) |
| task | `inputs.countryCovered` | the count of rows the country filtered peer query returned, before rung matching, greater than 0 |
| model | an assumption value | `(key, country)`, else `(key, 'ALL')`, else the skipped cost with the key named (AC-8) |
| reader | `country`, `currency`, `countryCovered` for a `@1` to `@4` row | the scalar columns' defaults `CH`, `CHF`, and `true` (AC-7) |
| reader | an old snapshot's assumption keys | `LEGACY_ASSUMPTION_KEYS` kept in the `@1` to `@4` enum for good (AC-5) |
| card, gaps, positions, email | every money string | the normalised `currency` through `formatMoney` and `roundMoney` (AC-9, AC-11) |
| positions, KPI table | the country name in "Compared with …" | `countryName(snapshot.country, locale)` (AC-10) |
| positions | the pending text per KPI | `benchmark.positions.peerStatus.pendingCountryTitle` unless the catalogue says `no_source`; the CH notes and `pendingTitle` only when `country = 'CH'` (AC-10) |
| `noData` card | the uncovered country sentence | `inputs.countryCovered` false and `countryName` (AC-13) |
| DE seed | the Eurostat rows for a country | `hsw_n2_02` (unit `RT_INC`), `hsw_n2_04`, `hsw_n2_05` for `geo=DE` through the Eurostat statistics API, read by hand as for CH (AC-15) |
| DE seed | the German accident rate rows | the DGUV table named in AC-14, read by hand like the Suva table |
| DE seed | the four German assumption rows | the [seed plan](rationale.md#the-per-country-seed-plan), each row naming its source or its derivation |
| launch gate | the covered countries | the third gate query (AC-16) |

**Key invariants**:
- A snapshot holds rows of exactly one country, its own, and the `ALL` multipliers; the task filters, the model does not fall back, a Vitest test proves it (AC-6).
- `benchmark_snapshots.currency = currencyOf(benchmark_snapshots.country)` for every `@6` row; a `@1` to `@4` row is `CH` and `CHF` (AC-7).
- A money assumption's `unit` equals `currencyOf(country)` and a money key never sits on `ALL`; a multiplier sits only on `ALL` (AC-5, seed schema and pgTAP).
- `provisional` and `is_assumption` are never both true, per country (spec 0016, AC-16).
- The Swiss `@4` fixture renders byte identical money strings under the new formatting (AC-9), and the runbook's worked figure still comes out of the model (AC-17).
- `companies.country` is always a catalogue code once written by the app; the column keeps `default 'CH'` for rows written by the seed and the tests.

**Security model**:
- `companies.country` is written by members through the existing update and insert policies; the enum at the boundary is the guard, RLS is unchanged.
- `benchmarks` and `benchmark_assumptions` stay global read for every signed in role and ops write only; the country column does not change who may read a row.
- `benchmark_snapshots` stays written by the service role only; `country` and `currency` are set by the task, never by a client.
- The Eurostat reads are hand run against a public API and write nothing. The DGUV read is a hand read of a public PDF.
- No new personal data: a country is a company fact. The research prompt still carries only the company name, legal name, website, country, catalogue and instructions (spec 0007 AC-13); the Vitest test on the prompt payload is extended to assert the country is a catalogue code.

**Configuration required**: none. No new environment variable; the Eurostat API is public.

**Critical test scenarios**:
- Happy path: a client looks up a company with country `DE` on the fixture provider, the run succeeds, the `@6` snapshot carries `DE` and `EUR`, the card prices in EUR, the positions read "Compared with Germany's national figures", the email's range is in EUR, verifies **AC-2**, **AC-6**, **AC-7**, **AC-9**, **AC-10**, **AC-11** (Playwright, `TRIGGER_DEV_RUNNING=1`).
- Regression: the committed Swiss `@4` fixture renders byte identical strings before and after; the Swiss e2e thread passes untouched; the model reproduces the runbook figure under the new keys, verifies **AC-9**, **AC-17**.
- Isolation: a `DE` company with only `CH` rows in the peer table gets `kpis_compared` 0 and no position; a country with no assumptions gets `cost.skipped.reason = 'missing_assumption'` with the key named, never `NaN`, verifies **AC-6**, **AC-8**.
- Uncovered country: a company in `FR` gets `countryCovered` false and the `noData` card names France, verifies **AC-13**.
- Seed guard: a CSV with a money key on `ALL`, a multiplier on `DE`, or a `DE` money row in CHF is refused with the file and line, verifies **AC-5** (Vitest over `seed-schema.ts`).
- Old payload: a `benchmark_ready` payload without `currency` parses as CHF, verifies **AC-11**.
- Correction: changing the country on the facts card triggers one recompute under the edit key and the next snapshot carries the new country, verifies **AC-3**.
- Database: pgTAP asserts the new columns, the constraint swaps, the per country counts, the `ALL` rules and the two flag rule per country, verifies **AC-4**, **AC-5**, **AC-14**, **AC-16**.

## Migration plan

**Strategy**: feature flagged by data, one deployment, add then switch, remove later.
**Phases**:
1. This release: the four columns with defaults, the two constraint swaps, the seed with `country` on every row, the new assumption keys beside the two old CH money keys, the `@6` model and reader. Old `@4` rows are untouched. A preview built before this release still reads the legacy keys, the old email field names and the old columns and keeps working on the shared staging, except that it treats a `@6` snapshot as an unknown version, as at every earlier bump.
2. After the merge (Follow-up): remove the two legacy money keys from the CSV (they stay in `LEGACY_ASSUMPTION_KEYS` for the old schemas), regenerate the seed migration, set the pgTAP count back to seven, drop the old email field names.
3. Sequenced with row 31 (Follow-up): rename the five `_chf` scalar columns on `benchmark_snapshots` by add, switch, remove.
**Rollback**: revert the commit; the columns stay (harmless defaults) and the old keys still exist in the seed, so the old code prices Switzerland as before. Only the `DE` rows and the new keys would be unused.
**Risks**: the primary key swap on `benchmark_assumptions` must be one `alter table` (drop, add) in the same migration; the diff may drop column grants after the table level `REVOKE ALL` (root `AGENTS.md`), so the migration is read by hand; three worktrees share one local stack, so check the new columns exist after `db:reset` before trusting a green pgTAP run (memory: worktree hazards).

## Build plan

Tracer Bullet: the first slice makes one German company real end to end on the fixture, with the Swiss thread untouched; the later slices thicken the seed, the honesty texts and the gate.

1. The catalogue and the thin thread: `src/lib/countries.ts` with its test; the country select on the lookup form and on both facts form renderers with `Intl.DisplayNames` labels and `coveredCountries` as a prop; the Zod enums; `requestResearch` writes the chosen country and the constant goes; `updateCompanyFacts` compares with the stored row; the research prompt wording and the `CH` only canton; the ops page shows the name, satisfies **AC-1**, **AC-2**, **AC-3**.
2. The migration and the seed shape: the three schema files, the generated migration read by hand, `country` in both CSVs (every existing row `CH`), the seven keys plus `LEGACY_ASSUMPTION_KEYS` in the old snapshot schemas, the per country seed file rule, the `(key, country)` conflict target and the new assumption retirement in `seed-migration.ts`, `seed.test.ts`, the pgTAP updates, `pnpm db:types`, satisfies **AC-4**, **AC-5**.
3. The model and the task: `country` into `computeBenchmark`, the `(key, country)` then `(key, 'ALL')` resolution, the stored skipped cost, `benchmark-model@6` with its schema, the task's country filters and the two scalar columns, the reader's normalisation, the isolation tests, the fixture figure test, satisfies **AC-6**, **AC-7**, **AC-8**, **AC-17**.
4. The surfaces: `formatMoney`, `roundMoney`, `roundMoneyRange`, every money string on the card, gaps and positions through the currency, the "Compared with {country}" line, the per country pending text, the CH only notes, the `noData` country sentence, the grouped select options, the design gallery mirror, the byte identical Swiss render test, the email schema, template and EUR previews, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-13**.
5. Germany: the `DE` fatality and lost days rows read through the Eurostat API by hand with the requests recorded, the DGUV accident rate rows read by hand, the size band ratio table shown to the owner and the scaled rows, the four `DE` assumption rows from the seed plan, the regenerated seed migration, the per country pgTAP counts, satisfies **AC-14**, **AC-15**.
6. The gate and the runbook: the third gate query, the updated gate one and two, the "Adding a country" section with the exact Eurostat requests, the coverage table, the split source checklist, the marketing note, satisfies **AC-16**, **AC-18**, **AC-19**.
7. End to end: the German fixture thread in `e2e/benchmark.spec.ts` (or a sibling spec) through Mailpit with `TRIGGER_DEV_RUNNING=1`, the Swiss thread unchanged, satisfies **AC-2**, **AC-6**, **AC-9**, **AC-11**.

## Consequences

**Positive**:
- Opening a country becomes curation: a catalogue line, rows read by the script and by hand, four assumption rows and a gate run, with no model change.
- Every number a client sees is from their own country or is absent and says so; the "never a Swiss value" rule is enforced by the task's filter and a test, not by care.
- The contract gives rows 30 and 31 one country code and one currency per company, so the named peers' saving column and the order's currency can never disagree with the benchmark.
- Swiss clients notice nothing: same rows, same strings, no recompute.

**Negative / tradeoffs**:
- A German bar and a Swiss bar are not the same bar: DGUV counts accidents with more than three days of incapacity, Suva counts every registered case. `basis` says so on every row, but a reader who compares a German client's card with a Swiss client's card by eye will compare different regimes. The product never does that comparison itself.
- Germany's cost model rests on at least one declared assumption unless the owner finds a published German figure for the absence day cost, so the gate's "exactly these" list grows by name. That is honest, and it is one more claim the product makes without a source.
- Two money keys exist twice for one release (old and new) and five snapshot columns keep a misleading `_chf` name until row 31; both are recorded removals, and until then an ops query summing `cost_chf` across countries is wrong.
- A German client on the `de` locale sees Swiss number formatting (`de-CH` grouping) around a EUR amount. Correct, but foreign; a `de-DE` locale is a localisation decision (spec 0004), not this one.
- Four uncovered KPIs for Germany (absenteeism, LTIFR, TRIFR, ISO 45001) show "No national figure for Germany yet" until row 30 fills the LTIFR and TRIFR rows with named peers.

**Neutral**:
- `benchmark-model@6` is a schema addition, not a formula change, so old rows need no recompute and stay history.
- The `ALL` country on assumptions is a lookup rung, not a fallback across countries: only unitless multipliers may live there.
- `Intl.DisplayNames` gives every country name in both languages for free; the catalogs gain only the group labels, the country sentences and the skipped cost text.
- The size band derivation of spec 0016 D4 (a national row scaled by the Eurostat band ratio) is now the rule for every country, not a Swiss special.

## Follow-up

- [ ] Remove the two legacy `_chf` assumption keys from the CH seed and the old `…Chf` email fields after the merge, regenerate the seed migration, set the pgTAP count back to seven (Migration plan phase 2). `LEGACY_ASSUMPTION_KEYS` stays, because the `@1` to `@4` schemas read stored rows that name them.
- [ ] `pnpm benchmarks:eurostat --country <code> --year <year>`: a hand run script that prints the fatality rows, the interpolated lost days rows and the size ratio table for one country and writes nothing; worth it from the third country on, once the hand recipe in the runbook has been followed twice.
- [ ] Rename the five `_chf` scalar columns on `benchmark_snapshots` by add, switch, remove, sequenced with row 31, which touches money columns anyway (Migration plan phase 3).
- [ ] Austria: AUVA's accident statistics per 1 000 insured by ÖNACE were not confirmed by the fact check of 13 Sep 2026; find the table, then run the "Adding a country" recipe. Same recipe for the Netherlands, France and Italy once the marketing site opens them.
- [ ] A German marketing example (a `GmbH` in EUR beside the Swiss one) is a copy decision for the marketing copy pass; the marketing literal stays Swiss in this feature (AC-18).
- [ ] A `de-DE` locale (German grouping and currency placement for German clients) is a localisation decision under spec 0004; record it there when a German pilot asks.
- [ ] A European aggregate rung (Eurostat `EU27_2020` rows labelled as European figures) for countries with no national table was deliberately not built; reconsider only if row 30's named peers leave too many empty cards.
- [ ] `peerNote` per country: the catalogue's Swiss notes are CH only; if the owner wants a country specific note (for example why Germany publishes no LTIFR), extend `peerNote` to a per country map then.
- [ ] `src/features/benchmark/AGENTS.md` should carry the country rules (one country per snapshot, `ALL` only for multipliers, the catalogue as the only list) after the build; `/sync` owns that file.

## Rationale

Reasoning, options and references: see [rationale.md](rationale.md).
