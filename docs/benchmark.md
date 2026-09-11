# Peer benchmark and CHF opportunity

The runbook for feature 9 (spec [0008](specs/0008-peer-benchmark-chf-opportunity/index.md)): how the benchmark is computed, what a snapshot holds, how the peer seed is curated and generated, how to recompute every company, and the gate production must pass. Nothing here calls a model. The benchmark is arithmetic over stored rows.

## The model in words

The `benchmark-company` task (`src/trigger/benchmark-company.ts`) runs after a research run ends `succeeded`, after a client saves the industry or the headcount, and on `pnpm benchmarks:recompute`. It reads the company, its current KPI rows (`company_kpi_current`, the newest year per KPI), the peer rows in `benchmarks` and the seven constants in `benchmark_assumptions`, hands them to the pure function `computeBenchmark` in `src/features/benchmark/model.ts`, and inserts one immutable `benchmark_snapshots` row. The dashboard reads only that row.

1. **Inputs.** FTE equals `companies.employees_count`; every employee counts as one full time job (a fixed assumption, shown in the disclosure). The NOGA section comes from `sectionOfDivision(industry_code)`, the size band from `sizeBandOf(employees_count)` (`1-49`, `50-249`, `250+`, or `all` when the headcount is unknown).
2. **Peer selection** per KPI, the first rung with any row: (section, band), (section, all), (ALL, band), (ALL, all). Within the rung the row for the KPI's year wins, else the nearest year, the newer on a tie. A KPI with no row on any rung gets no position and does not count as compared.
3. **Position.** For a `lower_is_better` KPI a value at or below p25 is the top quarter, at or below the median is better than the median, at or below p75 is worse than the median, else the bottom quarter; mirrored for `higher_is_better`. For `iso_45001_certified` the peer median is the share of certified peers: 1 is better than the median, 0 is worse.
4. **Gap.** `gapToMedian` is the signed distance in the KPI's unit, positive meaning worse than the median; `gapRelative` is that distance divided by the median (null when the median is 0, 1 for a missing ISO certificate). A KPI is a gap when the distance is positive.
5. **Cost.** No cost when FTE is missing or 0, or when neither the accident rate nor the LTIFR has a row.

   ```
   incidents    = accident_rate_per_1000_fte × FTE ÷ 1 000
                  (else LTIFR × FTE × hours_per_fte ÷ 1 000 000)
   lostDays     = the company's lost_days_per_incident, else lost_days_per_incident_default
   costPerCase  = direct_cost_per_case_chf + lostDays × cost_per_absence_day_chf
   annual       = incidents × costPerCase × indirect_multiplier
   low, high    = the same with indirect_multiplier_low and indirect_multiplier_high
   atMedian     = the formula at the incident KPI's peer median (and the lost days peer median when that KPI has a peer row)
   atTop        = the same at p25
   savingMedian = max(0, annual − atMedian), savingTop likewise; null when the reference is missing or 0
   ```

   Fatalities are never priced; absenteeism, near misses and TRIFR carry no CHF line in this version.
6. **Ranking.** A `fatalities` value above 0 is rank 1. Then the cost linked gaps (`accident_rate_per_1000_fte`, `ltifr`, `lost_days_per_incident`) by the saving of moving only that KPI to its peer median, descending; then the other gaps by `gapRelative` descending. Ties and null sort keys break by the catalogue `sort_order`.
7. **Confidence.** The minimum confidence over the rows the cost used (1 for a client entered row); null when there is no cost.
8. **Scalars.** `kpis_compared` counts the KPIs with a peer row; `peer_provisional` is true when any used peer row or assumption is provisional. Money is stored unrounded and rounded once at display and in the email (`roundChf`: nearest 100 below 10 000, else nearest 1 000).

## The snapshot

`benchmark_snapshots` (`supabase/schemas/26_benchmark_snapshots.sql`) is a tenant table with the full contract (organization index, audit trigger, `updated_at`), readable by members and assigned experts, written only by the task as the service role: the write grants are revoked from every app role. The scalar columns feed the card; the five jsonb blocks hold everything used:

- `inputs`: FTE, section, band, industry code, `companyUpdatedAt` (the company row re read right before computing) and one entry per KPI row (id, value, year, source, confidence, run id).
- `results`: per KPI the peer row copied (id, rung, section, band, year, `yearMatch`, quartiles, sample size, provisional), the position, the gap and the relative gap.
- `gaps`: the ranked list with `reason` (`fatality`, `cost`, `distance`) and the solo move saving.
- `cost`: the block of rule 5, or null.
- `assumptions`: every assumption the cost used, value, unit, source and provisional flag copied.
- `derived`: the two display only injury counts, or null. Added by spec 0012, so it exists only on a `benchmark-model@2` row.

`model_version` names the rule set and the block schema (`MODEL_VERSION` in `src/features/benchmark/catalogue.ts`, `benchmark-model@2`). The reader (`src/features/benchmark/queries.ts`) picks the schema through `SNAPSHOT_SCHEMAS` in `snapshot.ts`, which is keyed by **literal** version strings, not by the live constant, so a bump adds an entry instead of renaming the only one. Both `benchmark-model@1` and `@2` are in the map and both stay valid; a `@1` row has no `derived` key and the reader treats it as absent. A row with an unknown version or blocks that fail their schema is treated as absent and reported to Sentry. A formula change bumps the constant, adds a schema to the map and never rewrites or blanks old rows.

The dashboard state is derived, never stored: a snapshot with nothing compared is `noData` (with the facts form), any other snapshot is `ready`; with no snapshot, a run that succeeded, a company edit or a client figure save (`clientKpiUpdatedAt`, the newest client row) younger than two minutes (`BENCHMARK_WAIT_MS`) is `calculating`, anything older is `unavailable`.

## Client figures

Feature 10 (spec 0010) lets a client type the same eight KPIs by hand in the "Your figures" card under the KPI table (`src/features/self-assessment/`). Nothing changed in the schema; the rules worth knowing:

- **One year per save.** The picker offers one contiguous run of years, newest first, from the current `Europe/Zurich` year down to the smaller of four years back and the oldest year on file, never below 2000 (`yearOptions` in `years.ts`); it starts on the newest year on file, else last year. Every figure in the form belongs to that year, and a year change refills the fields from the rows already on the page.
- **The view decides what is current.** A client value is an ordinary `company_kpis` row with `source 'client'`, no run, no confidence and no sources; `company_kpi_current` puts it before the research row of the same year, so the table, the coverage line and the benchmark (which reads the newest year per KPI and applies confidence 1 to a client row) follow without any app logic. The table marks such a cell "Your figure" instead of a confidence badge.
- **Clearing is a delete.** The clear button beside a field deletes the client row; the research row of that year, when there is one, is current again by the view's ordering. There is no "cleared" state.
- **The write path works around the partial index.** The client unique index is partial (`where source = 'client'`), which PostgREST cannot upsert onto, so `saveClientKpis` reads the existing client rows for the sent keys, updates each by id (zero rows means another member created it: `forbidden`, and nothing is inserted) and inserts the rest in one statement; a `23505` on that insert is a second tab racing and answers `conflict`. Only fields the client changed reach the action, so an untouched research value is never copied into a client row.
- **Two idempotency keys.** A save triggers `benchmark-company` with `triggerKind 'client_edit'` under `benchmark/kpis/<companyId>/<newest updated_at the writes returned>`, a clear under `benchmark/kpis-clear/<deleted row id>`, both with a one hour TTL. Saves inside one write moment collapse; a save followed by a clear are two snapshots a minute apart, which is expected.
- **Policies are per creator.** Members update and delete only client rows they created (`created_by = auth.uid()`); with one member per organization this is invisible. Feature 22 (client team invitations) relaxes both policies to organization scope and updates `supabase/tests/company_kpis.test.sql`, where one assertion pins today's behaviour.

## Derived injury counts

The card shows roughly how many injuries a year the company's own rates and headcount imply, so the CHF figure reads as a consequence rather than an assertion (spec 0012). Two numbers, both display only:

- **Lost time injuries a year**, from LTIFR when there is one, else the Suva accident rate.
- **Recordable injuries a year**, from TRIFR.

They are deliberately **not KPIs**. `kpi_definitions` gains no rows, `company_kpis` gains no rows and its `source` constraint still reads `('research', 'client')`. A count is a function of company size while a rate is not, so no peer distribution can compare one; giving them the KPI path would put two permanently empty peer columns in the table and two unrankable entries in the priority gaps. They are an explanation of the cost model, stored where the cost model lives.

What to know when changing them:

- **One exposure formula.** `exposureCount(shape, rate, fte, hoursPerFte)` in `model.ts` is the only place a rate becomes a count; `costAt` calls it for the cost line's `incidents` and the derived block calls it for both counts, so the two cannot disagree. It dispatches on the rate's shape, `per_1000_fte` (`rate * fte / 1000`) for the Suva rate or `per_million_hours` (`rate * fte * hoursPerFte / 1e6`) for LTIFR and TRIFR, not on the cost model's own two arm KPI union, which has no arm for TRIFR.
- **The whole block is null** without a positive `inputs.fte`, without the `hours_per_fte` assumption row, or when no usable rate exists. There is no partial block and no `NaN`. The two counts inside it are independently nullable.
- **The cost line and the derived block can name different rates.** The cost model prefers the Suva rate; the derived block prefers LTIFR, because that is the reader's lost time figure. They agree on the number only when both name the same key, which is what the Vitest assertion pins.
- **`hours_per_fte` is registered as used** whenever either count is produced, including on the Suva cost path where the cost line alone would not have recorded it, so the calculation disclosure always names an assumption the reader can see applied.
- **No confidence, ever.** A derived value inherits its input's reliability, so showing a score would imply the derivation was independently assessed. The type has no `confidence` key. The provenance line names the input figure and its reporting year instead, following the source of that row ("Calculated from your LTIFR for 2024" or "the researched LTIFR"), which points the reader at the number they should actually judge. The Suva rate uses a dedicated short phrase because its catalogue name does not read inside a sentence, and every other name is shortened to the part before its parenthetical gloss.
- **The badge is `variant="outline"`** with a calculator icon, so it reads as neither the filled confidence badge nor the `secondary` "Your figure" badge. It has a section on `/admin/design` so axe scans it.
- Values render at one decimal (the `oneDecimal` named format), so a company whose rates imply 0.4 injuries a year sees 0.4 and not 0.

## The seed: format and generator

The peer values and the assumptions live in two CSV files and reach the database through a generated migration, so a replaced value is a reviewed diff and a rerun changes no row count.

- `supabase/seed-data/benchmarks.csv`: `kpi_key, industry_section (A to U or ALL), size_band (1-49, 50-249, 250+, all), period_year, p25, median, p75, sample_size (empty allowed), source_name, source_url, source_note_de, source_note_en, source_key, basis_de, basis_en, provisional, is_assumption`.
- `supabase/seed-data/benchmark-assumptions.csv`: `key, value, unit, label_de, label_en, source_name, source_url, note_de, note_en, provisional, is_assumption, effective_from`. Exactly the seven keys of `ASSUMPTION_KEYS`, once each, with `indirect_multiplier_low <= indirect_multiplier <= indirect_multiplier_high`.

### The two flags, and the two source columns (spec 0016)

`provisional` and `is_assumption` mean different things and are never both true on one row:

- **`provisional`**: the value has not been read from its named source yet. It is a promise to go and read it. The launch gate requires zero of these.
- **`is_assumption`**: no published source exists, so the value is a declared modelling assumption. Waiting for it is pointless. The gate permits these, by name.

The three `indirect_multiplier*` rows are the only declared assumptions today: no Swiss or European body publishes an indirect to direct accident cost ratio, so the low bound is the ILO's, the high bound is Heinrich (1931) which modern safety science disputes, and the middle is SME24's own estimate. Each says so in its own `note`, which the disclosure renders (AC-10).

Two columns record what a peer value actually came from. Both are null on every row today; filling them is the curation pass, not a code change.

- **`source_key`**: the source's own classification the row was read from, for example `Suva class 22A`. Set it when the source publishes on a different axis than the row is keyed by. The positions list names it instead of the NOGA section.
- **`basis`** (`basis_de`, `basis_en`, both or neither): one sentence saying what the quartiles describe. This is the caveat the client sees. `source_note` stays an internal reading note and is not shown.

A row's **shape** is never a column. `p25 == median == p75` makes it a `point` row, anything else a `distribution` row, derived in the model from the values themselves (AC-4). A point row renders one sector figure with no quartile band and never the words quarter, quartile or median. Eleven of the twenty two seeded rows are point rows today, because their NOGA section holds a single Suva class.
- `pnpm benchmarks:migration` parses both files with the Zod schemas in `src/features/benchmark/seed-schema.ts`, stops with the file and line number on the first invalid row, and writes `supabase/migrations/<timestamp>_benchmark_seed.sql` with one `insert … on conflict do update` per row. The timestamp is strictly later than the newest migration, so the seed always applies after the table migration. Commit the generated file; every run makes a new one, so delete a duplicate you did not mean to keep.

After generating: `pnpm db:reset`, `pnpm test:db` (the pgTAP suites count the seven assumptions and the `ALL`/`all` accident rate row and assert every row is provisional until the launch gate below changes that expectation), then `pnpm db:types` if a column changed.

## The source checklist, and what the first seed actually holds

Every value in the first seed carries `provisional = true`, was read on 2026-09-06 from the source named on its row, and is to be replaced by the owner from the published tables before launch. No value was invented: where a table could not be read, the KPI is left uncovered and the dashboard says "no peer data yet".

| KPI or assumption | Read on 2026-09-06 | What the seed holds |
|---|---|---|
| `accident_rate_per_1000_fte` | UVG-Statistik 2024 (SSUV/Suva), Tabelle 1.2 "Versicherungsbestand und Unfallrisiko nach Wirtschaftszweig, 2022", BUV column, https://www.unfallstatistik.ch/d/publik/unfstat/pdf/Ts24.pdf | 22 rows for 2022, band `all`: the `ALL` row with the published all industries rate 61.8 as median and the quartiles across the 50 branch classes as p25 and p75; one row per section A to U with the quartiles across the section's classes (a section with one class has p25 = median = p75). The class means are per division group, so the quartiles describe the spread of classes, not of companies; `sample_size` stays empty and the note says so. |
| `lost_days_per_incident` | The UVG statistics publish no absence duration per case in the 2024 edition | Uncovered. |
| `absenteeism_rate` | BFS AVOL, "Quote der gesundheitsbedingten Absenzen der Vollzeitarbeitnehmenden nach Wirtschaftsabschnitt" (asset 36569173); the data file was not yet published on the reading date | Uncovered. Read the table once it is available and add one row per section (percent). |
| `ltifr`, `trifr` | Industry association and company reports, at least five per section | Uncovered; needs the report reading the owner planned. |
| `iso_45001_certified` | ISO Survey certificate counts by country and sector (the data files are behind the ISO site) over STATENT establishments | Uncovered. |
| `fatalities`, `near_miss_rate` | No source by design | Uncovered. |
| `hours_per_fte` | BFS, Tabelle T 03.02.03.01.02.04 "Tatsächliche Jahresarbeitszeit der Vollzeitarbeitnehmenden nach Wirtschaftsabschnitten", 2025 (revised August 2026), https://www.bfs.admin.ch/asset/de/je-d-03.02.03.01.02.04 | 1 804 hours (all sections 1 803.75). |
| `direct_cost_per_case_chf` | UVG-Statistik 2024, Tabellen 6.4 and 6.5 | 4 811 CHF: the mean of CHF 5 700 (Suva) and CHF 3 000 (other insurers) weighted by their yearly occupational accidents (168 318 and 82 575). |
| `cost_per_absence_day_chf` | SWICA Präventionsmanagement, calculation on BFS data (https://www.swica.ch/tiefe-absenzquoten-der-schluessel-zu-hoeherer-produktivitaet/); no SECO or Suva figure was located | 1 100 CHF per day. Replace with the SECO or Suva estimate. |
| `lost_days_per_incident_default` | Derived from UVG-Statistik 2024: daily allowance cost per accident (CHF 2 900 Suva, CHF 1 500 others, weighted CHF 2 439) over the daily allowance (80 percent of the average insured earnings of CHF 79 289 in 2022, over 365 days) | 14 days. A derivation, not a published mean; the allowance starts on the third day. |
| `indirect_multiplier_low` | ILO (2007), the accident cost iceberg: indirect costs at least equal the direct ones, https://www.ilo.org/media/42526/download | 2 (total cost twice the insured cost). |
| `indirect_multiplier` | National Safety Council ratio of 2.7, as cited in OSHAcademy course 700 | 3.7. A US figure; replace with a Swiss or European estimate. |
| `indirect_multiplier_high` | Heinrich (1931) ratio 1:4, as cited in OSHAcademy course 700 | 5. |

The two multiplier rows and the absence day cost are the weakest rows of the seed: their sources are secondary citations, not the EU OSHA or ILO tables the spec names. They exist so the cost model runs end to end; the owner replaces them.

## Recompute every company

After a seed replacement or a model change on the same version, refresh the clients:

```bash
pnpm benchmarks:recompute
```

It reads `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (the project's name for the service role key) and `TRIGGER_SECRET_KEY` from `.env.local`, swapped to the target environment as `docs/auth.md` describes for `pnpm user:invite`, lists every distinct company in `benchmark_snapshots`, triggers `benchmark-company` per company with `triggerKind` `recompute` under the key `benchmark/recompute/<companyId>/<yyyy-mm-dd>` (24 hour TTL, so a second run on the same day is a no op), and prints the count. It never writes the database and exits 1 when a variable is missing.

**Owed after the spec 0012 deploy.** The derived injury counts appear only on a `benchmark-model@2` row, and every stored row is `@1` until it is recomputed. Nothing breaks in between: a `@1` row parses under its own schema and its card renders exactly as before, just without the counts. So after the migration and the deploy land, run `pnpm benchmarks:recompute` against the environment, and watch it rather than firing and forgetting: it recomputes **everything**, not only the derived block, so a company whose peer rows or assumptions changed since its last snapshot will see other numbers move at the same time. Confirm the seed data has not changed first, or be ready to explain a shifted CHF figure. Snapshots are insert only, so the `@1` rows stay in place as history. Companies whose research finishes or whose figures change after the deploy get a `@2` row on their own, with no ops action.

## The rails around the task

- The research task triggers the benchmark right after its terminal `succeeded` write under `benchmark/run/<runId>`; a trigger failure is logged and reported and never changes the run.
- `updateCompanyFacts` (the form in the disclosure and on the "missing input" card) triggers it under `benchmark/edit/<companyId>/<updated_at>` (one hour TTL).
- `saveClientKpis` and `clearClientKpi` (the "Your figures" card, spec 0010) trigger it under `benchmark/kpis/<companyId>/<updated_at>` and `benchmark/kpis-clear/<rowId>` (one hour TTL); see "Client figures" above.
- The company's first snapshot sends the `benchmark_ready` email to every member (one delivery per member, key `benchmark-ready/<companyId>/<userId>`); a retry that inserts a second row is not first, so the email is never sent twice.
- A task that fails after its retries raises the `benchmark.failed` Slack alert with the Trigger.dev run page; the dashboard keeps showing the previous snapshot or "not available yet".

## Local proof and the worker

The whole thread runs without a vendor: `pnpm trigger:dev` with `RESEARCH_PROVIDER=fixture` (the fixture company has 420 employees, NOGA 23.61 and an accident rate of 68, so the seed gives one compared KPI and a cost of about CHF 1 961 000), then `TRIGGER_DEV_RUNNING=1 pnpm test:e2e e2e/benchmark.spec.ts`.

Two things to know when running the worker locally:

- Only one `trigger dev` may be connected to the dev environment at a time; a second one (another checkout, another terminal) takes the runs and the first one never sees them.
- The Trigger.dev dev environment's own variables apply to the worker and an env file value overrides them, but an empty env file value does not. When the dev environment carries `RESEND_API_KEY` and `EMAIL_ALLOWED_RECIPIENTS`, a test address is skipped as `not_allowlisted` (the delivery row still proves the send) and the Playwright thread asserts Mailpit only when the delivery's transport is `smtp`. Do not lift the allowlist in a worker env file while the Resend key is set: the sends then go out for real.

## Launch gate

The gate is two queries, because an unread value and an unsourceable one are different problems (spec 0016, AC-3). Before the promotion, replace the readable rows from the published tables, generate the seed migration, run `pnpm benchmarks:recompute` on staging, then run both.

**One: nothing is still waiting to be read.** This must return zero on both tables.

```sql
select 'benchmarks' as t, count(*) from public.benchmarks where provisional
union all
select 'benchmark_assumptions', count(*) from public.benchmark_assumptions where provisional;
```

**Two: every declared assumption is one you meant to declare.** This may return rows, but it must return exactly these three and nothing else.

```sql
select 'benchmarks' as t, kpi_key as key from public.benchmarks where is_assumption
union all
select 'benchmark_assumptions', key from public.benchmark_assumptions where is_assumption
order by 1, 2;
```

Expected, and only these: `indirect_multiplier_low`, `indirect_multiplier`, `indirect_multiplier_high`, all on `benchmark_assumptions`. No peer row may be a declared assumption. A new name in that list is a new claim the product is making without a source, so it needs a decision, not a tick.

The pgTAP suites (`supabase/tests/benchmarks.test.sql`, `benchmark_assumptions.test.sql`) assert both flags across both tables, including that no row is both provisional and a declared assumption; update them in the same change that clears a flag.

## What the research for spec 0016 confirmed is unreadable

Recorded so the curation pass does not spend a second afternoon on the same dead ends.

- **No Swiss or European body publishes an indirect to direct accident cost ratio.** The multiplier the CHF figure turns on is an assumption and is now declared as one.
- **No Swiss source publishes safety outcomes by company size band.** Every seeded peer row is therefore `size_band = all`, and a size band comparison cannot be built from public data.
- **The Suva accident tables use their own premium class scheme, not NOGA sections.** Mapping a class to a section needs a crosswalk that is not officially published, which is what `source_key` exists to record once a mapping is chosen.
- **No fatality rate and no near miss rate is published by sector.** Both KPIs are `no_source` in `KPI_CATALOGUE` and say so on the card, rather than showing "not yet" forever.
- **The BFS absence table is published by NOGA section and is readable.** `absenteeism_rate` is `pending`, not blocked: it is the readiest win of the curation pass.

The per KPI status lives in `KPI_CATALOGUE` (`src/features/research/catalogue.ts`) as `peerStatus`, one of `sourced`, `pending` or `no_source`, with a `peerNote` message key in both catalogs. A Vitest test keeps every key's status and note present.
