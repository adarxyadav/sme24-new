# 0008. Peer benchmark and CHF opportunity: rationale

The decision record for [index.md](index.md). `/develop` skips this file.

## Context

> ⚠️ Premise note: the headline of this feature is a CHF saving, and the first seed of peer values is provisional by design. A modelled saving built on unreviewed peer rows reaching a pilot client is the failure mode to guard against, not a wrong formula. The framing that holds is: the arithmetic is real from day one, the data carries a provisional flag the dashboard shows, and production has a checkable gate (no provisional row) before promotion. The Tracer Bullet stays honest because the label, not the code, says how sure the number is.

Feature 8 leaves a company with up to eight safety KPIs for three years, each with a source and a confidence, and a company row with a NOGA code and a headcount where the research found them. The product promise (`docs/scope/index.md`) is that the free step shows the size of the problem in money: how the company compares with companies like it, what to fix first, and what incidents cost per year in CHF. Without that, the KPI table is a research result, not a reason to buy a package.

Forces. Swiss safety statistics are published by a few offices (Suva and the accident insurers' statistics, the Federal Statistical Office, Eurostat for Europe, the ISO Survey for certification) at the industry section level, a year or two late, and only for some of the eight KPIs; the two rates large companies publish (LTIFR, TRIFR) have no official Swiss table. A client will forward the CHF figure to management, so every number must be defensible: which peers, which year, which assumptions, which of the company's own values. The team is one engineer; the stack already has a durable task runner, a Realtime dashboard, an email rail with a reserved benchmark ready template (spec 0006) and a data model that reserved a global `benchmarks` table (spec 0002). Feature 10 will let clients edit KPIs and must recompute; feature 12 will give ops a view; feature 18 will quote the benchmark in the gap report.

Not deciding leaves `/develop` to invent the four things a benchmark goes quietly wrong on: where the peer numbers come from, how the cost is modelled, how a result is stored so it can be traced later, and how uncertainty is shown to a client who cannot judge it.

## Options considered

### Option 1: Task computed snapshot on a curated peer table with a stored assumption set (chosen)

A `benchmark-company` task runs after each research run and each client facts edit, reads the current KPI rows, a migration seeded `benchmarks` table (quartiles per KPI, NOGA section, size band and year, each row with a source and a provisional flag) and seven `benchmark_assumptions` rows, computes positions, gaps and a parametric incident cost in pure functions, and inserts an immutable snapshot with the inputs and assumptions copied in. The dashboard reads the newest snapshot only.

**Pros**:
- Deterministic and free per run; the model runs in a unit test, in fixture mode and in Playwright (basis: your `AGENTS.md`, functional style and the fixture rule of spec 0007).
- Traceability is structural: the snapshot holds what it used, a seed change never rewrites history, and the email has a clear moment (basis: spec 0006, the reserved benchmark ready template).
- Curated rows carry a source and a provisional flag, so the launch gate is a query.

**Cons**:
- Derived data is stored (an exception to compute at read time) and needs a recompute script after a seed replacement.
- Someone must read the statistics tables; the first seed is provisional and the dashboard says so until it is replaced.

### Option 2: Compute on read with peer values and assumptions as code constants

No new tables. The server component computes positions, gaps and cost from `company_kpi_current` and TypeScript constants (peer quartiles and assumptions in the catalogue, versioned like the prompts).

**Pros**:
- Smallest build: no migration, no task, no snapshot schema; a constant change is a deploy.
- Nothing can go stale between a seed change and the page.

**Cons**:
- Nothing to trace back to once a constant changes; a client who quotes a figure in March cannot find it in April, and the "first benchmark" email has no row to hang on.
- Sources, labels and provisional marks in code and message catalogs are harder to review than rows, and feature 12 cannot show ops a table that does not exist.

### Option 3: Model estimated benchmark

One Claude call per company through the gateway estimates peer quartiles for the company's sector and the cost of its incidents from its KPIs and facts, returning a structured object stored as the result.

**Pros**:
- Covers every KPI and sector at once, including the four with no official statistic, with a readable explanation.
- No curation work before launch.

**Cons**:
- The peers are a model's recollection, not a table anyone can cite; a client's management asking "which companies" gets no answer, and two runs can disagree.
- A per company model call adds cost and latency to a free step, and confidence becomes a judgment on a judgment.

### Option 4: Peers derived from companies researched on the platform

Aggregate `company_kpis` across organizations per section and band into peer quartiles, refreshed by a schedule.

**Pros**:
- No external source and a dataset that grows with the product; genuinely Swiss and current.
- Eventually finer than any published table.

**Cons**:
- Empty for months: quartiles need dozens of companies per section and band, and the pilot has a handful.
- Every peer value inherits research noise, and cross tenant aggregation of client data raises a consent question feature 14 has not answered.

## Rationale

Option 1 wins on the two forces that matter: defensibility and the team. A client forwards the CHF figure, so the peers must be citable rows and the assumptions must be visible; only a stored, sourced table gives that, and only a stored snapshot lets a figure quoted in March be found in April (basis: the scope's "traceable to stored inputs" done rule; spec 0002, which reserved `benchmarks` as a global read table). The team is one engineer with a working task runner, Realtime dashboard and email rail, so the marginal cost of a task and a tenant table is a day, while the marginal cost of curating statistics is the same in every option that is honest (basis: spec 0007's task and dashboard pattern, reused as is). Option 2 would be right for a prototype; at GA the missing history and the invisible sources are the bug. Option 3 solves the curation problem by removing the thing that makes the number defensible. Option 4 is the long run answer and is left as a follow up for when the platform has the volume.

Two engineer preferences deserve a note. Storing derived values is normally wrong (stale caches); here the snapshot is a record, not a cache: immutable, versioned, copied with its inputs, and the page never recomputes, so the usual failure (a stored value disagreeing with a live one) cannot occur by construction. And the cost model is deliberately narrow (lost time incidents only, no absenteeism or fatality pricing): a small model whose every line the client can see beats a larger one with a hidden assumption, and `MODEL_VERSION` makes the next line an explicit change (basis: validate at the boundary and versioned prompts, your `AGENTS.md`).

A middle path was weighed and rejected: keep `benchmarks` as a table but hold the seven assumptions as code constants (a smaller build: no second table, half the generator, one pgTAP file fewer). It was rejected because the assumptions are the part ops will want to adjust without a deploy, because their labels and sources belong next to their values in one reviewable place rather than split between a constant and two message catalogs, and because feature 12's admin view needs a table to show. The snapshot copy gives traceability either way; the table gives the owner a place to edit.

The calls made while writing (the RECOMMEND items), each with its runner up:
- **Heads as FTE** with a fixed disclosure line rather than an `fte_per_employee` assumption row: the research returns heads, most SMEs cannot say their FTE, and a factor nobody can judge would sit in the disclosure as false precision. Runner up: the assumption row, added later as `benchmark-model@2` if the owner sees part time heavy sectors.
- **Peer rung ladder** section and band, section and all sizes, all industries and band, all industries and all sizes, with the year rule inside each rung: a coarser peer group beats a wrong year, and the dashboard labels every fallback. Runner up: year first across rungs.
- **Position bands from quartiles** (top quarter, above median, below median, bottom quarter) named in words; ISO 45001 compares a yes or no with the share of certified peers. Runner up: a percentile estimate by interpolation, which promises more precision than three quartiles hold.
- **Cost linked KPIs** are the incident rate used and lost days per incident; TRIFR is not priced (it includes cases without lost time), fatalities are never priced (a fatality is rank one, not a CHF line). Runner up: pricing TRIFR with a lower cost per case, which needs an assumption the sources do not give.
- **Ranking**: cost gaps by their own CHF saving, then the rest by relative distance; a missing ISO certificate counts as a 100 percent gap. Runner up: a weight per KPI, one more table to justify.
- **Rounding** at display only (nearest 100 below 10 000, else nearest 1 000) with unrounded numerics stored: traceability wants the raw number, the client wants a round one. Runner up: store rounded.
- **Always insert a snapshot**, even with nothing compared: the dashboard state is then a property of a row, and the waiting state has a bounded life. Runner up: skip the insert, which leaves the page guessing between "still calculating" and "nothing to show".
- **"First snapshot" by the oldest row, not by a count**: a retry that inserts a second row after a crash between insert and send would make a count of 1 impossible and lose the email; the attempt whose row is the oldest sends, and the per member key stops a double send. Runner up: a `first_email_sent` flag, one more write on an immutable table.
- **A schema map keyed by `model_version`** rather than one schema: a version bump must never blank every client's segment at once; old rows keep parsing with their own schema until the recompute script refreshes them. Runner up: a data migration rewriting old snapshots, which destroys the history the snapshot exists to keep.
- **Accept the edit versus run race** (two snapshots seconds apart, the newest wins) rather than serialising the two tasks: the window is the time between the benchmark task's company read and its insert, `inputs.companyUpdatedAt` shows which facts were used, and the next trigger heals it. Runner up: an advisory lock per company in the task.
- **Idempotency keys** per trigger (`benchmark/run/<runId>`, `benchmark/edit/<companyId>/<updated_at>`, `benchmark/recompute/<companyId>/<date>`): each moment computes once, a rapid double save still computes the latest facts because the task reads at run time (basis: idempotency keys for operations with side effects; spec 0007's key pattern).
- **Waiting window** of 2 minutes: the task takes seconds, so anything longer is a failure ops already know about from the alert.
- **Queue** `benchmark` with concurrency 5, `maxDuration` 120 seconds, 3 attempts: the task is one read and one insert; the limit protects the database, not the vendor.
- **Recipients** of the email: every member of the organization (one today, several from feature 22), through `{ userId }` so the task resolves language and address (basis: spec 0006's recipient rule).
- **Uncovered KPIs**: `fatalities` (a count is not comparable across sizes) and `near_miss_rate` (no published source) get no peer rows; better an honest "no peer data yet" than a converted number shown as a peer value.

## Peer data sources to curate (the seed checklist, provisional until read)

The names below are the statistics the owner reads to fill `supabase/seed-data/benchmarks.csv` and `benchmark-assumptions.csv`; none of the values are in this spec on purpose. Each row in the CSV names its `source_name` and, once known, the `source_url`. Unverified on 2026-09-06 which exact tables and years are current; `docs/benchmark.md` records what was actually read.

| KPI or assumption | Source to read | What to take |
|---|---|---|
| `accident_rate_per_1000_fte` | Suva and the accident insurers' UVG statistics (Sammelstelle für die Statistik der Unfallversicherung), occupational accidents per 1 000 full time employees by economic class | the rate per section and, where published, per size class; quartiles from the distribution across classes when only a mean per class exists (note it in `source_note`) |
| `lost_days_per_incident` | the same UVG statistics, absence duration per case | average days per case per section |
| `absenteeism_rate` | Federal Statistical Office, work volume statistics (AVOL), absence hours as a share of contractual hours by sector | percent per section |
| `fatalities` | none in this feature (a count; Eurostat ESAW gives a fatal rate per 100 000 workers for a later scaled row) | no row |
| `ltifr`, `trifr` | industry association safety reports and large company sustainability reports for the section (no official Swiss table) | quartiles across the reports read, with `sample_size` the number of reports; leave the section uncovered when fewer than five |
| `near_miss_rate` | none known | no row |
| `iso_45001_certified` | ISO Survey certificate counts by country and sector, divided by the number of establishments per section (Federal Statistical Office STATENT) | the share as `median` (with `p25` and `p75` equal), noted as an approximation |
| `hours_per_fte` | Federal Statistical Office, annual hours per full time job | one value |
| `direct_cost_per_case_chf` | Suva, average insured cost per occupational accident case | one value, the year in `effective_from` |
| `cost_per_absence_day_chf` | State Secretariat for Economic Affairs (SECO) and Suva estimates of the cost of one absence day to the employer | one value |
| `lost_days_per_incident_default` | the UVG statistics, all industries average days per case | one value |
| `indirect_multiplier_low`, `indirect_multiplier`, `indirect_multiplier_high` | EU OSHA and ILO literature on the ratio of indirect to direct accident costs | three values spanning the published range |

## References

**Project sources** (verifiable, in this repo):
- `AGENTS.md`: functional style, one error handling pattern, validate at the boundary, the four client factories and the service client rule, the tenant table contract pointer, the email and research rules.
- Spec 0002: the `benchmarks` reservation as a kind G table, `company_kpi_current`, the tenant table contract and the audit trigger.
- Spec 0006: the template registry, the recipient rule, the reserved benchmark ready template and the alert registry.
- Spec 0007: the task pattern with explicit ids, the idempotency key pattern, the fixture thread, the confidence thresholds and the catalogue.
- `docs/design.md`: the chart tokens, the status colors rule, the gallery mandate and the `chfWhole` format from `docs/localization.md`.
- Installed skills: `supabase-postgres-best-practices`, `trigger-tasks`, `react-email`, `shadcn`, `next-intl-app-router`, `vitest`, `playwright-skill`.

**Practices & standards**:
- Idempotency keys for operations with side effects (a computation with an email and an alert behind it).
- Immutable, versioned records for derived figures that people quote (append only snapshots with copied inputs).
- NOGA 2008, the Swiss version of NACE Rev. 2, for the division to section mapping.
- The Swiss SME size bands (1 to 49, 50 to 249, 250 and more) as the Federal Statistical Office uses them.
- Showing model uncertainty as a range and a confidence label rather than a point estimate.
