# 0022. Peer benchmark from the research run, priced by the loss table

**Date**: 2026-09-14
**Status**: Accepted

> Supersedes specs 0008, 0012, 0016, 0020 and 0021 in full and amends spec 0007 (the country becomes an input of the run, and a second task finds the peers). Owner decisions of 14 Sep 2026, taken in one sitting; the cross check of the same day reshaped the peer search into its own task and cut two controls (see Follow-up). Amended the same day after the owner's preview: peers carry their own total estimated loss, and the peer section is one merged table with both ranks in one sentence. One decision is still owed: the chart (D-chart under Follow-up); nothing in the build waits for it.

## Summary

The product is global, not Swiss first, and the client wants the money. So the research that finds a company's own safety figures now also finds the named companies it should be compared with, anywhere in the world, and the page prices the gap with the owner's own loss table (hours lost per incident, times a cost per working hour) in the client's currency. The curated peer library, the Swiss sector statistics, the Swiss cost constants and the launch gate are removed, with no fallback: the research is the one source, and every peer figure links to the page it came from. The page then reads in this order: the peers and the client's rank, the estimated loss and the saving, three experts matched by sector and country, and one recommended package.

## Requirements

**User stories**:
- As a client anywhere, I want to enter my company and its country and see named companies in my sector with their published injury rates, so that the comparison is concrete and I can check every number at its source.
- As a client, I want to see what my accidents cost me per year and what I would keep if I performed like my peers, in my currency, so that the size of the problem is a number I can take to my board.
- As a client, I want to see which experts can help and which package fits my standing, so that the next step is one click away.
- As the owner, I want no hand curated data behind the page, so that a new country or sector needs no reading session before a client gets a result.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

Global research (amends spec 0007):
- **AC-1** (the country is an input): the lookup form on `/app` gains a required country select over every ISO 3166 alpha 2 code, labelled by `Intl.DisplayNames` in the client's locale and grouped Europe first; `requestResearch` parses it (`z.enum(COUNTRY_CODES)`), writes `companies.country` and sets `companies.currency` to `currencyOf(country)`. The `COUNTRY` constant in `src/features/research/actions.ts` is deleted. The facts card (`facts-form.tsx`) and the rerun form gain the same select, prefilled from the row and required, so an old company never reruns as `CH` by default; saving the country through `updateCompanyFacts` sets the currency from it again and recomputes the snapshot as a headcount change does today. There is no currency control anywhere: the currency follows the country. A country changed after a run leaves the stored peers and their rung as the run wrote them.
- **AC-2** (the world catalogue): `src/lib/countries.ts` covers every ISO 3166 alpha 2 code with `{ code, region, currency }`. The six European regions and their members are unchanged; every other code carries one of `north_america`, `latin_america`, `middle_east_africa`, `asia_pacific`. `regionOf`, `regionCountriesOf`, `currencyOf`, `isCountryCode` and `countryName` answer for any code; the Vitest test asserts every code has a three letter currency and a region. The Europe first grouping of AC-1 is `isEuropean`.
- **AC-3** (no Swiss wording in the pipeline): the provider objective, the output schema descriptions (`legal_name`, `uid`) and the validation prompt (`research-validation@2`) name "the company's country" and "the national commercial register identifier as printed" and never Switzerland, CHE or Zefix. `canton` stays a fact field the schema asks for only when the country is `CH`. The `uid` check on `companies` is dropped; the CHE format is checked in Zod only when the country is `CH`. The fixture's sources cite a neutral register title.
- **AC-4** (the Suva only KPI leaves the catalogue): `accident_rate_per_1000_fte` is removed from `KPI_KEYS` and `KPI_CATALOGUE`, from the output schema and from the KPI table; its `kpi_definitions` seed row stays for existing `company_kpis` rows and the catalogue test becomes "every catalogue key exists in the seed", not equality. `peerStatus` and `peerNote` (spec 0016 AC-7) are removed from the catalogue and the catalogs.

The peer search (a task of its own):
- **AC-5** (the `research-peers` task): `src/trigger/research-peers.ts` takes `{ runId }`, runs on the `research` queue with `maxDuration` 1500 seconds and its own 20 minute budget from its own start, and is triggered by `research-company` right after its terminal write when the run ended `succeeded` or `empty`, under the idempotency key `peers/<runId>`. It loads the run and the company with the service client and keys every read and write by those ids. Its input to the provider is the company name, the section letter and its English name (`sectionOfDivision(companies.industry_code)`, written by the client run's facts), the country, `regionCountriesOf(country)` and the targets (aim 8, minimum 3). With no section on the company the task writes `summary.peers.status = skipped` and goes straight to AC-7's trigger. When `research-company` cannot trigger the peer task it triggers `benchmark-company` itself and logs the cause, so the loss still computes.
- **AC-6** (the provider call): `ResearchProvider` gains `createPeerRun(input: PeerSearchInput, schema)`; the peer output schema asks for up to eight companies of the same NACE section, each with `name`, `website`, `country` (alpha 2), `headcount`, `headcount_year`, and per rate (`ltifr`, `trifr`) the value as printed, the unit as printed (`per_million_hours`, `per_200k_hours`, `per_100_workers`), the period year and the source page. The objective tells the provider to prefer companies headquartered in the country, then in the region's countries, then anywhere, and to prefer employees only figures. `research_runs.peer_provider_run_id` is stored before the first poll; polls every 15 seconds; a retry resumes the stored provider run.
- **AC-7** (the rung is computed in code, never trusted from the provider): after validation the task keeps the peers of the client's country when at least three carry a usable rate, else the peers of the region's countries when at least three do, else every peer; the rung (`country`, `region`, `world`) and the count go to `summary.peers` and the rung is stored on every `research_peers` row. Fewer than three even worldwide keeps what there is with `thin = true`; zero kept peers writes `{ status: ok, found: 0, rung: null, thin: true }` and no row. Whatever the outcome (`ok`, `skipped`, `failed`, `timeout`), the task's last step, and its `onFailure` hook after the retries, trigger `benchmark-company` with `{ companyId, triggerKind: research, researchRunId }` under `benchmark/peers/<the peer task's own Trigger.dev run id>` (corrected from `benchmark/run/<runId>` on 14 Sep 2026, see the Follow-up); `research_runs.status` and `error_code` are never written by this task, and no alert fires for a peer failure (one `log.warn` line names the cause).
- **AC-8** (units in code, support by the validator): the value per million hours is computed in code from the unit enum (per 200 000 hours and per 100 workers both times five, per million as printed); a unit outside the three is `unsupported`. The peer task then makes one structured call under `peer-validation@1` that answers per peer and rate: supported by the cited page or not, the period year, a confidence and the supporting source indexes. A peer is dropped as `self` when its normalised name contains the client's normalised name or the reverse, or its website host equals the client's; a peer with no supported rate is dropped as `unsupported`; drops are listed in `summary.peers.dropped`. When the validation call fails after the SDK's retries the peers are kept with the code converted values and confidence capped at 0.5, `summary.peers.validation = skipped`.
- **AC-9** (the table): `supabase/schemas/29_research_peers.sql` creates `research_peers`, a kind T tenant table on the spec 0002 contract: `id`, `organization_id`, `company_id` (cascade), `research_run_id` (cascade), `peer_name`, `peer_website null`, `peer_country`, `industry_section`, `headcount null`, `headcount_year null`, `kpi_key` (FK to `kpi_definitions` and `check (kpi_key in ('ltifr', 'trifr'))`), `period_year`, `value` (per million hours), `value_as_published`, `unit_as_published`, `basis null`, `source_url`, `source_title null`, `confidence`, `rung`, `created_at`; unique on `(research_run_id, peer_name, kpi_key)`; index on `(company_id, research_run_id)`. Members of the organization select; insert, update, delete and truncate are revoked for the app roles and only the service role writes. `supabase/tests/research_peers.test.sql` proves the isolation and the revokes.
- **AC-10** (the write): the peer task inserts the kept rows in one statement before the trigger of AC-7; every row carries a source URL and a rung. `succeeded` still means at least one client KPI row, written by `research-company` as today; peers never decide a run's status.
- **AC-11** (fixture): the fixture provider answers a peer run with eight peers carrying LTIFR and TRIFR: five in the client's country, two in its region and one elsewhere, so a fixture run lands on the country rung; a company name containing `thinpeers` gives two peers (world rung, thin); `empty` and `fail` behave as today for the client run and give no peers.

The model (`benchmark-model@7`):
- **AC-12** (inputs): `computeBenchmark` takes the company (`fte`, `section`, `country`, `currency`), the client's current KPI rows and the `research_peers` rows of one run, plus the loss constants; the `assumptions`, `peers` (sector rows) and `library` inputs are gone with their loaders. The snapshot body is `inputs`, `peers`, `loss`, `recommendation`; the `results`, `gaps`, `cost` and `derived` blocks, their schemas, `POSITIONS`, `PEER_SHAPES` and the `@1` to `@6` schemas are deleted, and `SNAPSHOT_SCHEMAS` holds `@7` only. This is a rewrite of `model.ts` and `snapshot.ts`, not a trim (the exports of the ladder, the quartile position, the exposure count and the CHF range go with their tests).
- **AC-13** (the peers block, one set of rows): `peers` is null when no peer was kept, else `{ rung, thin, rows, rates }`. `rows` lists every kept peer once, sorted by LTIFR ascending with peers lacking an LTIFR last: `{ peerName, country, headcount, periodYear, ltifr, trifr, sourceUrl, confidence, estimatedLoss }`, a rate null when the peer did not publish it. `estimatedLoss` is that peer's own yearly loss by the formula of AC-14 with the peer's headcount and the peer's rates (a rate the peer did not publish counts as zero for its term), the same constants and the client's currency; null when the peer's headcount is unknown. It is a total, so it grows with the peer's size (owner decision of 14 Sep 2026, kept until Phillip or a client approves the per 100 employees form, Follow-up). `rates` holds, per rate (`ltifr`, `trifr`) with at least one peer value: `count`, `median`, `best`, `rank` (1 plus the number of peers strictly better, so equal values share a rank; null when the client has no value for that rate), `of` (that rate's peer count plus one, the client being one of the compared set) and `gapToMedian`.
- **AC-14** (the loss block, the owner's table): constants in `src/features/benchmark/loss.ts`: `HOURS_PER_FTE = 1800`, `HOURS_PER_LTI = 769`, `HOURS_PER_RECORDABLE = 201`, `HOURLY_COST = 75`, `FATALITY_COST = 1_200_000`. The client's LTIFR, TRIFR and fatalities are the `company_kpi_current` rows (the newest year per key, chosen per key independently; the year used is recorded per key in `inputs.kpis`). `ltis = ltifr × fte × 1800 ÷ 1 000 000`; `recordables = max(0, trifr − ltifr) × fte × 1800 ÷ 1 000 000` (zero with `trifrMissing: true` when the client has no TRIFR); `fatalities` is the count, zero when missing; `loss = (ltis × 769 + recordables × 201) × 75 + fatalities × 1 200 000`, in `companies.currency`. `atMedian` and `atBest` evaluate the same formula with each rate's peer median or best in place of the client's, for the rates present in `peers.rates`, fatalities held; `savingAtMedian = max(0, loss − atMedian)`, `savingAtBest` likewise, both null when `peers` is null. The block is null when `fte` is missing or zero or the client has no LTIFR. Money is stored unrounded and rounded once at display and in the email (`roundMoney`, the current `roundChf` renamed). The hourly cost and the fatality price are never rendered anywhere.
- **AC-15** (the recommendation block): `{ packageKey, reason }` from the standing, first match wins: any fatality above zero or `savingAtMedian` above 250 000 → `retainer` (`fatality`, `large_saving`); no LTIFR → `sms` (`no_figures`); worse than the median on both rates → `compliance` (`both_worse`); worse on one → `sms` (`one_worse`); else → `culture` (`both_better`). A rate absent from `peers.rates` counts as neither better nor worse. The 250 000 is read in the snapshot currency without conversion, the same known simplification as the 75 and the 1 200 000 (Follow-up).
- **AC-16** (scalars and columns): `benchmark_snapshots` gains `currency text null`, `loss_amount numeric null` and `saving_at_median numeric null`; the CHF named columns stay and are null from `@7` on; `results`, `gaps` and `assumptions` lose their `not null` and are null from `@7` on; the `kpis_compared` check stays at 0 to 8 while `@7` writes 0 to 2 (the keys of `peers.rates`); `confidence` is the minimum over the client rows the loss used, a null confidence counting 1 for a client entered row and 0.5 for a research row; `peer_provisional` is always false.
- **AC-17** (which peers the task loads): `benchmark-company` loads the `research_peers` rows of `researchRunId` when the trigger is `research`; for `client_edit` and `recompute` it loads the rows of the company's latest `succeeded` run that has at least one peer row, else the latest `succeeded` run (no rows). It loads nothing from `benchmarks`, `benchmark_assumptions`, `peer_companies` or `peer_figures`. `pnpm benchmarks:recompute` still triggers every company with a snapshot. The `benchmark_ready` email states the loss and the saving in the snapshot currency.
- **AC-18** (old snapshots): `loadLatestSnapshot` returns the raw `model_version` beside the parsed blocks, and `benchmarkStateOf` returns `outdated` for any row whose version is not `benchmark-model@7`; the segment then shows one sentence and the rerun form, and nothing from the old row is rendered. No recompute is run on deploy.
- **AC-19** (removal): one migration drops `peer_figures`, `peer_companies`, `benchmarks` and `benchmark_assumptions`, drops the three `not null` of AC-16 and the `uid` check of AC-3; the four CSVs in `supabase/seed-data/`, `scripts/benchmarks-migration.mts`, `seed-schema.ts`, `seed-migration.ts`, the size band catalogue, the launch gate section and their tests are deleted; `package.json` loses `benchmarks:migration`. Biome and `pnpm typecheck` pass with nothing referencing them.

The page (`benchmark-segment.tsx`, in this order):
- **AC-20** (peer benchmark first, one table): one badge (peer count, rung, the rung's name), one rank sentence ("You rank **5 of 6** on LTIFR and **6 of 6** on TRIFR among published peers in <sector> in <rung>", each rank and `of` from `peers.rates`, a rate the client lacks left out of the sentence), then one table in the order of `peers.rows` with the columns company (headcount under the name, "No headcount published" when null), country, year, LTIFR, TRIFR, estimated loss in the client's currency (a dash when null) and a source link that opens the page in a new tab; the client's own row is highlighted in place by its TRIFR with "Your figures" in the source column (amended 14 Sep 2026 by the D-chart decision in Follow-up, which put a TRIFR ranked chart above the table; it read LTIFR as first written). One footnote under the table: the peers were found in public reports by the research; each estimated loss uses the same formula as the client's from that company's published headcount and rates, in the client's currency, and is a total that grows with company size; rates are per million hours worked and printed figures per 200 000 hours or per 100 workers are converted. When `thin`, the rank sentence is replaced by "We found only n published peers for your sector". Never the word verified. The chart sits between the rank sentence and the table (D-chart, Follow-up, decided and built 14 Sep 2026).
- **AC-21** (estimated loss second): one card with the loss per year in the client's currency as the headline, the saving at the median and at the best peer, and the counts behind it (lost time injuries, further recordable injuries, fatalities) each with a "Calculated" badge; the empty state when the client has no LTIFR reads "Enter your LTIFR in Your figures to see your estimated loss" and links to that card; no line names the hourly cost, the hours per incident or the fatality price.
- **AC-22** (experts third): three cards from `expert_suggestions`: photo, full name, headline, sectors, countries, languages, availability. The sentence above them says the ops team assigns the expert after a package is bought; there is no button (Follow-up). Fewer than three matches show what there is; zero shows one sentence.
- **AC-23** (the package fourth): the recommended package's card from the marketing package copy (name, what is included, the price as spec 0011 sells it), one sentence from `reason`, and the buy button that opens the existing checkout for that package; `retainer` shows the enquiry link instead of a price. The other packages are one link to the pricing page.
- **AC-24** (facts and figures cards keep working): the "Your figures" card (spec 0010) keeps every remaining KPI; saving LTIFR, TRIFR or fatalities recomputes the snapshot as today and the loss follows.

Experts:
- **AC-25** (the country on the profile): `expert_profiles.countries text[] not null default '{}'` with a shape check (every element two capital letters, `array_to_string(countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'`) and membership in the catalogue checked by Zod on the form; the migration backfills `{CH}` for every existing row; the expert profile form and the ops filters gain the field beside the cantons.
- **AC-26** (the function and the photo): `public.expert_suggestions(section text, country text, region_countries text[])` is `security definer` with `set search_path = ''`, `anon` execute revoked, and returns at most three `active` experts whose `industries` contain the section, by ladder: `countries` contains the country, else overlaps `region_countries` (computed by the caller with `regionCountriesOf`), else any; ordered by availability (`available`, `limited`, `unavailable`) then `years_experience` descending. It returns only `expert_id`, full name, headline, `industries`, `countries`, `languages`, `availability` and `photo_path`. A storage select policy lets any signed in user read an `expert-photos` object whose owning expert is `active`, so `loadExpertSuggestions` signs the photo with the caller's client through the existing `photoUrl`. `supabase/tests/expert_suggestions.test.sql` proves a client cannot select `expert_profiles` directly, that the function's row type has no email, notes or status column, and that a client can read an active expert's photo and not an invited one's.

Proof and words:
- **AC-27** (every string through next-intl): every new client facing string lives in both catalogs under `benchmark.peers`, `benchmark.loss`, `benchmark.experts` and `benchmark.package`; the forbidden word test of spec 0021 keeps "verified" out of the peer keys.
- **AC-28** (end to end): `e2e/benchmark.spec.ts` runs the fixture company (section C, country CH) through the local worker with `TRIGGER_DEV_RUNNING=1` and asserts the one peer table with five rows and the client row, the sentence with both ranks, the loss card in CHF, the recommended package, three expert cards from the seeded experts, and axe on every state; without the worker it asserts the queued state; a `thinpeers` company asserts the thin sentence. `supabase/seed.sql` seeds three active expert profiles in section C with `countries = {CH}`.
- **AC-29** (docs): `docs/benchmark.md` is rewritten to the new model (the loss table transcribed, the peer rung, the recommendation rule, no library, no gate, the recompute note) and `docs/research.md` gains the peer task and the `summary.peers` fields. Nested `AGENTS.md` files are `/sync`'s.

## Decision

**Chosen option**: Option 3: replace directly, one migration, one deploy.

`research-company` keeps finding the client's figures; a new `research-peers` task finds the peers and writes them; the pure model prices the client's loss with the owner's loss table; the snapshot stores both; and the page renders peers, loss, experts and package in that order. The curated tables go in the same migration because nothing that reached a client ever read them (the recompute that would have shown named peers was never run).

**Implementation skills**: `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `parallel-deep-research` (`parallel-web/parallel-agent-skills`, `.claude/skills/parallel-deep-research/`) · `ai-sdk` (`vercel/ai`, `.claude/skills/ai-sdk/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`)

## Rationale

Reasoning, options, the settled recommendations and the cross check: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (the target; one migration):

| Table | Change |
|---|---|
| `companies` | `currency text not null default 'CHF' check (currency ~ '^[A-Z]{3}$')`, set from the country on every country write; `country` keeps its default `CH` for old rows and accepts any catalogue code; the `uid` CHE check is dropped |
| `research_runs` | `peer_provider_run_id text null`; `summary.peers` `{ status, found, rung, thin, dropped[], validation, durationMs }` written by the peer task |
| `research_peers` (new, kind T) | as AC-9; `organization_id` denormalised for RLS as on `company_kpis` |
| `benchmark_snapshots` | `currency`, `loss_amount`, `saving_at_median` (all null); `results`, `gaps`, `assumptions` become nullable; `model_version` `benchmark-model@7`; the `peers` jsonb takes the new shape |
| `expert_profiles` | `countries text[] not null default '{}'` with the shape check; backfill `{CH}` |
| storage | a select policy on `expert-photos` for signed in users, active experts only |
| dropped | `peer_figures`, `peer_companies`, `benchmarks`, `benchmark_assumptions` |

Relationships: `research_peers` N:1 `research_runs`, N:1 `companies`; a snapshot copies the peer rows it used into its `peers` block, so a later run never changes what a client saw.

**State transitions**: the run's states are unchanged (`queued`, `running`, terminal); `research-company` alone writes them. The peer task runs after the terminal write and reports only through `summary.peers.status` (`ok`, `skipped`, `failed`, `timeout`). The benchmark section's states gain `outdated`.

**API surface**:

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `requestResearch` | server action | name, website, `country` (catalogue code) | run id | member | `company_exists`, `run_in_progress`, `quota_exceeded`, `trigger_failed` |
| `rerunResearch` | server action | `country` (prefilled, required) | run id | member | as today |
| `updateCompanyFacts` | server action | headcount, industry, canton (CH only), `country` | ok | member | validation |
| `research-company` | task | `{ runId }` | KPI rows, facts, terminal status, then triggers `research-peers` | service | as spec 0007 |
| `research-peers` | task | `{ runId }` | `research_peers` rows, `summary.peers`, then triggers `benchmark-company` | service | none surfaced (logged) |
| `benchmark-company` | task | `{ companyId, triggerKind, researchRunId? }` | one `@7` snapshot | service | `no_run` (no succeeded run yet, exits quietly) |
| `expert_suggestions` | SQL function | `section`, `country`, `region_countries` | up to 3 card rows | authenticated | none |
| `loadLatestSnapshot` | query | company id | parsed `@7` blocks plus the raw version | member | throws |
| `loadExpertSuggestions` | query | section, country | cards with signed photo URLs | member | throws |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| `requestResearch`, `rerunResearch`, `updateCompanyFacts` | country | the select (AC-1) |
| the same three | currency | `currencyOf(country)` from the catalogue (AC-2) |
| peer task | section letter and name | `sectionOfDivision(companies.industry_code)`; absent → `skipped` (AC-5) |
| peer task | region countries | `regionCountriesOf(country)` (AC-2) |
| peer task | value per million hours | the printed value and unit enum, converted in code (AC-8) |
| peer task | rung | computed from the kept peers' countries (AC-7) |
| model | `fte` | `companies.employees_count` (research fact or the facts card) |
| model | client LTIFR, TRIFR, fatalities and their years | `company_kpi_current`, newest year per key (AC-14) |
| model | peers per rate | `research_peers` rows of the run chosen by AC-17 |
| model | loss, atMedian, atBest, savings | the constants in `loss.ts` and the formula (AC-14) |
| model | currency | `companies.currency` |
| model | `packageKey`, `reason` | the rule (AC-15) |
| page | rank sentence | `peers.rates.<rate>.rank` and `of`, `rung`, the section name from the catalogue |
| page | benchmark state | `loadLatestSnapshot`'s raw version and blocks (AC-18) |
| page | expert cards | `expert_suggestions(inputs.section, companies.country, regionCountriesOf(country))` |
| page | photo URL | `photoUrl` with the caller's client under the new storage policy (AC-26) |
| page | package card | the marketing package copy by `packageKey` and the checkout route of spec 0011 |
| page | source link | `research_peers.source_url` copied into the block |
| page | peer estimated loss | the peer's `headcount` and rates on its `research_peers` rows through the formula of AC-14 (AC-13) |
| email | loss and saving | the snapshot's `loss_amount`, `saving_at_median`, `currency` |

**Key invariants**:
- A peer row always carries a source URL and a rung; a peer's estimated loss always uses the peer's own headcount and is null without it.
- The client's row in a peer table is the client's current value, never a research peer.
- `research-company` alone writes `research_runs.status`; the peer task never does, and a peer failure is never an alert.
- `benchmark-company` is triggered exactly once per run, by the peer task (or by `research-company` when the peer trigger itself failed).
- The loss is null without a headcount or without an LTIFR; the savings are null when `peers` is null; the recommendation always exists.
- The hourly cost, the hours per incident and the fatality price appear in code and in `docs/benchmark.md` only.
- A snapshot is immutable; a facts or figures change inserts a new one from the peers of the run AC-17 names; a country change never rewrites stored peers.

**Security model**: members read their organization's `research_peers` and snapshots; only the service role writes them (both tasks take explicit ids and filter by them). Clients read expert data only through `expert_suggestions`, which exposes the eight card fields of active experts and nothing else; direct select on `expert_profiles` stays ops and self only; the photo policy opens active experts' photos to signed in users and nothing else in the bucket. No personal data enters `research_peers` (companies and public pages only). Compliance scope unchanged (spec 0015).

**Configuration required**: none new. `PARALLEL_API_KEY` and `AI_GATEWAY_API_KEY` as today, on the peer task as well; the peer task doubles the Parallel spend per research (one more provider run, the same processor as the client run).

**Critical test scenarios**:
- Happy path: the fixture company runs through the worker; the page shows one table with five country rung peers and the client row, both ranks in one sentence, the loss in CHF, the package per the fixture standing, three experts and the package card, verifies **AC-11**, **AC-13**, **AC-14**, **AC-15**, **AC-20** to **AC-23**, **AC-28**.
- Failure case: the peer task exhausts its retries after the client run succeeded; the run stays `succeeded`, `summary.peers.status` is `failed`, the benchmark is still triggered once, the peer tables show the no peer sentence, the loss card prices the client, no alert, verifies **AC-7**, **AC-10**, **AC-14**.
- Rung: eight peers with two in the country and four in the region land on the region rung with six rows; zero kept peers gives `peers` null and `thin`, verifies **AC-7**.
- Self: a peer whose name contains the client's is dropped and listed under `dropped`, verifies **AC-8**.
- Units: a per 200 000 hours figure lands times five even when the validation call fails, verifies **AC-8**.
- Money: a client with LTIFR 6, TRIFR 10, 500 FTE, 0 fatalities gives 5.4 LTIs, 3.6 recordables and a loss of 365 715, and the same at the median rates gives the saving, verifies **AC-14** (table test in Vitest with the numbers written out).
- Peer money: BASF (111 822 heads, LTIFR 2.5, TRIFR 3.78) shows an estimated loss about fifteen times Rieter's (4 859, 3.3, 7.0) despite the lower rates, and a peer without a headcount shows no loss, verifies **AC-13**.
- Rule: each of the five recommendation outcomes from a fixture standing, verifies **AC-15**.
- Old row: a `@5` snapshot renders the outdated sentence and the rerun form, verifies **AC-18**.
- Auth: a client selecting `expert_profiles` gets zero rows; `expert_suggestions` returns no email; a client can sign an active expert's photo and not an invited one's; a member of another organization gets no `research_peers` rows, verifies **AC-9**, **AC-26**.
- Words: no "verified" in the new peer keys, verifies **AC-27**.

## Build plan

Tracer Bullet, five slices, each deployable, the thread first: the country and the peer table exist before the peer search, the search before the model, the model before the page. The estimate beside each slice is the cross check's, about six and a half hours in all after the two cuts; the owner's five hour budget was the design input and this is what it buys.

1. **Rails (90 min)**: the world catalogue and its test; the migration for `companies.currency`, the country check, the dropped `uid` check, `research_runs.peer_provider_run_id`, `research_peers` with pgTAP, `expert_profiles.countries` with the backfill, the photo policy, the three snapshot columns, the three dropped `not null`, and the drop of the four tables; delete the seed CSVs, the seed scripts, the size band catalogue and their tests; the catalogue trims; `db:reset`, `test:db`, `db:types`; the lookup, rerun and facts forms gain the country. Satisfies **AC-1**, **AC-2**, **AC-4**, **AC-9**, **AC-19**, **AC-25**.
2. **The peer task (90 min)**: `PeerSearchInput`, the peer output schema, `createPeerRun` on the Parallel and fixture providers, `research-peers.ts` with its budget, retries and `onFailure`, the code conversion, `peer-validation@1` with the self drop, the rung, the insert, `summary.peers`, the trigger hand off from `research-company`, the neutral wording. Satisfies **AC-3**, **AC-5** to **AC-8**, **AC-10**, **AC-11**.
3. **The model (90 min)**: `loss.ts`, the rewrite of `model.ts` and `snapshot.ts` to `benchmark-model@7` with the three blocks, the task loading the run's peers and inserting the new columns, the raw version in `loadLatestSnapshot` and `outdated`, the email copy, the model table tests. Satisfies **AC-12** to **AC-18**.
4. **The page (75 min)**: the four sections in order, the merged peer table with its rank sentence and footnote, the loss card and its empty state, `expert_suggestions` with its pgTAP file and the seeded experts, the cards, the package card, both catalogs. Satisfies **AC-20** to **AC-24**, **AC-26**, **AC-27**.
5. **Proof and docs (45 min)**: the e2e thread through the worker with axe, `docs/benchmark.md` rewritten, `docs/research.md` amended, the runbook's hosted spike (one live Parallel run on a known company in the owner's sector). Satisfies **AC-28**, **AC-29**.

## Migration plan

**Strategy**: big bang, one migration, one deploy. The rule "add, switch, remove later" is set aside for the four dropped tables by owner decision: nothing on `main` reads them once this merges, no client ever saw a row from them, and the only branch that does (`feat/peer-bubble-chart`) is retired, so its preview breaking is intended. Every other change is additive (nullable columns, dropped constraints, a new table, a new policy).
**Phases**:
1. Merge and deploy: the migration runs, the three tasks deploy, every existing company shows the outdated sentence with the rerun form.
2. Clients rerun when they visit; a rerun costs one of the five daily runs and brings peers and the loss.
**Rollback**: revert the commit and recreate the four tables by a forward migration from git (the seed CSVs are in history); snapshots written as `@7` are ignored by the old reader. No data a client saw is lost either way.
**Risks**: the peer search quality on the live provider is unknown until the hosted spike; the doubled Parallel spend per run; a company whose industry the client run failed to find gets no peers until the facts card is filled and the research rerun.

## Consequences

**Positive**:
- Every client in every country gets a result from one research, with no curation session before it.
- The money is the client's own number: their headcount, their rates, their currency, priced with the owner's table.
- Four tables, four CSVs, one generator, the gate and the verified pair are gone; the model has one input path.
- The peer search failing can only cost peers, never the client's figures, and that is enforced by the task boundary, not by a rule.

**Negative / tradeoffs**:
- No person has read a peer's page before a client sees it. The unit enum, the validator and the visible source link are the only guard.
- A loss figure with no visible basis is easy to dispute; the basis lives only in the runbook. The 75, the 1 200 000 and the 250 000 are one number for every currency.
- The peer money column is a total: a large safe peer shows a bigger loss than a small unsafe one, so the column reads as size as much as safety. Accepted knowingly on 14 Sep 2026; the per 100 employees form waits for approval.
- The sector quartiles and the "top quarter" wording are gone; the rank among up to eight peers is a coarser position.
- One more provider run per research doubles the search cost.
- Package prices stay CHF (spec 0011) under a loss shown in another currency until spec 0011's successor handles multi currency.

**Neutral**:
- Existing companies see a rerun prompt until their next run; no recompute is needed on deploy.
- The chart branch is retired unmerged; its component is reused or dropped per D-chart.
- Spec 0012's derived counts live on inside the loss block as the incident counts.
- The dashboard's "calculating" state now spans the peer task too; the snapshot arrives after both.

## Follow-up

- [x] **The benchmark key is per peer search, not per run** (fixed 14 Sep 2026, after PR #84): AC-7 first spelled the key as `benchmark/run/<runId>`, the same one `research-company` uses, so that however many paths fired one benchmark ran. That is right for one research run and wrong for a second peer search of it: with a 24 hour TTL, a re-search — the case being re-running a peer search after correcting `companies.industry_code` — wrote its new `research_peers` rows and was then silently deduplicated, so no snapshot was inserted and the page kept rendering the old snapshot with the old peers. The key is now `benchmark/peers/<the peer task's own Trigger.dev run id>`, which is one value across the attempts of one search and its `onFailure` hook (so AC-5's and AC-7's dedupe is unchanged) and a different value per genuine re-search. `research-company`'s own fallback keeps `benchmark/run/<runId>`: it fires only when the peer task could not be queued at all, so the two never race.
- [x] **D-chart** (decided and built 14 Sep 2026): the owner sent their own sketch, which closes the other two candidates (the ranked bar strip and the `feat/peer-bubble-chart` bubble chart). The shape: **rank across** (the discrete position 1..n, not a rate), **TRIFR up**, **bubble area is that company's own estimated yearly loss**, which satisfies the standing constraint above, and **the client is an unfilled outline** among the filled peers, since it has no published loss to size a bubble by.

  Built as UI only: `SnapshotPeerRow` already carries `trifr`, `estimatedLoss` and the name, and `inputs.kpis` carries the client's own rate, so there is no `MODEL_VERSION` bump, no migration and no recompute, and every stored `@7` snapshot draws a chart on its next render. `src/features/benchmark/ui/peer-chart.tsx` with `chart-scale.ts` lifted from the retired `feat/peer-bubble-chart` branch (whose chart drew different channels but needed the same arithmetic); mounted in `PeersSection` above the table and on the ops gallery so axe scans it.

  Two decisions taken while planning it:
  - **The peer table is re-sorted to TRIFR to match the chart.** A table ordered differently from the chart it sits under would give one reader two rankings. The stored `peers.rows` stay LTIFR sorted; the re-sort is in the page. This amends AC-20, which said the client's row is placed by its LTIFR.
  - **The area is the total estimated loss**, as sketched and as AC-13 defines it. The per 100 employees form stays the Follow-up below.

  A company that published no TRIFR gets no point but keeps its table row, and below two points the chart hides. The bubbles are real HTML buttons over the drawing, not SVG groups: Chromium leaves SVG children out of the sequential tab order, so the `<g tabIndex={0}>` form reads correctly and still cannot be tabbed to (caught in a browser, invisible to jsdom).
- [ ] **Per 100 employees**: when Phillip or a client approves, the peer money column and any chart money switch to the estimated loss per 100 employees (the same formula divided by headcount times 100), which takes company size out of the comparison; the client's own headline stays the total.
- [ ] **Request this expert** (cut on 14 Sep 2026): a member only action that alerts ops and emails the ops inbox, idempotent per company, expert and day, plus an `expert_requests` table so ops has a list. The cards ship without a button.
- [ ] **A currency control** (cut on 14 Sep 2026): the facts card lets a client pick a currency other than the country's. Until then the currency follows the country.
- [ ] Per currency constants: the 75 per hour, the 1 200 000 per fatality and the 250 000 retainer threshold are one number for the world; a per country table is the next honest step, and a client entered hourly cost after that.
- [ ] A shared peer search per sector and country rung with a 30 day freshness, once the cost per run is known.
- [ ] Hosted spike on the runbook checklist: one live research on a known company in the owner's sector on staging, the peer table compared with the source pages, the prompt bumped if needed.
- [ ] Spec 0011's successor: multi currency checkout so the package price matches the loss currency.
- [ ] `/sync`: `src/features/benchmark/AGENTS.md`, `src/features/research/AGENTS.md` and `src/features/experts/AGENTS.md` describe the removed library, the gate and the Swiss constants; the root pointer lines for specs 0008, 0012, 0016, 0021 point here.
