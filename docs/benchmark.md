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

`model_version` names the rule set and the block schema (`MODEL_VERSION` in `src/features/benchmark/catalogue.ts`, `benchmark-model@1`). The reader (`src/features/benchmark/queries.ts`) picks the schema through `SNAPSHOT_SCHEMAS` in `snapshot.ts`; a row with an unknown version or blocks that fail their schema is treated as absent and reported to Sentry. A formula change bumps the constant, adds a schema to the map and never rewrites or blanks old rows.

The dashboard state is derived, never stored: a snapshot with nothing compared is `noData` (with the facts form), any other snapshot is `ready`; with no snapshot, a run that succeeded or a company edit younger than two minutes (`BENCHMARK_WAIT_MS`) is `calculating`, anything older is `unavailable`.

## The seed: format and generator

The peer values and the assumptions live in two CSV files and reach the database through a generated migration, so a replaced value is a reviewed diff and a rerun changes no row count.

- `supabase/seed-data/benchmarks.csv`: `kpi_key, industry_section (A to U or ALL), size_band (1-49, 50-249, 250+, all), period_year, p25, median, p75, sample_size (empty allowed), source_name, source_url, source_note_de, source_note_en, provisional`.
- `supabase/seed-data/benchmark-assumptions.csv`: `key, value, unit, label_de, label_en, source_name, source_url, note_de, note_en, provisional, effective_from`. Exactly the seven keys of `ASSUMPTION_KEYS`, once each, with `indirect_multiplier_low <= indirect_multiplier <= indirect_multiplier_high`.
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

## The rails around the task

- The research task triggers the benchmark right after its terminal `succeeded` write under `benchmark/run/<runId>`; a trigger failure is logged and reported and never changes the run.
- `updateCompanyFacts` (the form in the disclosure and on the "missing input" card) triggers it under `benchmark/edit/<companyId>/<updated_at>` (one hour TTL).
- The company's first snapshot sends the `benchmark_ready` email to every member (one delivery per member, key `benchmark-ready/<companyId>/<userId>`); a retry that inserts a second row is not first, so the email is never sent twice.
- A task that fails after its retries raises the `benchmark.failed` Slack alert with the Trigger.dev run page; the dashboard keeps showing the previous snapshot or "not available yet".

## Local proof and the worker

The whole thread runs without a vendor: `pnpm trigger:dev` with `RESEARCH_PROVIDER=fixture` (the fixture company has 420 employees, NOGA 23.61 and an accident rate of 68, so the seed gives one compared KPI and a cost of about CHF 1 961 000), then `TRIGGER_DEV_RUNNING=1 pnpm test:e2e e2e/benchmark.spec.ts`.

Two things to know when running the worker locally:

- Only one `trigger dev` may be connected to the dev environment at a time; a second one (another checkout, another terminal) takes the runs and the first one never sees them.
- The Trigger.dev dev environment's own variables apply to the worker and an env file value overrides them, but an empty env file value does not. When the dev environment carries `RESEND_API_KEY` and `EMAIL_ALLOWED_RECIPIENTS`, a test address is skipped as `not_allowlisted` (the delivery row still proves the send) and the Playwright thread asserts Mailpit only when the delivery's transport is `smtp`. Do not lift the allowlist in a worker env file while the Resend key is set: the sends then go out for real.

## Launch gate

Production carries no provisional row. Before the promotion, replace the rows from the published tables, generate the seed migration, run `pnpm benchmarks:recompute` on staging, and confirm this returns zero rows on both:

```sql
select 'benchmarks' as t, count(*) from public.benchmarks where provisional
union all
select 'benchmark_assumptions', count(*) from public.benchmark_assumptions where provisional;
```

The pgTAP seed assertions (`supabase/tests/benchmarks.test.sql`, `benchmark_assumptions.test.sql`) currently expect every row provisional; flip them in the same change that clears the flag.
