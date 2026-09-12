# 0021. Named published peers

**Date**: 2026-09-13
**Status**: Proposed

## Summary

Today's peers are nameless sector statistics, and for LTIFR and TRIFR (the two injury rates most companies actually report) Switzerland has none at all. This spec puts at least three named companies next to the client's figures: companies in the same industry, from any country, that print their injury rate, lost days or ISO 45001 status in a public report. A small curated library holds them, the benchmark task picks them by a geography ladder (the client's country, then its region, then Europe, then the world) and never widens the industry, and the client sees a rank card ("4th of 6 European manufacturers that publish an LTIFR"), a table with the client's own saving at each peer's figure, and a bubble chart. Money appears only on the client's row. Nothing reaches a client unless a person has read the source page.

It follows the shape of spec 0008 exactly: data in, one pure calculation, one immutable snapshot, one card. The design reference is the Peer Standing page (artifact `3ef5da7c-9080-44f9-8405-b49b75a2cbc5`); the four calls it left open are settled below.

## Requirements

**User stories**:
- As a client, I want to see where my injury rate stands among named companies in my industry, so that the comparison is concrete and I can check every number at its source.
- As a client, I want to know what I would keep each year if I matched a named peer, so that the gap has a price I can defend.
- As an expert, I want the same rank and table on my client's page, so that the assessment conversation starts from the same picture.
- As the owner, I want to add peers by reading reports and editing a CSV, and to know that an unverified row can never reach a client.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1** (the country catalogue, built whole): `src/lib/countries.ts` exports `COUNTRIES`, a readonly list of `{ code, region, currency }` for the 32 European codes (EU 27 plus `CH`, `LI`, `NO`, `IS`, `GB`; the region map in [rationale.md](rationale.md#the-region-map), the currencies in spec 0020's catalogue table), `COUNTRY_CODES`, `REGIONS` (`dach`, `nordics`, `benelux`, `british_isles`, `southern`, `central_eastern`), `regionOf(code)`, `isEuropean(code)`, `currencyOf(code)`, `isCountryCode(value)` and `countryName(code, locale)` through `Intl.DisplayNames` (the short locale maps to `de-CH` and `en-CH`; no per country message key). A Vitest test pins the count, that every code has exactly one region and one three letter currency, that `CH`, `DE`, `AT` and `LI` are `dach`, and that `BG` maps to `EUR`. Spec 0020 consumes this file and adds nothing to its shape.
- **AC-2** (two global tables): one migration from `supabase/schemas/27_peer_companies.sql` and `28_peer_figures.sql` (kind G, the global reference contract of spec 0002). `peer_companies`: `key text primary key check (key ~ '^[a-z0-9-]+$')`, `name text not null`, `country text not null check (country ~ '^[A-Z]{2}$')`, `industry_section text not null check (industry_section ~ '^[A-U]$')`, `headcount integer not null check (headcount > 0)`, `headcount_year integer not null`, `report_url text not null`, `note jsonb` (both `de` and `en` or null, the same check as `benchmarks.basis`), `created_at`, `updated_at`. `peer_figures`: `id uuid primary key default gen_random_uuid()`, `peer_key text not null references public.peer_companies (key) on delete cascade`, `kpi_key text not null references public.kpi_definitions (key) check (kpi_key in ('ltifr', 'trifr', 'lost_days_per_incident', 'iso_45001_certified'))`, `period_year integer not null check (period_year between 2000 and 2100)`, `value numeric not null`, `value_as_published numeric not null`, `unit_as_published text not null check (unit_as_published in ('per_million_hours', 'per_200k_hours', 'days', 'boolean'))`, `basis text not null check (basis in ('employees', 'employees_and_contractors'))`, `source_url text not null`, `verified_at timestamptz`, `verified_by text`, `check ((verified_at is null) = (verified_by is null))`, `created_at`, `updated_at`, unique `(peer_key, kpi_key, period_year, basis)`, index `(kpi_key, period_year)`. RLS: every signed in role reads, ops inserts and updates, nobody deletes through the app roles, anon blocked; pgTAP files `supabase/tests/peer_companies.test.sql` and `peer_figures.test.sql` assert the policies, the checks and the seed counts of AC-4; `pnpm db:types` regenerated.
- **AC-3** (the seed path): `supabase/seed-data/peer-companies.csv` (`key, name, country, industry_section, headcount, headcount_year, report_url, note_de, note_en`) and `supabase/seed-data/peer-figures.csv` (`peer_key, kpi_key, period_year, value_as_published, unit_as_published, basis, source_url, verified_at, verified_by`). Both files are the whole table, the same rule as `benchmarks.csv`: a row absent from the CSV is retired by the generated migration. `pnpm benchmarks:migration` parses both with Zod schemas in `src/features/benchmark/seed-schema.ts`, computes `value` from the published pair (`per_200k_hours` times 5, `days` and `per_million_hours` as is, `boolean` 0 or 1 with `value_as_published` 0 or 1), refuses with the file and line a figure whose `peer_key` names no company, a `kpi_key` outside the four, a `verified_at` without a `verified_by` or the reverse, a `period_year` after the current `Europe/Zurich` year, and a company with no figure; renders one `insert … on conflict do update` per row on both tables (`key` and the four column unique key as the conflict targets), then a retirement `delete … where not in (the CSV's tuples)` on figures and then on companies (the cascade would take a retired company's figures either way; the explicit order keeps the SQL readable). A row without `verified_at` may sit in the CSV as work in progress: it is skipped by the task (AC-5) and counted by the gate (AC-14).
- **AC-4** (the first curation, with numbers): `peer-companies.csv` holds at least 8 verified companies in NACE section `C` and at least 6 in `F`, each with its headcount, report URL and at least one verified figure from a report of 2023 or later; `peer-figures.csv` holds at least 3 verified `ltifr` and at least 3 verified `trifr` figures per section, and `lost_days_per_incident` and `iso_45001_certified` figures where the same reports print them, so a Swiss client reaches three peers no later than the Europe rung. The pgTAP suite asserts these as at least counts over the rows (so adding a peer never breaks it), and a Vitest test with a frozen clock asserts that the committed figures fall inside AC-6's window on the day the seed was written.
- **AC-5** (the task loads the library): `benchmark-company` loads, with the service client, the `peer_companies` rows of the company's NACE section (from `sectionOfDivision(industry_code)`; none when the section is null) and their `peer_figures` rows for the four KPIs where `verified_at is not null`, and hands them to `computeBenchmark` as a new `library` input; the model never sees an unverified figure. `MODEL_VERSION` becomes `benchmark-model@5` and `SNAPSHOT_SCHEMAS` gains that literal key (spec 0020 then takes `@6`); `@1` to `@4` stay valid and parse as having no peer block.
- **AC-6** (the ladder, pure, in `model.ts`): per KPI of the four, from the library: keep figures whose `period_year` is at least the current `Europe/Zurich` year minus three; per company keep the latest year, and within that year the `employees` basis when both bases exist (a company with only a contractor inclusive figure is kept with that figure and its basis shows on the row); rung 1 is companies whose `country` equals the client's `companies.country`, rung 2 those whose `regionOf(country)` equals the client's region, rung 3 those with `isEuropean(country)`, rung 4 every company; the first rung with at least three companies is the result, all of its companies are the peers of that KPI, and `geoRung` records `country`, `region`, `europe` or `world`; fewer than three on rung 4 gives no peer block for that KPI. A client country outside the catalogue (the column has no check) makes rungs 1 to 3 empty and lands on `world`, never an error. The industry never widens: the library is already one section. A client whose own KPI row is missing still gets the peers listed with `rank` null. Vitest tests pin each rule with a synthetic library, including the unknown country and the single basis cases.
- **AC-7** (rank and gap): `rank` is 1 plus the number of peers strictly better than the client (lower for a `lower_is_better` KPI), so equal values share a rank; `best` is the best peer's key, and on a tie the lowest key in plain string order, so a snapshot is deterministic; `gapToBest` is the client's value minus the best peer's value in the KPI's unit, null when the client has no value. For `iso_45001_certified` there is no rank and no gap: `certifiedShare` is certified peers over peers on the rung, the client never in the denominator, and the card says "3 of 5 published peers in your industry are certified", adding "you are certified" or "you are not" only when the client has an ISO row. The position rules of spec 0016 are untouched (`results[]` is not changed), and the catalogue test that forbids quarter, quartile and median is extended to `benchmark.peers.rank.*`, `benchmark.peers.rung.*` and `benchmark.peers.table.*`; `benchmark.peers.chart.*` (the next slice) is exempt because its sector line is the sector median by name.
- **AC-8** (money only on the client's row, on one arm): per peer a `savingAtPeer`, computed inside `computeBenchmark` with the same `costAt` the cost block used, from `values` (the resolved assumptions) and `inputs.fte`, never re derived from the stored `cost` block: for `ltifr` both sides are priced on the `per_million_hours` arm (`rate × fte × hours_per_fte / 1 000 000` incidents, then cost per case and the middle multiplier), the client at its own LTIFR and the peer at the peer's, whatever arm the headline used; for `lost_days_per_incident` both sides use the client's incidents with the client's lost days against the peer's lost days; `max(0, …)`, and a peer the client is already ahead of reads `already_ahead`; null for every peer when the snapshot's cost is null or skipped, and null on `trifr` and `iso_45001_certified`, which carry no cost line. The table's saving column shows one message, `benchmark.peers.table.noSaving`, for every null case. No estimate is ever made of what a peer loses; the snapshot holds no such number. The Vitest test pins the LTIFR case against the runbook's fixture figures.
- **AC-9** (the snapshot block): `@5` adds `peers: { key, geoRung, rank, best, gapToBest, certifiedShare, chart: { peerKeys }, rows: { peerKey, name, country, headcount, headcountYear, periodYear, value, valueAsPublished, unitAsPublished, basis, sourceUrl, reportUrl, verifiedAt, savingAtPeer } [] } []` (one entry per KPI with a block), stored under a new nullable jsonb column `peers` on `benchmark_snapshots`, written by the task only with the same grants as the other blocks; the generated migration is read by hand for the `select` grant on the new column that the diff drops after the table level revoke (root `AGENTS.md`). `chart.peerKeys` (the `ltifr` block's peers that also have a `lost_days_per_incident` figure in the library, at most six, nearest `headcount` to `inputs.fte`, ties to the latest year, empty when there is no `ltifr` block) is computed now so the chart slice needs no version bump; nothing renders it in this build. The reader normalises `@1` to `@4` rows to `peers: []`. `tests/features/benchmark/runbook.test.ts` pins the version and the map.
- **AC-10** (the card replaces the row): for a KPI with a peer block, the entry in the positions list of `benchmark-segment.tsx` becomes the Peer Standing card: the rank line ("4th of 6 European manufacturers that publish an LTIFR", `benchmark.peers.rank.*` with the rung word from `benchmark.peers.rung.<geoRung>`, the country rung naming the client's country through `countryName`, the industry from `noga.sections.<letter>`, the word "publish" always in the heading; with `rank` null the heading is "6 European manufacturers publish an LTIFR" with no ordinal), the sentence naming the gap to the best peer (omitted with `rank` null), a strip SVG (the KPI's scale with one marker per peer, the client's marker only when the client has a value, and an `sr-only` sentence `benchmark.peers.srStrip` built from the client value, the peer count and the rung word), the table (company, country, basis, year, the KPI value, "If you matched them, a year"; the client's own row at its rank position with no money, absent when `rank` is null), and the rung sentence under the table ("Only one Swiss manufacturer publishes an LTIFR, so the comparison widened to Europe. Published peers are larger companies that report their figures.", `benchmark.peers.rung.sentence.*`). Each company name links to `sourceUrl`. A KPI without a block keeps today's row, including the "No national figure yet" text, so a sector point row still never says median. Every new string lives under `benchmark.peers.*` in both catalogs. The card gets a section on `/admin/design` so axe scans it.
- **AC-11** (no chart in this build, by owner decision of 13 Sep 2026 after the cross check): this build ships no bubble chart component; the block carries `chart.peerKeys` (AC-9) so the next slice can draw it without a model bump. The chart's own contract (hand drawn SVG, LTIFR across, lost days up, headcount as area, a dashed sector median line, a focusable element per bubble with a tooltip on hover and focus, an `sr-only` table, no motion under `prefers-reduced-motion`, hidden with one sentence when there is no `ltifr` block, the client lacks either figure, or fewer than one peer has both) is recorded in [rationale.md](rationale.md#the-chart-slice) and becomes its own scope row, gated on the curation yielding three peers with both figures. A grep of `src/features/benchmark/ui/` for a chart component fails in this build.
- **AC-12** (fewer than three): a KPI with no peer block in a `@5` snapshot keeps today's row and its pending text gains "No published peer yet" (`benchmark.peers.none`); a Vitest render test over a `@5` fixture snapshot with an empty `peers` block asserts the text, and the AC-6 synthetic library test covers the fewer than three rule itself.
- **AC-13** (units): a figure published per 200 000 hours is stored times five and the table shows the converted value with the published one in a tooltip ("3.2 per 200 000 hours as published"); a Vitest test over the seed schema pins the conversion and refuses an unknown unit.
- **AC-14** (the gate and the runbook): `docs/benchmark.md` gains a "Peer library" section (the two CSVs, the verified pair, the ladder in words, the recompute) and a third launch gate query, `select count(*) from public.peer_figures where verified_at is null`, which must return zero in production; the pgTAP suite asserts the seed holds no unverified figure. Gate one and two of spec 0016 are unchanged.
- **AC-15** (recompute after the seed, a runbook obligation rather than a build check): the deploy that lands the seed owes one `pnpm benchmarks:recompute` on staging and then production, run once after the whole feature has merged, recorded as a ticked box in the runbook the way spec 0016 records its recompute; `/check verify` checks that the runbook names it, not that it has run. Until then existing `@4` snapshots render as today with no peer card, and a company whose research finishes after the deploy gets a `@5` row on its own.
- **AC-16** (no personal data, no new secret): peer rows describe companies and cite public pages; no person's name enters the library except `verified_by`, which is the curator's own name in a file the owner maintains and never reaches a client page; the research prompt payload is unchanged (spec 0007 AC-13); no new environment variable.
- **AC-17** (end to end): `e2e/benchmark.spec.ts` (or a sibling `peers.spec.ts`) runs the fixture company (section C, LTIFR 2.4 and TRIFR 6.1 already in `FIXTURE_VALUES`, unchanged) through the local worker with `TRIGGER_DEV_RUNNING=1` and asserts the LTIFR rank card, the rung sentence, one linked source per row, the `sr-only` strip sentence and an axe pass; the runbook's worked figure test is untouched and gains the LTIFR saving at the best peer as a second pinned figure.

## Decision

**Chosen option**: Option 2: A curated library in two global tables, chosen by a pure ladder in the existing model, copied into the snapshot (see [rationale.md](rationale.md#options-considered)).

The four owner calls of the Peer Standing page, decided on 13 Sep 2026: larger listed peers are an acceptable comparison when every row shows the headcount and the heading says "publish"; the ladder climbs to the world by default and the card names the rung; the client's own saving is priced at every peer it is behind; the bubble chart is on the client page from the start. Curation is by CSV, by hand, for manufacturing and construction first; the research assist waits.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `frontend-design` (`anthropics/skills`, `.claude/skills/frontend-design/`; `docs/design.md` wins)

**Calls settled in this spec without a panel** (each with its runner up in `rationale.md`): rank counts strictly better peers so ties share a rank; the chart's six are the nearest in headcount; a per 200 000 hours figure is converted at seed time, not at read time; the peer block is a new jsonb column rather than a key inside `results`; the geography field is `geoRung` so it never shadows the sector ladder's numeric `rung`; this spec takes model version 5 and spec 0020 moves to 6. After the cross check of 13 Sep 2026 the owner moved the bubble chart to its own slice (AC-11), so this build ships the rank card and the table.

## Feature design

**Data model sketch**: the two tables of AC-2 (`peer_companies` 1:N `peer_figures`, cascade delete so a retired company takes its figures), the `peers` jsonb column on `benchmark_snapshots`, and the region map in `src/lib/countries.ts`. No change to `companies`, `company_kpis`, `benchmarks` or `benchmark_assumptions`.

**State transitions**: a figure is `unverified` (`verified_at` null: in the CSV, skipped by the task, counted by the gate) or `verified` (a person read the page). The only transition is the curator filling both columns in the CSV; there is no unverify, a wrong row is corrected or removed and the retirement delete takes it out. Snapshots are immutable as before.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `benchmark-company` (exists, task) | task | `companyId`, `triggerKind`, `researchRunId?` | one `@5` snapshot with the `peers` block | service role | as spec 0008; a library read failure fails the attempt and retries |
| `computeBenchmark` (exists, pure) | function | company, catalogue, kpis, peers, assumptions, `library: { companies, figures }` | body plus `peers[]` | none | none, pure |
| `getCompanyDashboard` (exists) | server component query | organization | `benchmark.peers` normalised, `[]` for old rows | member, assigned expert | as spec 0008 |
| `pnpm benchmarks:migration` (exists, script) | hand run | the four CSVs | one seed migration | none | exits 1 with file and line on the first invalid row |
| `pnpm benchmarks:recompute` (exists, script) | hand run | the target environment's keys | one trigger per company | none | as spec 0012 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| task | the library rows in play | `peer_companies where industry_section = sectionOfDivision(companies.industry_code)` joined to `peer_figures where verified_at is not null and kpi_key in (the four)` |
| model | the client's country and region | `companies.country` (exists, default `CH`, no check) and `regionOf` (AC-1); an unknown code lands on `world` (AC-6) |
| model | the current year for the freshness rule | the `Europe/Zurich` year at compute time, the same clock `yearOptions` in `src/features/self-assessment/years.ts` uses |
| model | the client's value per KPI | `inputs.kpis` of the same snapshot (the newest year per KPI, `company_kpi_current`) |
| model | `rank`, `best`, `gapToBest` | AC-7 over the rung's peers and the client's value |
| model | `savingAtPeer` | AC-8 inside `computeBenchmark`, from the resolved assumption `values` and `inputs.fte` through `costAt` on the KPI's own arm |
| model | `chart.peerKeys` | AC-9: the `ltifr` block's peers with a lost days figure, nearest `headcount` to `inputs.fte`, at most six, empty without an `ltifr` block |
| model | `certifiedShare` | certified over peers on the `iso_45001_certified` rung |
| card | the rung word | `geoRung` in the block; `benchmark.peers.rung.<geoRung>`, where `country` interpolates `countryName(inputs.country, locale)` and `region` the region's own message |
| card | the client's country for the rung | `companies.country` copied into `inputs.country` at compute time (a new `inputs` field in `@5`) |
| card | the industry word in the rank line | `noga.sections.<letter>` keyed by `inputs.section`, the message the positions list already uses |
| card | the converted and the published value | `value` and `valueAsPublished` with `unitAsPublished` in the row |
| card | the link per row | `sourceUrl` (the figure) and `reportUrl` (the company) in the row |
| card | the `sr-only` strip sentence | `benchmark.peers.srStrip` from the client value, the peer count and the rung word |
| card | the saving column text when null | `benchmark.peers.table.noSaving` (AC-8) |
| seed script | `value` | `value_as_published` and `unit_as_published` by the AC-13 rule |
| gate | the unverified count | `peer_figures.verified_at is null` (AC-14) |

**Key invariants**:
- An unverified figure never reaches a snapshot: the task filters `verified_at is not null` and the pgTAP suite asserts the seed holds none.
- The industry never widens: the task loads one section; the model has no rung across sections.
- Money exists only on the client's row: the block carries `savingAtPeer` and nothing that describes a peer's cost.
- Every peer row in a snapshot carries `country`, `periodYear`, `basis` and `sourceUrl` (schema required fields).
- A per 200 000 hours figure is compared only after conversion; `value` is always in the KPI's unit.
- A sector point row keeps its rules; the peer card and the catalogue test forbid quarter, quartile and median.
- Snapshots stay immutable and versioned; `@1` to `@4` read as having no peers.

**Security model**:
- `peer_companies` and `peer_figures` are global reference tables: every signed in role reads, ops writes through the seed (and later an admin page), no app role deletes, anon is blocked. No tenant column, nothing in them belongs to a client.
- The snapshot copy of the rows is readable by the organization's members and its assigned experts, as every other block.
- `verified_by` is a curator's name inside a file in the repository and the database; it is never rendered. If the owner prefers, it may be an initials string; the check only requires it to be present with `verified_at`.
- No new secret, no external call: the library is read from Postgres.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: the fixture company (section C) with an LTIFR gets an LTIFR block on the Europe rung with at least three peers, a rank, a gap to the best and a saving per peer, and the card, the table and the rung sentence render with an axe pass, verifies **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-10**, **AC-17**.
- Ladder: a synthetic library with two Swiss, one German and four Italian manufacturers gives `geoRung` `europe` and seven peers for a Swiss client; with three Swiss it gives `country` and three peers; a five year old figure is ignored; a company with both bases is ranked once on `employees`; a client with country `US` lands on `world`; a client with no LTIFR row gets the peers with `rank` null and no client row, verifies **AC-6**, **AC-10**.
- Honesty: an unverified figure in the library never appears in a snapshot; a section with two companies worldwide gives no block and the card says "No published peer yet"; TRIFR rows carry no money; the catalogue test finds no forbidden word in the new keys, verifies **AC-5**, **AC-7**, **AC-8**, **AC-12**.
- Units: a figure of 3.2 per 200 000 hours is stored as 16 and the table shows 16 with "3.2 per 200 000 hours as published", verifies **AC-13**.
- Regression: a `@4` snapshot renders as today with no peer card; a `@5` snapshot with an empty `peers` block shows "No published peer yet"; the seed script refuses a figure without a company, a `verified_at` without `verified_by`, and a future year, verifies **AC-3**, **AC-9**, **AC-12**.
- Database: pgTAP asserts the policies (anon blocked, member read, ops write, no delete), the checks and the counts, verifies **AC-2**, **AC-4**, **AC-14**.

## Build plan

Tracer Bullet: the first slice runs one real thread, three hand curated manufacturers through the task into a snapshot and onto a minimal card, before the rules and the chart are thickened.

1. The thin thread: the whole country catalogue in `src/lib/countries.ts` with its test; the two schema files, the generated migration read by hand, the `peers` column, pgTAP and types; the two CSVs with three verified manufacturers and one figure each, the seed schema and the migration script extension with the unit conversion and the retirement; the task's library read; `benchmark-model@5` with the ladder's happy path (`geoRung`, peers, rank), `inputs.country` and the snapshot schema; the reader; a first card with the rank line and the table in place of the LTIFR row, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-9**.
2. The rules: freshness, latest year, basis preference, the four rungs and the minimum of three, rank ties, the gap to the best, the ISO share, the saving per peer on one arm, the unknown country rule, the unit tooltip; the Vitest suites for each, satisfies **AC-6**, **AC-7**, **AC-8**, **AC-13**.
3. The card: the strip SVG with its `sr-only` sentence, the rank line in both shapes (with and without a rank), the rung sentence, the linked rows, the no saving text, the gallery section, every string in both catalogs, the catalogue test extended to the rank, rung and table keys, satisfies **AC-10**, **AC-11**, **AC-12**.
4. Curation, gate and thread: the C and F peers read from the reports and verified, the gate query and the runbook section, the recompute plan, the fixture's LTIFR and TRIFR, the e2e thread, satisfies **AC-4**, **AC-14**, **AC-15**, **AC-16**, **AC-17**.

## Consequences

**Positive**:
- LTIFR and TRIFR, the two rows that say "no national figure" today, get a real comparison a client can check line by line.
- The honesty rules are structural: the task filters unverified rows out, the model cannot widen the industry, the snapshot carries no peer cost.
- The library is data on the same rails as the sector seed; the owner grows it an afternoon at a time and the gate tells them what is not yet read.
- The ladder and the region map are the geography contract row 29 (spec 0020) and later countries reuse.

**Negative / tradeoffs**:
- Curation is the cost: reading reports by hand for two sections, and every new industry a client arrives in is another afternoon before their LTIFR row fills. The research assist that would draft rows is a follow up.
- A 300 person client is ranked among listed groups; the labelling and the headcount make it honest, not equal. Some clients will still read "4th of 6" as unfair.
- Published figures differ in what they count (contractors, thresholds); the basis column shows it, the ranking does not adjust for it.
- A recompute of every company after the seed lands, explained once, like spec 0016's.
- One more jsonb column and one more model version on a table three specs already touched this week.
- Without the chart, size is a column in the table rather than a picture; the chart slice restores that once the curation supports it.

**Neutral**:
- `@5` adds a block, no formula changes; `@1` to `@4` rows are unchanged and read as having no peers.
- The region map lands in `src/lib/countries.ts` ahead of spec 0020, which adds currencies to the same entries.
- The SME24 cohort ring (other clients, anonymised) stays deferred; the block shape leaves room for a second kind of row later.

## Follow-up

- [ ] The bubble chart as its own scope row ("Peer bubble chart"), gated on the curation yielding three peers with both LTIFR and lost days; contract in `rationale.md`, `chart.peerKeys` already in the block.
- [ ] Research assist: a hand run script that points the Parallel provider at a report URL with a peer prompt and prints a draft CSV line for a person to verify; worth building once the library passes about thirty companies.
- [ ] An ops page under `/admin` to add and verify peers without a deploy, once the CSV path has been used for two sections.
- [ ] Transport and logistics (NACE H) and the sections the pilot clients sit in, as curation rows.
- [ ] A basis adjustment or a same basis filter, only if clients ask why a contractor inclusive peer ranks against their employees only figure.
- [ ] The SME24 cohort ring (deferred in the scope): a second row kind in the same block, behind a consent line, once five clients share an industry and band.
- [ ] Spec 0020 (country): its model version becomes `@6`; when it builds, the peer table's saving column prices in the snapshot's currency.
- [ ] `src/features/benchmark/AGENTS.md` should carry the library rules (verified only, one section, money on the client row) after the build; `/sync` owns that file.

## Rationale

Reasoning, options and references: see [rationale.md](rationale.md).
