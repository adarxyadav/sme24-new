# Peer benchmark and CHF opportunity

The runbook for feature 9 (spec [0008](specs/0008-peer-benchmark-chf-opportunity/index.md)) and feature 27 (spec [0012](specs/0012-named-peer-comparison/index.md)): how the benchmark is computed, what a snapshot holds, how the peer seed is curated and generated, how the named peers are proposed, approved and refreshed, how to recompute every company, and the gate production must pass. The benchmark arithmetic itself calls no model: it is arithmetic over stored rows, and a test enforces that.

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

The dashboard state is derived, never stored: a snapshot with nothing compared is `noData` (with the facts form), any other snapshot is `ready`; with no snapshot, a run that succeeded, a company edit or a client figure save (`clientKpiUpdatedAt`, the newest client row) younger than two minutes (`BENCHMARK_WAIT_MS`) is `calculating`, anything older is `unavailable`.

## Client figures

Feature 10 (spec 0010) lets a client type the same eight KPIs by hand in the "Your figures" card under the KPI table (`src/features/self-assessment/`). Nothing changed in the schema; the rules worth knowing:

- **One year per save.** The picker offers one contiguous run of years, newest first, from the current `Europe/Zurich` year down to the smaller of four years back and the oldest year on file, never below 2000 (`yearOptions` in `years.ts`); it starts on the newest year on file, else last year. Every figure in the form belongs to that year, and a year change refills the fields from the rows already on the page.
- **The view decides what is current.** A client value is an ordinary `company_kpis` row with `source 'client'`, no run, no confidence and no sources; `company_kpi_current` puts it before the research row of the same year, so the table, the coverage line and the benchmark (which reads the newest year per KPI and applies confidence 1 to a client row) follow without any app logic. The table marks such a cell "Your figure" instead of a confidence badge.
- **Clearing is a delete.** The clear button beside a field deletes the client row; the research row of that year, when there is one, is current again by the view's ordering. There is no "cleared" state.
- **The write path works around the partial index.** The client unique index is partial (`where source = 'client'`), which PostgREST cannot upsert onto, so `saveClientKpis` reads the existing client rows for the sent keys, updates each by id (zero rows means another member created it: `forbidden`, and nothing is inserted) and inserts the rest in one statement; a `23505` on that insert is a second tab racing and answers `conflict`. Only fields the client changed reach the action, so an untouched research value is never copied into a client row.
- **Two idempotency keys.** A save triggers `benchmark-company` with `triggerKind 'client_edit'` under `benchmark/kpis/<companyId>/<newest updated_at the writes returned>`, a clear under `benchmark/kpis-clear/<deleted row id>`, both with a one hour TTL. Saves inside one write moment collapse; a save followed by a clear are two snapshots a minute apart, which is expected.
- **Policies are per creator.** Members update and delete only client rows they created (`created_by = auth.uid()`); with one member per organization this is invisible. Feature 22 (client team invitations) relaxes both policies to organization scope and updates `supabase/tests/company_kpis.test.sql`, where one assertion pins today's behaviour.

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

## Named peers (spec 0012)

Beside the statistics band, a client is compared against about ten real Swiss companies of their own NOGA section and size band. Those peers are ordinary companies inside one ops owned house organization (`SME24 peer research`, a fixed id seeded by the `peer_companies` migration, no members by design), researched by the same pipeline as a client company. Their KPI values are ordinary `company_kpis` rows with `source 'research'`.

**Where a model call is allowed.** Two places only, both outside the arithmetic: proposing candidate names (`peer-proposal@1`), and the existing research extraction. `computeBenchmark` stays pure, and `tests/features/benchmark/boundary.test.ts` fails if anything under `src/features/benchmark/` imports `src/lib/ai/`.

**The ops loop** lives on `/admin/peers`:

1. **Propose.** Pick a section and band, ask the model for candidates. Each comes back with a one line reason and is stored as `proposed` with the model and prompt version recorded. Nothing is researched and nothing is spent yet. A set that already holds ten approved peers refuses the proposal.
2. **Approve or reject.** Approving goes through `public.approve_peer_company`, which takes an advisory lock on the section and band, refuses beyond ten, and assigns the next free label `Peer A` to `Peer J`. A rejected candidate keeps its row so the model does not propose the name again.
3. **Research.** Select approved peers and confirm; the dialog names them and the number of runs, because each run costs money. The action re reads every peer, skips one that is no longer approved or already has an open run, and reports each skip with its reason.
4. **Refresh.** The daily `refresh-peer-companies` schedule (03:30) picks up approved peers researched more than twelve months ago, at most ten per run. A peer whose refresh failed three times in a row is flagged on the screen, skipped by the schedule and raised once to Slack as `peers.refresh_flagged`; ops rerun or retire it.
5. **Retire.** A peer that stopped publishing drops out of every set and frees its label. Its KPI rows stay, so an old snapshot is still explainable.

**What the client sees.** A KPI gets a peer set only when at least five approved peers hold a value for it in the same section and band; `iso_45001_certified` never gets one, because a percentile over a yes or no value means nothing. Below five, the KPI shows the industry band as before plus a quiet note. The dot strip shades the statistics p25 to p75 behind one dot per peer with the client as a larger marker, and its axis spans the peers, the band and the client so an outlier is never clipped; a visually hidden table carries the same values. The percentile is `100 × (worse + 0.5 × equal) ÷ n` in the KPI's direction. The disclosure names the peers the snapshot actually used, resolved from the KPI row ids it stored, so the chart and the panel cannot disagree after a peer is retired.

**What peers never change.** Every ranking, position, gap, quartile and CHF figure still comes from the `benchmarks` statistics rows and the assumptions. Adding or removing peers moves no CHF figure and no gap rank; `tests/features/benchmark/peer-set.test.ts` asserts that field for field.

**Versions.** `MODEL_VERSION` is `benchmark-model@2`; `SNAPSHOT_SCHEMAS` holds both versions, so every `@1` row stays readable and is never rewritten. A `@2` snapshot in an industry with no peers is field for field identical to a `@1` snapshot.

**Guards worth knowing.** The house organization has a higher research quota (50 runs per 24 hours against the client 5), enforced both in `private.research_run_allowed` and by a trigger on insert, because peer runs are written through the service client and so bypass RLS. `organization_members` refuses any row naming the house organization. Two widened `select` policies let any signed in user read an approved peer's company and KPI rows; they resolve through `peer_companies`, whose `company_id` is unique and always a house company, so they can never expose a client row. `supabase/tests/peer_companies.test.sql` proves all of that under real tokens.

**Filling an industry.** Start with the sections the pilot clients are actually in rather than alphabetically. Five approved peers with data is the point at which a client sees anything; ten is the cap. Watch what ten runs cost before filling a second industry.

## Recompute every company

After a seed replacement or a model change on the same version, refresh the clients:

```bash
pnpm benchmarks:recompute
```

It reads `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (the project's name for the service role key) and `TRIGGER_SECRET_KEY` from `.env.local`, swapped to the target environment as `docs/auth.md` describes for `pnpm user:invite`, lists every distinct company in `benchmark_snapshots`, triggers `benchmark-company` per company with `triggerKind` `recompute` under the key `benchmark/recompute/<companyId>/<yyyy-mm-dd>` (24 hour TTL, so a second run on the same day is a no op), and prints the count. It never writes the database and exits 1 when a variable is missing.

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

Production carries no provisional row. From spec 0012 the gate also grows a peer coverage line: how many sections and bands hold five or more approved peers with data fresher than twelve months. A client in an uncovered section correctly sees the statistics only dashboard, but that is a coverage fact ops should see before go live rather than after. Before the promotion, replace the rows from the published tables, generate the seed migration, run `pnpm benchmarks:recompute` on staging, and confirm this returns zero rows on both:

```sql
select 'benchmarks' as t, count(*) from public.benchmarks where provisional
union all
select 'benchmark_assumptions', count(*) from public.benchmark_assumptions where provisional;
```

The pgTAP seed assertions (`supabase/tests/benchmarks.test.sql`, `benchmark_assumptions.test.sql`) currently expect every row provisional; flip them in the same change that clears the flag.
