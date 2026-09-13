# Peer benchmark and CHF opportunity

The runbook for feature 9 (spec [0008](specs/0008-peer-benchmark-chf-opportunity/index.md)): how the benchmark is computed, what a snapshot holds, how the peer seed is curated and generated, how to recompute every company, and the gate production must pass. Nothing here calls a model. The benchmark is arithmetic over stored rows.

## The model in words

The `benchmark-company` task (`src/trigger/benchmark-company.ts`) runs after a research run ends `succeeded`, after a client saves the industry or the headcount, and on `pnpm benchmarks:recompute`. It reads the company, its current KPI rows (`company_kpi_current`, the newest year per KPI), the peer rows in `benchmarks` and the seven constants in `benchmark_assumptions`, hands them to the pure function `computeBenchmark` in `src/features/benchmark/model.ts`, and inserts one immutable `benchmark_snapshots` row. The dashboard reads only that row.

1. **Inputs.** FTE equals `companies.employees_count`; every employee counts as one full time job (a fixed assumption; the page no longer states it since the disclosure was cut on 13 Sep 2026). The NOGA section comes from `sectionOfDivision(industry_code)`, the size band from `sizeBandOf(employees_count)` (`1-49`, `50-249`, `250+`, or `all` when the headcount is unknown).
2. **Peer selection** per KPI, the first rung with any row: (section, band), (section, all), (ALL, band), (ALL, all). Within the rung the row for the KPI's year wins, else the nearest year, the newer on a tie. A KPI with no row on any rung gets no position and does not count as compared.
3. **Position.** A fatality count is first turned into a rate per 100 000 employed persons (`count ÷ FTE × 100 000`, the unit of the Eurostat peer row; with no headcount the KPI is not compared at all) and the snapshot records that rate as `comparedValue`; every other KPI is judged on its stored value. For a `lower_is_better` KPI a value at or below p25 is the top quarter, at or below the median is better than the median, at or below p75 is worse than the median, else the bottom quarter; mirrored for `higher_is_better`. For `iso_45001_certified` the peer median is the share of certified peers: 1 is better than the median, 0 is worse.
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
   savingMedian = max(0, annual − atMedian), savingTop likewise; null only when the incident KPI has no peer row
                  (a peer value of 0 is a real reference that prices to zero incidents, so the saving is then the whole annual cost)
   ```

   Fatalities are never priced; absenteeism, near misses and TRIFR carry no CHF line in this version. No cost either when an assumption the arm needs is missing or not a number (`hours_per_fte` on the LTIFR arm, the default lost days without a lost days row, the cost and multiplier rows on both arms): the body then carries `costSkipped` naming the key, which the task logs and never stores, so ops read a named cause rather than a `NaN`.
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
- `derived`: the two display only injury counts, or null. Added by spec 0012, so it exists only on a `benchmark-model@2` or later row.
- `peers`: the named published peer blocks, one per KPI with at least three published peers (spec 0021, see "Peer library" below), or null. Exists only on a `benchmark-model@5` or later row; the reader normalises an older row to an empty list. From `benchmark-model@6` the LTIFR block's `chart` holds the client's own point and the peer points of the bubble chart (the chart amendment, AC-20); a stored `@5` row reads as an empty chart, so its card shows no chart until the recompute.

`model_version` names the rule set and the block schema (`MODEL_VERSION` in `src/features/benchmark/catalogue.ts`, `benchmark-model@6`). The reader (`src/features/benchmark/queries.ts`) picks the schema through `SNAPSHOT_SCHEMAS` in `snapshot.ts`, which is keyed by **literal** version strings, not by the live constant, so a bump adds an entry instead of renaming the only one: `benchmark-model@1` (the five blocks), `benchmark-model@2` (plus `derived`, spec 0012), `benchmark-model@3` (plus the peer `shape`, `sourceKey` and `basis` and the assumption `note` and `isAssumption`, spec 0016) and `benchmark-model@4` (plus `comparedValue` on each result, and the rules of the 2026-09-12 amendment: a peer reference of 0 prices to zero incidents, fatalities compare as a rate per 100 000 employed persons, a missing assumption gives a null cost instead of `NaN`) and `benchmark-model@5` (plus `inputs.country` and the `peers` blocks of spec 0021, no formula change) and `benchmark-model@6` (the LTIFR block's `chart` widened to the client's point and the peer points, the denominator and the note on every peer row, spec 0021 chart amendment, no formula change) are all in the map and all stay valid; a `@1` row has no `derived` key and the reader treats it as absent, and a `@3` row has no `comparedValue`. A row with an unknown version or blocks that fail their schema is treated as absent and reported to Sentry. A formula change bumps the constant, adds a schema to the map and never rewrites or blanks old rows. `tests/features/benchmark/runbook.test.ts` pins the version and the map named here to the code.

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
- **`hours_per_fte` is registered as used** whenever either count is produced, including on the Suva cost path where the cost line alone would not have recorded it, so the snapshot's assumption list records the hours even though no client page renders that list since 13 Sep 2026.
- **No confidence, ever.** A derived value inherits its input's reliability, so showing a score would imply the derivation was independently assessed. The type has no `confidence` key. The provenance line names the input figure and its reporting year instead, following the source of that row ("Calculated from your LTIFR for 2024" or "the researched LTIFR"), which points the reader at the number they should actually judge. The Suva rate uses a dedicated short phrase because its catalogue name does not read inside a sentence, and every other name is shortened to the part before its parenthetical gloss.
- **Only the lost time count is shown since 13 Sep 2026.** The opportunity card keeps it as a clause under the working estimate ("from about 1.8 lost time injuries across 420 employees") and no badge. The recordable count, both provenance sentences, the priced note, the computed on date, the KPIs compared count and the confidence driver rendered as rows at the top of the "How this is calculated" disclosure until the owner cut that disclosure the same day: the formula, the assumptions and the inputs used no longer render for the client either. The block stays in the snapshot untouched (the model and the email are unchanged). The design gallery mirrors the card so axe scans it.
- Values render at one decimal (the `oneDecimal` named format), so a company whose rates imply 0.4 injuries a year sees 0.4 and not 0.

## The seed: format and generator

The peer values and the assumptions live in two CSV files and reach the database through a generated migration, so a replaced value is a reviewed diff and a rerun changes no row count.

- `supabase/seed-data/benchmarks.csv`: `kpi_key, industry_section (A to U or ALL), size_band (1-49, 50-249, 250+, all), period_year, p25, median, p75, sample_size (empty allowed), source_name, source_url, source_note_de, source_note_en, source_key, basis_de, basis_en, provisional, is_assumption`.
- `supabase/seed-data/benchmark-assumptions.csv`: `key, value, unit, label_de, label_en, source_name, source_url, note_de, note_en, provisional, is_assumption, effective_from`. Exactly the seven keys of `ASSUMPTION_KEYS`, once each, with `indirect_multiplier_low <= indirect_multiplier <= indirect_multiplier_high`.

### The two flags, and the two source columns (spec 0016)

`provisional` and `is_assumption` mean different things and are never both true on one row:

- **`provisional`**: the value has not been read from its named source yet. It is a promise to go and read it. The launch gate requires zero of these.
- **`is_assumption`**: no published source exists, so the value is a declared modelling assumption. Waiting for it is pointless. The gate permits these, by name.

The three `indirect_multiplier*` rows are the only declared assumptions today: no Swiss or European body publishes an indirect to direct accident cost ratio, so the low bound is the ILO's, the high bound is Heinrich (1931) which modern safety science disputes, and the middle is SME24's own estimate. Each says so in its own `note`; since the disclosure was cut on 13 Sep 2026 the note lives in the database only and reaches no client page (spec 0008 AC-10 no longer holds).

Two columns record what a peer value actually came from. Both are filled on every one of the 122 seeded rows since the peer data refresh of 12 Sep 2026 (`benchmarks.test.sql` and `seed.test.ts` both assert it), so a new row without them is a seed error, not a pending curation step.

- **`source_key`**: the source's own classification the row was read from, for example `Suva class 22A`. Set it when the source publishes on a different axis than the row is keyed by. The positions list names it instead of the NOGA section.
- **`basis`** (`basis_de`, `basis_en`, both or neither): one sentence saying what the quartiles describe. This is the caveat the client sees. `source_note` stays an internal reading note and is not shown.

A row's **shape** is never a column. `p25 == median == p75` makes it a `point` row, anything else a `distribution` row, derived in the model from the values themselves (AC-4). A point row renders one sector figure with no quartile band and never the words quarter, quartile or median. Of the 122 seeded rows, 84 are point rows: every Eurostat and BFS row by construction (one published figure per section), and 21 of the 59 accident rate rows, those whose NOGA section holds a single Suva branch or are a band scaled from one. `tests/features/benchmark/runbook.test.ts` pins both counts to the committed CSV.
- `pnpm benchmarks:migration` parses both files with the Zod schemas in `src/features/benchmark/seed-schema.ts`, stops with the file and line number on the first invalid row, and writes `supabase/migrations/<timestamp>_benchmark_seed.sql` with one `insert … on conflict do update` per row, followed by one `delete` that retires every peer row the CSV no longer names (so the CSV is the whole peer table and a replaced reading under a new year does not linger beside the new row; snapshots keep their own copy of the rows they used, so nothing stored changes). The timestamp is strictly later than the newest migration, so the seed always applies after the table migration. Commit the generated file; every run makes a new one, so delete a duplicate you did not mean to keep.

After generating: `pnpm db:reset`, `pnpm test:db` (the pgTAP suites count the seven assumptions, every KPI's row set and the `ALL`/`all` accident rate row, and assert that no seeded peer row is provisional, so a new row that has not been read from its source fails there first), then `pnpm db:types` if a column changed.

## The source checklist, and what the seed actually holds

Every peer row was read on 2026-09-12 from the source named on its row and carries `provisional = false`, `source_key` and `basis` (the spec 0016 amendment, block B); the four readable assumptions still carry `provisional = true` from the first reading of 2026-09-06 and are the owner's to replace. No value was invented: where a table could not be read, the KPI is left uncovered and the dashboard says so.

| KPI or assumption | Read on | What the seed holds |
|---|---|---|
| `accident_rate_per_1000_fte` | 2026-09-12: UVG-Statistik 2026 (SSUV/Suva), Tabelle 1.2 "Versicherungsbestand und Unfallrisiko nach Wirtschaftszweig, 2024", BUV column only, https://www.unfallstatistik.ch/d/publik/unfstat/pdf/Ts26.pdf | 22 rows for 2024, band `all`: the `ALL` row with the published all industries rate 58.2 as median and the hinges across the 50 branches as p25 and p75; one row per section A to U with the hinges across the section's branches (Moore and McCabe: the median of the lower and of the upper half, the middle value excluded; a section with one branch has p25 = median = p75). The branches are NOGA division groups with one published mean each, so the spread is of branches, never of companies; `basis` says so on every row and `sample_size` stays empty because the card would read it as peers. Plus 37 scaled rows for 2024 on the bands `1-49`, `50-249` and `250+` (D4, AC-27): each is the section's Suva p25, median and p75 times the Eurostat 2023 ratio of the band's accident rate to the whole section's (accidents from `hsw_n2_05` over persons employed from SBS `sbs_sc_ovw`, the `0-9` employed class taken as the total minus the other classes where Eurostat suppresses it; Eurostat 0, 1 to 9 and 10 to 49 fold into `1-49`, 250 to 499 and 500 or more into `250+`, each fold as combined accidents over combined persons). A row is written only where the band holds at least 100 accidents and 5 000 employed persons (owner decision, 12 Sep 2026), which passes 37 of the 45 candidate cells: the 15 sections B to J and L to R have an SBS denominator, and B `1-49`, B `50-249`, B `250+`, D `1-49`, E `250+`, L `50-249`, L `250+` and R `250+` fall under the floor; A, K, O, S, T and U have no SBS denominator and keep their `all` row only. The two-decimal ratio and both counts sit in `source_note`, and `basis` says the row is a scaled estimate in the section row's unit, not a measured rate for companies of that size. |
| `lost_days_per_incident` | 2026-09-12: Eurostat `hsw_n2_04` (ESAW), Switzerland 2023, through the Eurostat API; the UVG statistics publish no absence duration per case (a full text search of the 2026 edition for Absenztage, Ausfalltage, Arbeitsunfähigkeitstage and Fehltage finds nothing) | 21 point rows for 2023 (`ALL` plus every section but U, which has three accidents): the days lost by the median accident, interpolated linearly inside the band that holds it (bands 4 to 6, 7 to 13, 14 to 20, 21 to 30, 31 to 90, 91 to 182, 183 and more days; fatal excluded), over accidents with four or more days lost. All industries 16.3 days. Describes accidents, not companies; the company's own figure is a mean per accident. |
| `absenteeism_rate` | 2026-09-12: BFS AVOL, Tabelle T 03.02.03.02.06 "Quote der gesundheitsbedingten Absenzen (Krankheit/Unfall) der Vollzeitarbeitnehmenden nach Geschlecht, Nationalität und anderen Merkmalen", sheet 2025 (revised August 2026), block Wirtschaftsabschnitte, https://www.bfs.admin.ch/asset/de/je-d-03.02.03.02.06 (the chart asset 36569173 the first pass found is the picture of this table) | 20 point rows for 2025 in percent: `ALL` (A to T, 3.62) and one per section, where BFS groups B to E, L with N, and R with S and T (members of a group share the value); none for P (not published by BFS) and U (not shown). |
| `ltifr`, `trifr` | Industry association and company reports, at least five per section | Uncovered; needs the report reading the owner planned. |
| `iso_45001_certified` | ISO Survey certificate counts by country and sector (the data files are behind the ISO site) over STATENT establishments | Uncovered. |
| `fatalities` | 2026-09-12: Eurostat `hsw_n2_02` (ESAW), Switzerland 2023, unit `RT_INC`, through the Eurostat API | 22 point rows for 2023 in deaths per 100 000 employed persons (`ALL` 1.13, 48 deaths; construction 4.94, agriculture 17.36; seven sections at 0). The model converts the company's count to the same rate from its FTE at compare time (D3). |
| `near_miss_rate` | No source anywhere: no national body collects near miss reports | Uncovered by design. |
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

**Owed after the peer data refresh deploy (spec 0016 amendment, AC-32).** A stored row keeps the version it was written under until it is recomputed, and nothing breaks in between: a `@1`, `@2` or `@3` row parses under its own schema and its card renders as it did, without the blocks a later version added. So after the refreshed seed migration and the `benchmark-model@4` code land on staging, run `select model_version, count(*) from public.benchmark_snapshots group by 1 order by 1` with the staging keys to see what is stored, then run `pnpm benchmarks:recompute` **once**, after the whole refresh has merged and never before, and watch it on the Trigger.dev dashboard to completion (the script only enqueues). It recomputes **everything**: the refreshed Suva bar, the new lost days, fatality and size band rows and the amended rules all move a company's numbers at the same time, so be ready to explain a shifted CHF figure once rather than twice. Snapshots are insert only, so the older rows stay in place as history. Companies whose research finishes or whose figures change after the deploy get a `@4` row on their own, with no ops action. Then run both launch gate queries below, and tick the recompute boxes in `docs/specs/0012-derived-injury-counts/verify.md` and in spec 0016's follow up.

## The rails around the task

- The research task triggers the benchmark right after its terminal `succeeded` write under `benchmark/run/<runId>`; a trigger failure is logged and reported and never changes the run.
- `updateCompanyFacts` (the form on the facts card after the positions and on the "missing input" card) triggers it under `benchmark/edit/<companyId>/<updated_at>` (one hour TTL).
- `saveClientKpis` and `clearClientKpi` (the "Your figures" card, spec 0010) trigger it under `benchmark/kpis/<companyId>/<updated_at>` and `benchmark/kpis-clear/<rowId>` (one hour TTL); see "Client figures" above.
- The company's first snapshot sends the `benchmark_ready` email to every member (one delivery per member, key `benchmark-ready/<companyId>/<userId>`); a retry that inserts a second row is not first, so the email is never sent twice.
- A task that fails after its retries raises the `benchmark.failed` Slack alert with the Trigger.dev run page; the dashboard keeps showing the previous snapshot or "not available yet".

## Local proof and the worker

The whole thread runs without a vendor: `pnpm trigger:dev` with `RESEARCH_PROVIDER=fixture` (the fixture company has 420 employees, NOGA 23.61, an accident rate of 68 and 12.5 lost days per accident, so the committed seed gives a cost of about CHF 1 961 000 (28.56 incidents × (4 811 + 12.5 × 1 100) × 3.7, rounded; `runbook.test.ts` computes it from `FIXTURE_VALUES` and the seed and fails when this sentence drifts), and with the committed peer library its LTIFR of 2.4 ranks 1st of 4 Swiss manufacturers that publish an LTIFR, so the saving column reads `already_ahead` on every row and no money is quoted (the same test pins the rank, the rung and the count; the ladder stops at the country rung since the curation of 13 Sep 2026 gave Switzerland four published manufacturers, where it used to widen to Europe), then `TRIGGER_DEV_RUNNING=1 pnpm test:e2e e2e/benchmark.spec.ts`.

Two things to know when running the worker locally:

- Only one `trigger dev` may be connected to the dev environment at a time; a second one (another checkout, another terminal) takes the runs and the first one never sees them.
- The Trigger.dev dev environment's own variables apply to the worker and an env file value overrides them, but an empty env file value does not. When the dev environment carries `RESEND_API_KEY` and `EMAIL_ALLOWED_RECIPIENTS`, a test address is skipped as `not_allowlisted` (the delivery row still proves the send) and the Playwright thread asserts Mailpit only when the delivery's transport is `smtp`. Do not lift the allowlist in a worker env file while the Resend key is set: the sends then go out for real.

## Peer library

Named companies beside the sector statistics (spec 0021). Two CSV files are the whole of two global tables, on the same rails as the sector seed:

- `supabase/seed-data/peer-companies.csv`: `key, name, country (ISO 3166 alpha 2), industry_section (A to U, never ALL), headcount, headcount_year, report_url, note_de, note_en`. One row per company that prints a safety figure in its own report.
- `supabase/seed-data/peer-figures.csv`: `peer_key, kpi_key (ltifr, trifr, lost_days_per_incident or iso_45001_certified), period_year, value_as_published, denominator_as_published, unit_as_published (per_million_hours, per_200k_hours, days, days_over_lost_time_accidents or boolean), basis (employees or employees_and_contractors), source_url, verified_at, verified_by, note_de, note_en`. The generator computes `value` in the KPI's own unit: a per 200 000 hours rate times five, days and per million hours as printed, a boolean 0 or 1, and for `days_over_lost_time_accidents` (spec 0021 AC-18, the chart amendment of 13 Sep 2026) the total days lost in `value_as_published` divided by the count of lost time accidents in `denominator_as_published`, rounded to one decimal; the denominator column is filled on that unit and empty on every other, and the database checks it. The table shows the converted value with the published one in a tooltip; a quotient row's tooltip shows both printed numbers, never the quotient alone. `note_de` and `note_en` (both or neither) carry what changes how a number reads, such as a fatality charged as 365 days; the note shows in the chart's tooltip and screen reader table.

**The verified pair.** A figure reaches a client only when a person has read the source page: `verified_at` and `verified_by` are both set or both empty (a database check and the seed schema enforce it). A row without them may sit in the CSV as work in progress; the benchmark task never loads it (`verified_at is not null` is in the query) and the third launch gate query below counts it. `verified_by` is the curator's name; it never reaches a client page.

All twenty four figures were signed off on 13 Sep 2026 by `admin`, who read each source page; the third launch gate query below reads zero and no agent read row remains. The ten figures of the first pass carried `Claude Fable 5.1 (agent read; owner re-read owed)` until that reading replaced the name, and the fourteen of the curation pass carried an empty pair, which is the shape to use for any future addition: a figure becomes visible to a client by being read, never by default. A new row belongs in the CSV with both columns empty, and the gate is what says when the reading is still owed.

**The ladder, in words.** The task loads the companies of the client's NACE section (`sectionOfDivision(industry_code)`) and never widens the industry. Per KPI it keeps figures from the current Zurich year minus three or later, the latest year per company, and within that year the employees only figure when both bases exist. Then it climbs: the client's country, its region (`src/lib/countries.ts`: dach, nordics, benelux, british_isles, southern, central_eastern), Europe, the world; the first rung with at least three companies wins and every company on it is a peer. A client country outside the catalogue lands on the world. Fewer than three even worldwide gives no block and the row says "No published peer yet". The rank counts peers strictly better than the client (ties share a rank); the saving at a peer is the client's own, priced on the LTIFR arm on both sides or with the client's incidents against the peer's lost days, and null for TRIFR and ISO 45001; no number ever describes what a peer loses.

**Generate and recompute.** `pnpm benchmarks:migration` parses all four CSVs, refuses with the file and line a figure of an unknown company, a company without a figure, a verified pair half filled, a unit that does not fit the KPI or a year after the current Zurich year, and renders the upserts and then the retirement (figures, then companies). Then `pnpm db:reset`, `pnpm test:db` (`peer_companies.test.sql` and `peer_figures.test.sql`), `pnpm db:types` if a column changed. A snapshot copies the peer rows it used, so a later CSV edit never changes what a client already saw; after a seed change, `pnpm benchmarks:recompute` as above.

**Owed after the named peers deploy (spec 0021, AC-15).** After the seed migration and the `benchmark-model@5` code land, run `pnpm benchmarks:recompute` once on staging and then once on production, after the whole feature has merged and never before, and watch it to completion on the Trigger.dev dashboard. Until then existing `@4` snapshots render as today with no peer card, and a company whose research finishes after the deploy gets a `@5` row on its own.

- [ ] Recompute run on staging after the named peers deploy
- [ ] Recompute run on production after the named peers deploy

**Owed after the chart deploy (spec 0021 chart amendment, AC-24).** The deploy that lands `benchmark-model@6` (the LTIFR block's `chart` widened to the client's point and the peer points) owes one more `pnpm benchmarks:recompute` on staging and then on production, once after the whole slice has merged and never before, watched to completion on the Trigger.dev dashboard. Until then a `@5` row shows the Peer Standing card without the chart (the reader normalises its chart to an empty one, so the card says the chart needs the figures), and a company whose research finishes after the deploy gets a `@6` row on its own. Run it on a UTC day no earlier recompute used, or the idempotency key hands back the old runs.

- [ ] Recompute run on staging after the chart deploy (`benchmark-model@6`)
- [ ] Recompute run on production after the chart deploy (`benchmark-model@6`)

**What the curation holds (13 Sep 2026).** Sixteen companies, the AC-4 counts met: 10 manufacturers and 6 construction groups, with three LTIFR and three TRIFR figures in C and three LTIFR in F; and, for the bubble chart (AC-23), four `days_over_lost_time_accidents` rows (Geberit, Symrise, Covestro in C; Vinci in F) beside the LTIFR rows of Symrise and Covestro.

Manufacturing (C): Geberit (CH, LTIFR 6.0 per million hours, employees only, ISO 45001 at all plants), Rieter (CH, 3.3), Sandvik (SE, LTIFR 1.2 and TRIFR 3.0 with contractors, ISO 45001 at about 80 percent of sites), BASF (DE, recordable rate 3.78 with contractors), SFS (CH, LTIFR 4.1, permanent and temporary employees, 27 locations ISO 45001), Georg Fischer (CH, LTIFR 6.5, employees and leased personnel), Lenzing (AT, TRIFR 4.5, employees, all manufacturing sites ISO 45001), Wienerberger (AT, recordable rate 9.36, own workforce, no ISO 45001 row). Construction (F): STRABAG (AT, recordable rate 13.2, own workforce, ISO 45001), NCC (SE, LTIF 3.3, own employees), VINCI (FR, LTIFR 5.8, employees), Eiffage (FR, LTIFR 4.22, own personnel), Royal BAM (NL, LTIFR 2.9 and TRIFR 3.1, own employees, all subsidiaries ISO 45001:2018), Skanska (SE, LTAR 2.2 with subcontractors and 2.1 employees only, ISO 45001).

**The first fourteen companies are signed off; the chart's six rows are not yet.** The twenty four figures of the first curation carry `admin`. The six rows the chart slice added on 13 Sep 2026 (Symrise's and Covestro's LTIFR, and the four quotient rows of Geberit, Symrise, Covestro and Vinci) entered with an empty verified pair, as every addition since the sign off must, so the third launch gate query reads six until the owner has read the six cited pages (Geberit's occupational health and safety page, Symrise's Unternehmensbericht 2024 p. 176, Covestro's sustainability statement 2024 p. 217, Vinci's données sociales 2024) and filled `verified_at` and `verified_by` with `admin` on each; the two company rows carry a rounded headcount and a note naming what to confirm on the page (the basis, any threshold). Until Geberit's quotient row is signed off, a Swiss manufacturer's chart hides behind its one sentence, because the task never loads an unverified row. A future addition enters the same way and becomes visible when a person has read its page.

**Units are the trap, and they differ by sector.** Every figure above is per million hours as printed. Rejected for an unreadable or unconvertible unit: Covestro (DE, RIR 1.70 — the 2024 ESRS page states no denominator at all and the 200 000 hour basis appears only in the 2023 methodology page, so the unit would be an inference across years, and a wrong one shows 8.5; superseded on 13 Sep 2026 by the second reading, which found the LTRIR 1.10 with its 200 000 hour basis on page 217 of the 2024 sustainability statement, a lost time rate rather than the recordable one, so Covestro enters as an LTIFR of 5.5 with the page as its source), Implenia (CH, 37 accidents per 1 000 full time positions, a third convention that cannot be converted without hours Implenia does not publish), PORR (AT, LTIFR 13.5) and Peab (SE, LTIF4 5.9), both printing a rate with no stated denominator. Bouygues returned 403 on both report PDFs. Voestalpine's LTIFR counts only accidents with more than three sick days, so it is not comparable. Sika returned 403; HOCHTIEF renders its key figures dynamically and the numbers come back blank; Schindler publishes fatalities only.

**No company publishes days lost per incident as an average, and the library divides for four of them.** Across all fourteen plus the rejected candidates, not one prints an average days lost per accident, because ESRS S1-14 88(e) asks for the total days lost and never the average. They publish a total day count (VINCI 204 991, Royal BAM 2 117, Wienerberger 5 751.5), or a severity rate on a per 1 000 hours basis (VINCI 0.41, Eiffage 0.43), or days per 1 000 full time equivalents (SFS 96), and the conventions do not convert into one another: Eiffage counts the days of accidents from the last three years, VINCI imputes 365 days per fatality, Wienerberger counts calendar days including weekends, Georg Fischer combines accidents with illness. The owner's decision of 13 Sep 2026 (spec 0021, the chart amendment, AC-18): a `lost_days_per_incident` row may be the generator's quotient of two numbers printed in one table of one report for one population, the total days lost over the count of lost time accidents, stored as the unit `days_over_lost_time_accidents` with both printed numbers on the row. The denominator is lost time accidents only, the count the company's own LTIFR divides by; days over recordable cases, a numerator that mixes illness, a rolling multi year count and a severity rate per hours are not entered. The per company verdicts of that reading are under "What is readable, and where" below; do not read those reports again.

## Launch gate

The gate is three queries, because an unread value, an unsourceable one and an unverified named peer are different problems (spec 0016, AC-3; spec 0021, AC-14). Before the promotion, replace the readable rows from the published tables, generate the seed migration, run `pnpm benchmarks:recompute` on staging, then run all three.

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

**Three: no named peer figure is waiting for a person to read its page.** This must return zero in production (spec 0021, AC-14); a row with `verified_at` null is skipped by the task, so it can only ever cost a peer, never show one.

```sql
select count(*) from public.peer_figures where verified_at is null;
```

The pgTAP suites (`supabase/tests/benchmarks.test.sql`, `benchmark_assumptions.test.sql`, `peer_figures.test.sql`) assert both flags across both tables, including that no row is both provisional and a declared assumption, and that the seed holds no unverified peer figure; update them in the same change that clears a flag.

## What is readable, and where

Recorded so the curation pass does not spend a second afternoon on the same dead ends, and corrected on 2026-09-12: the first pass searched Swiss sources only, and Switzerland reports into the European accident statistics (ESAW), which Eurostat publishes by NACE Rev. 2 section. A NACE section is a NOGA section, so those tables need no crosswalk.

**Readable, by table:**

- **Occupational accidents per 1 000 full time equivalents by Suva class**: UVG-Statistik, Table 1.2 (SSUV/Suva), the BUV column only. The 2026 edition carries 2024 figures. The classes are Suva's premium scheme, not NOGA, so a section's row spans the classes read into it and `source_key` names them; the quartiles describe the spread of classes, never of companies, which `basis` says on every row. Never read the NBUV column: non occupational accidents invert the ranking (office workers ski).
- **Fatal accidents per 100 000 employed persons by section**: Eurostat `hsw_n2_02`, Switzerland, by NACE section, latest year 2023. One rate per section, so a point row. Feeds `fatalities`; the model converts the company's count to the same unit at compare time.
- **Accidents by days lost band by section**: Eurostat `hsw_n2_04`, Switzerland, by NACE section, counts per band for accidents with four or more days lost. Feeds `lost_days_per_incident` as the median interpolated inside the band that holds the median accident; a point row, because the bands describe accidents rather than companies.
- **Accidents by section and enterprise size**: Eurostat `hsw_n2_05`, Switzerland, by NACE section and size class (0 to 9, 10 to 49, 50 to 249, 250 to 499, 500 or more). Feeds the `1-49`, `50-249` and `250+` rows of `accident_rate_per_1000_fte` as a scaled estimate: the section's Suva row times the Eurostat band to all size ratio, never a raw Eurostat rate on that KPI, because peer selection would prefer the wrong unit row.
- **The BFS health related absence rate by Wirtschaftsabschnitt**: BFS AVOL table T 03.02.03.02.06 (`je-d-03.02.03.02.06`), an Excel file with one sheet per year 2010 to 2025, the block "Wirtschaftsabschnitte" giving the rate for A, B to E together, F, G, H, I, J, K, L with N, M, O, Q and R with S and T, with a 95 percent interval; P is not published. The three chart assets the first pass found (36569171, 36569173, 36569174) are pictures of tables .05 to .07 in that series. Feeds `absenteeism_rate` as a point row per section.

Two caveats travel with every Eurostat row rather than being absorbed: the denominator is employed persons, not full time equivalents, and raw Swiss counts look worse than the EU average because of the reporting regime (EKAS/ZHAW 2025), so no row may be read as "Switzerland is dangerous".

**Still unreadable, confirmed:**

- **No Swiss or European body publishes an indirect to direct accident cost ratio.** The multiplier the CHF figure turns on is an assumption and is declared as one. The ISSA "return on prevention" figure of 2.2 is a return on prevention spending, not a cost ratio, and must not be used as a multiplier.
- **No public LTIFR or TRIFR peer exists for Switzerland**: the country reports per 1 000 full time equivalents, not per million hours.
- **No ISO 45001 share by sector**: the ISO Survey sector data lacks sector designations for most certificates and the Swiss count sits behind an IAF CertSearch login.
- **No near miss rate anywhere**: no national body collects it. `near_miss_rate` is `no_source` in `KPI_CATALOGUE` and says so on the card, rather than showing "not yet" forever.

**Published lost days per accident, for the bubble chart (read on 13 Sep 2026, two agents, about thirty European C and F reports; do not repeat).** No company prints an average of days lost per lost time accident. ESRS S1-14 88(e) asks for the number of days lost as a total, never the average, and several groups cite the transitional provision and print nothing yet; FY2025 reports should widen the pool. The decision this led to is in spec 0021 (AC-18): a quotient of two numbers printed in one table is allowed as its own unit. The verdicts, so the next curator only reads what has changed:

| Company | Section | What the report prints | Verdict |
|---|---|---|---|
| Geberit (CH) | C | 2 275 days lost and 111 lost time accidents in one table, same population; LTIFR 6.0 per million hours | Quotient 20.5, entered |
| Symrise (DE) | C | 1 105 days lost and 54 lost time accidents, Unternehmensbericht 2024 p. 176; MAQ 1.97 per million hours (the curator confirms on the page that the MAQ counts lost time accidents and notes its threshold if any) | Quotient 20.5, entered with the LTIFR |
| Covestro (DE) | C | 521 days lost and 34 lost time accidents; LTRIR 1.10 per 200 000 hours, sustainability statement 2024 p. 217 | Quotient 15.3, entered with the LTIFR (5.5 after conversion) |
| Vinci (FR) | F | 204 991 days lost and 2 879 lost time accidents, données sociales 2024; TF 5.80 per million hours; 365 days charged per fatal accident | Quotient 71.2, entered with a note on the fatality charge |
| Goldbeck (DE) | F | 38.6 days per accident, the one company that prints the average (Nachhaltigkeitsbericht FY2023/24), but its accident rate is per 1 000 employees | Not entered: the rate cannot sit on the LTIFR axis |
| BASF, STRABAG, Hochtief, ABB | C, F | Days over recordable cases | Not comparable: the denominator is not lost time accidents |
| Georg Fischer (CH) | C | A days figure that combines accidents with illness | Not comparable: the numerator is mixed |
| Eiffage (FR) | F | Days of accidents from the last three years, rolling | Not comparable: not one period |
| Ferrovial (ES) | F | A days figure with an ambiguous unit | Not entered |
| Sulzer (CH), Heidelberg Materials (DE) | C | A severity rate per million hours | A different KPI, not entered |
| Rieter, Sandvik, NCC, Skanska, Peab, Porr, Implenia, Wacker, Evonik, Voestalpine, Thyssenkrupp, Siemens, Schindler, Holcim, SKF, Bühler | C, F | No days lost per case in any form | Nothing to enter |
| Bouygues (FR) | F | Both report PDFs answer 403 | Unread |

The per KPI status lives in `KPI_CATALOGUE` (`src/features/research/catalogue.ts`) as `peerStatus`, one of `sourced`, `pending` or `no_source`, with a `peerNote` message key in both catalogs. A Vitest test keeps every key's status and note present.
