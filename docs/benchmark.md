# Peer benchmark and the estimated loss

The runbook for the benchmark (spec [0022](specs/0022-ai-peer-benchmark/index.md), which superseded specs 0008, 0012, 0016, 0020 and 0021 on 14 Sep 2026): how the loss is computed, where the peers come from, what a snapshot holds, and how the page is proved locally. Nothing here calls a model. The benchmark is arithmetic over the client's own figures and the peers one research run found.

The change spec 0022 made, in one line: the peers used to be a curated library of sector statistics and named companies that ops maintained in CSV files, and they are now a property of the research run. There is no library, no seed, no curator's reading and no launch gate; the four curated tables are dropped. A peer reaches a client because a research run found it in a public report and the validator supported the figure against the cited page.

## The model in words

The `benchmark-company` task (`src/trigger/benchmark-company.ts`) runs after a research run ends, after a client saves the industry, the country or the headcount, after a client saves or clears a figure, and on `pnpm benchmarks:recompute`. It reads the company, its current KPI rows (`company_kpi_current`, the newest year per KPI) and the `research_peers` rows of one run, hands them to the pure `computeBenchmark` in `src/features/benchmark/model.ts`, and inserts one immutable `benchmark_snapshots` row. The dashboard reads only that row.

1. **Inputs.** FTE equals `companies.employees_count`; every employee counts as one full time job. The NACE section comes from `sectionOfDivision(industry_code)`, the country and the currency from `companies.country` and `companies.currency` (spec 0022, AC-1, AC-2). Every amount in the snapshot is denominated in that currency.
2. **The client's three figures.** The loss reads `ltifr`, `trifr` and `fatalities` only, each the newest year on file for that key, chosen per key independently; the year used is recorded per key in `inputs.kpis`. The other five catalogue KPIs are collected by the research and shown in the table, but nothing is compared or priced from them any more.
3. **The loss**, the owner's table (AC-14), with the constants in `src/features/benchmark/loss.ts`:

   ```
   ltis         = ltifr × FTE × 1 800 ÷ 1 000 000
   recordables  = max(0, trifr − ltifr) × FTE × 1 800 ÷ 1 000 000
   loss         = (ltis × 769 + recordables × 201) × 75 + fatalities × 1 200 000
   ```

   1 800 is the working hours one FTE covers in a year, 769 the hours a lost time injury costs, 201 the hours a further recordable injury costs, 75 the cost of a working hour and 1 200 000 the cost of a death, all in the company's own currency. A TRIFR below the LTIFR contributes no recordable term rather than a negative one: a company that publishes a TRIFR under its LTIFR has counted differently, not fewer injuries than zero. Without a TRIFR the recordable term is zero and the block carries `trifrMissing: true`, which the card says in one sentence. The whole block is null when the FTE is missing or zero or the client has no LTIFR; the card then asks for the LTIFR and links to the figures card.
4. **The savings.** `atMedian` and `atBest` evaluate the same formula with each rate's peer median or best in place of the client's, for the rates present in `peers.rates`, fatalities held at the client's own count. `savingAtMedian = max(0, loss − atMedian)`, `savingAtBest` likewise; both null when there are no peers. A client already ahead of the peers has a saving of zero, not a negative one, and the card says so rather than printing a zero.
5. **The recommendation** (AC-15), first match wins: any fatality above zero or `savingAtMedian` above 250 000 gives `retainer` (reason `fatality` or `large_saving`); no LTIFR gives `sms` (`no_figures`); worse than the median on both rates gives `compliance` (`both_worse`); worse on one gives `sms` (`one_worse`); else `culture` (`both_better`). A rate absent from `peers.rates` counts as neither better nor worse.
6. **Scalars.** `confidence` is the minimum over the client rows the loss used, a null confidence counting 1 for a client entered row and 0.5 for a research row. `kpis_compared` counts the keys of `peers.rates`, so 0 to 2. `peer_provisional` is always false: there is no provisional row left to flag.
7. **Money is stored unrounded and rounded once at display**, by `roundMoney` (nearest 100 below 10 000, else nearest 1 000). Both the page (`money` in `ui/benchmark-segment.tsx`) and the task, before it hands the figures to the `benchmark_ready` email, round through that one function, so the card and the email can never disagree for one snapshot. The hourly cost and the fatality price are never rendered anywhere: they are inputs to one figure the client reads as money, not prices we quote back at them.

The known simplification, recorded as a Follow-up in the spec: the 75, the 1 200 000 and the 250 000 retainer threshold are read in the snapshot's currency without conversion, so a client in the euro area prices a death at 1 200 000 euros.

## Where the peers come from

The `research-peers` task (`src/trigger/research-peers.ts`) runs after `research-company` writes its terminal status, on the `research` queue with its own 20 minute budget and three attempts.

1. **The search.** One provider call (`createPeerRun`) asks for up to eight companies of the client's own NACE section, with `name`, `website`, `country`, `headcount`, `headcount_year` and per rate the value as printed, the unit as printed, the period year and the source page. The objective tells the provider to prefer companies headquartered in the client's country, then in its region, then anywhere, and to prefer employees only figures. `research_runs.peer_provider_run_id` is stored before the first poll, so a retry resumes the stored provider run rather than paying for a second one.
2. **The units are converted in code** (AC-8), never by the model: `per_200k_hours` and `per_100_workers` both times five, `per_million_hours` as printed. A unit outside the three is `unsupported`. This is the one arithmetic step the provider is never trusted with, because a wrong unit moves a rate by a factor of five and nothing downstream would notice.
3. **The validator** (`peer-validation@1`) makes one structured call that answers per peer and rate: supported by the cited page or not, the period year, a confidence and the supporting source indexes. A peer whose normalised name contains the client's normalised name or the reverse, or whose website host equals the client's, is dropped as `self`; a peer with no supported rate is dropped as `unsupported`. Every drop is listed in `summary.peers.dropped`. When the call fails after the SDK's retries the peers are kept with the code converted values, confidence capped at 0.5 and `summary.peers.validation = skipped`.
4. **The rung is climbed in code** (AC-7), never trusted from the provider: the peers of the client's country when at least three carry a usable rate, else the peers of the region's countries when at least three do, else every peer. The rung (`country`, `region`, `world`) and the count go to `summary.peers` and the rung is stored on every row. Fewer than three even worldwide keeps what there is with `thin = true`, and the page then replaces the rank sentence with the count it found: no rank is quoted off two peers. Zero kept peers writes `{ status: ok, found: 0, rung: null, thin: true }` and no row.
5. **The write and the hand off.** The kept rows are inserted in one statement, every row carrying a source URL and a rung, and then `benchmark-company` is triggered under `benchmark/peers/<the peer task's own Trigger.dev run id>`. That id is one value across every attempt of one search and its `onFailure` hook, so one search queues one computation, and a different value for a genuine re-search of the same run, so the re-search gets its own snapshot. Keying this on `benchmark/run/<runId>` was a bug fixed on 14 Sep 2026: a second peer search within the key's 24 hour TTL stored its new peer rows and was then silently deduplicated, leaving the page on the old snapshot. Whatever the outcome — `ok`, `skipped`, `failed` or `timeout` — the task's last step and its `onFailure` hook after the retries both trigger the benchmark, so the loss computes from the client's own figures even when the peer search found nothing. The peer task never writes `research_runs.status` or `error_code` and raises no alert; one `log.warn` line names the cause. A run is `succeeded` because it stored at least one client KPI row, as before: peers never decide a run's status.

**Which peers a later recompute uses** (AC-17): for a `research` trigger, the rows of that run. For `client_edit` and `recompute`, the rows of the company's latest `succeeded` run that has at least one peer row, else the latest `succeeded` run, which gives no rows. So a client who edits a figure keeps the peer group the research found rather than losing it.

## The snapshot

`benchmark_snapshots` (`supabase/schemas/26_benchmark_snapshots.sql`) is a tenant table with the full contract, readable by members and assigned experts, written only by the task as the service role. `model_version` names the rule set and the block schema (`MODEL_VERSION` in `src/features/benchmark/catalogue.ts`, `benchmark-model@7`).

The body is three blocks and the inputs:

- `inputs`: FTE, section, industry code, country, currency, `companyUpdatedAt` and one entry per KPI row the loss read (id, key, value, year, source, confidence, run id).
- `peers`: null when no peer was kept, else `{ rung, thin, rows, rates }`. `rows` lists every kept peer once, sorted by LTIFR ascending with peers lacking an LTIFR last, each `{ peerName, country, headcount, periodYear, ltifr, trifr, sourceUrl, confidence, estimatedLoss }`. `rates` holds, per rate with at least one peer value, the `count`, `median`, `best`, `rank`, `of` and `gapToMedian`.
- `loss`: the block of rule 3 and 4, or null.
- `recommendation`: `{ packageKey, reason }`.

**A peer's `estimatedLoss` is that peer's own yearly loss**, by the same formula, with the peer's published headcount and rates (a rate the peer did not publish counts as zero for its term), the same constants and the client's currency; null when the peer's headcount is unknown. It is a **total**, so it grows with the peer's size: a 5 400 employee peer shows a larger figure than a 240 employee one at the same rates, which is arithmetic and not a judgement. That is the owner's decision of 14 Sep 2026, kept until Phillip or a client approves the per 100 employees form (spec 0022, Follow-up). The table's footnote says so in the client's own words.

**`SNAPSHOT_SCHEMAS` in `snapshot.ts` holds `@7` only.** The `@1` to `@6` schemas went with the rewrite, along with the `results`, `gaps`, `cost` and `derived` blocks, `POSITIONS`, `PEER_SHAPES`, the quartile position, the exposure count and the CHF range. `loadLatestSnapshot` returns the raw `model_version` beside the parsed blocks and `benchmarkStateOf` answers `outdated` for any row whose version is not `benchmark-model@7`, or whose blocks fail their own schema (that case is reported to Sentry). Nothing from an unreadable row is ever rendered.

The `benchmark_snapshots` columns that carry the new figures are `currency`, `loss_amount` and `saving_at_median`; the CHF named columns stay and are null from `@7` on, and `results`, `gaps` and `assumptions` lost their `not null` and are null from `@7` on. Snapshots are insert only, so nothing stored is ever rewritten.

**No recompute runs on deploy** (AC-18). Every company that has a snapshot from before the deploy shows the outdated sentence and the rerun form on `/app`, and a rerun replaces the row with a `@7` one computed against a real peer group. `pnpm benchmarks:recompute` still exists and still triggers `benchmark-company` for every company with a snapshot, but running it after this deploy would only rewrite old rows against whatever peers the company's last run happens to hold, which for a pre spec 0022 company is none. Rerunning the research is the upgrade path, not a recompute.

## The dashboard states

Derived, never stored:

- `outdated`: the newest snapshot is of a model version this code no longer reads. One sentence plus the rerun form, and nothing of the stored row.
- `noData`: a readable snapshot with neither a loss nor peers. The alert plus the "Your figures" card, so entering a figure by hand is the remedy beside the alert.
- `ready`: any other readable snapshot. The sections in the order AC-20 to AC-23 fix, the chart its own card under the peer table.
- `calculating` / `unavailable`: no snapshot, with a run that succeeded, a company edit or a client figure save younger than two minutes (`BENCHMARK_WAIT_MS`), or older.

## The page, in order

`src/features/benchmark/ui/benchmark-segment.tsx`, five cards then the facts card:

1. **The peer benchmark** (AC-20). One badge with the peer count and the rung named (the country by name, the region by its label, or worldwide), one rank sentence carrying both ranks, then **one** table with the columns company (headcount under the name), country, year, LTIFR, TRIFR, estimated loss and a source link that opens the page in a new tab. **The client's own row is highlighted in place by its TRIFR**, so the table reads as one ranking rather than a list with the reader appended; without a TRIFR there is no place to put them and the row is left out, which is the same condition that empties the rank sentence. One footnote, and never the word "verified" — the forbidden word test of spec 0021 still guards the peer keys.

2. **The chart**, its own card ("Where you sit") directly under the table (owner call of 14 Sep 2026; it was drawn inside the peer card at first, which made one card carry two things). The D-chart of the owner's own sketch (`src/features/benchmark/ui/peer-chart.tsx`): the **rank across** (the position 1..n, not a rate), **TRIFR up**, and **each company's own estimated yearly loss as the bubble's area**, which is the standing constraint that any area or height showing money shows the peer's own loss of AC-13. The peers are filled and **the client is an unfilled outline**, because it has no published loss to size a bubble by. The area is the *total* loss, so it grows with company size; the footnote under the table says so, and the per 100 employees form is still a Follow-up. Only a company that published a TRIFR gets a point — a TRIFR ranking has no place for one that did not — so the chart can show fewer companies than the table, and below two points the whole card does not render and the table stands alone.

   Both cards read one `rankedRows`, so the table and the chart can never disagree: they draw one ranking, and neither computes its own. The sort is by TRIFR **in the page**, not in the model — `peers.rows` stays sorted by LTIFR ascending as the snapshot stores it, because changing that is a model change and a version bump for an ordering only the page cares about.

   The drawing is hand drawn SVG, not Recharts, and **the server formats every string** while the client component draws pixels only: a grouped figure formatted in a client component renders `1'929` on Node and `1’929` in the browser, which fails hydration and leaves the component inert. Each bubble is **a real HTML button positioned over its mark**, never an SVG `<g tabIndex={0}>`: Chromium leaves SVG children out of the sequential tab order, so bubbles built that way take focus programmatically and read correctly to a screen reader but cannot be reached by the Tab key at all. jsdom focuses anything, so only a browser catches that; the unit test asserts every bubble is a `BUTTON` as the part jsdom can check.
3. **The estimated loss** (AC-21). The loss per year as the headline, the saving at the median and at the best peer, and the three counts behind it each with a "Calculated" badge. The empty state asks for the LTIFR and links to the figures card.
4. **The experts** (AC-22). Three cards from `public.expert_suggestions(section, country, region_countries)`, a `security definer` function that returns at most three `active` experts whose `industries` contain the section, by the same ladder the peers climb, ordered by availability then years of experience descending. It returns only the id, full name, headline, industries, countries, languages, availability and photo path — no email, no notes, no status — and a storage select policy lets any signed in user read an `expert-photos` object whose owning expert is `active`, so the photo is signed with the caller's own client. The sentence above the cards says ops assigns the expert after a package is bought; there is no button (Follow-up).
5. **The package** (AC-23). The recommended package's own marketing copy, the one sentence from `reason`, and the buy button into the existing checkout; `retainer` shows the enquiry link instead of a price. The other packages are one link to the pricing page.

The read only view an assigned expert sees stops after the loss: they are not being sold a package or shown three colleagues to choose between.

## Client figures

Feature 10 (spec 0010) lets a client type the catalogue KPIs by hand in the "Your figures" card under the KPI table (`src/features/self-assessment/`). The rules worth knowing are unchanged by spec 0022, except that only the LTIFR, the TRIFR and the fatality count now move the loss:

- **One year per save.** The picker offers one contiguous run of years, newest first, from the current `Europe/Zurich` year down to the smaller of four years back and the oldest year on file, never below 2000. Every figure in the form belongs to that year.
- **The view decides what is current.** A client value is an ordinary `company_kpis` row with `source 'client'`, no run and no confidence; `company_kpi_current` puts it before the research row of the same year, so the table, the coverage line and the benchmark follow without any app logic. The table marks such a cell "Your figure" instead of a confidence badge.
- **Clearing is a delete.** The clear button beside a field deletes the client row; the research row of that year, when there is one, is current again by the view's ordering.
- **The write path works around the partial index.** The client unique index is partial (`where source = 'client'`), which PostgREST cannot upsert onto, so `saveClientKpis` reads the existing client rows for the sent keys, updates each by id (zero rows means another member created it: `forbidden`) and inserts the rest in one statement; a `23505` on that insert is a second tab racing and answers `conflict`. Only fields the client changed reach the action.
- **Two idempotency keys.** A save triggers `benchmark-company` under `benchmark/kpis/<companyId>/<newest updated_at the writes returned>`, a clear under `benchmark/kpis-clear/<deleted row id>`, both with a one hour TTL.
- **Policies are per creator.** Members update and delete only client rows they created; feature 22 (client team invitations) relaxes both policies to organization scope.

## The rails around the tasks

- `research-company` triggers `research-peers` after its terminal write, and falls back to triggering `benchmark-company` itself when that trigger fails, so a benchmark is always queued.
- `research-peers` triggers `benchmark-company` under `benchmark/peers/<its own Trigger.dev run id>` from both its last step and its `onFailure` hook, which share that id; a re-search of the same run is a new id and so writes its own snapshot.
- `updateCompanyFacts` triggers it under `benchmark/edit/<companyId>/<updated_at>` (one hour TTL); `saveClientKpis` and `clearClientKpi` as above.
- The company's first snapshot sends the `benchmark_ready` email to every member (one delivery per member, key `benchmark-ready/<companyId>/<userId>`), stating the loss and the saving in the snapshot's currency; a retry that inserts a second row is not first, so the email is never sent twice.
- A benchmark task that fails after its retries raises the `benchmark.failed` Slack alert with the Trigger.dev run page; the dashboard keeps showing the previous snapshot. A peer task failure raises nothing.

## Local proof and the worker

The whole thread runs without a vendor. With `supabase start` and `pnpm dev` up:

```bash
pnpm trigger:dev                 # RESEARCH_PROVIDER=fixture in .env.local
TRIGGER_DEV_RUNNING=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e e2e/benchmark.spec.ts
```

`e2e/benchmark.spec.ts` (AC-28) drives the real chain: the lookup form with its required country, the client run, the peer search, the conversion, the rung and the benchmark task, then the page section by section with axe on every state. What the fixture makes true, so the spec's numbers are arithmetic rather than magic:

- The client is 420 employees in NOGA 23.61 (section C) in CH, LTIFR 2.4 and TRIFR 6.1 for the latest fixture year.
- The peer search answers eight companies: five in the client's country, two in its region, one outside it. Three of the five carry a usable rate, so the run lands on the **country** rung and those five are the whole peer set.
- Three units appear among them, so the code conversion is exercised on every fixture run: a printed `per_200k_hours` 0.9 must render as 4.50 and a `per_100_workers` 1.4 as 7.00.
- The client leads on both rates, so the saving is zero, the card says "You are already at or below the peer figures" and the standing recommends `culture`.
- A company name containing `thinpeers` gives two peers, both outside the region, so the rung falls to `world`, `thin` is true and the rank sentence is replaced by the count.
- `supabase/seed.sql` seeds three active section C experts with `countries = {CH}`, so the expert cards have something to show; they differ in availability and years of experience on purpose, because that pair is what `expert_suggestions` orders by once the country rung has matched.

Two things to know when running the worker locally:

- Only one `trigger dev` may be connected to the dev environment at a time; a second one (another checkout, another terminal) takes the runs and the first one never sees them.
- The Trigger.dev dev environment's own variables apply to the worker and an env file value overrides them, but an empty env file value does not. When the dev environment carries `RESEND_API_KEY` and `EMAIL_ALLOWED_RECIPIENTS`, a test address is skipped as `not_allowlisted` and the delivery row still proves the send. Do not lift the allowlist in a worker env file while the Resend key is set: the sends then go out for real. The worker also holds the SMTP connection, so `tests/trigger/send-email*.local.test.ts` fail while it runs; that pair is expected to be red locally.

## Hosted spike, owed before the first real client

Everything above is proved on the fixture provider. One live run on a real company is what tells us whether the peer search is worth its cost, and it has not been run.

- [ ] **The spike**: on staging, with `PARALLEL_API_KEY` set and `RESEARCH_PROVIDER` unset, run one research on a known company in the owner's sector (a Swiss manufacturer of 200 to 1 000 employees with a published sustainability report). Then read, on the Trigger.dev run and in the database:
  - how many peers the provider returned, how many the validator supported, and which rung the run landed on. Fewer than three supported peers in Switzerland is the outcome to expect from the sector statistics work of spec 0021 (Swiss companies publish per 1 000 full time equivalents, not per million hours), and it is the single most load bearing unknown in this spec.
  - whether the units the provider reported match what the source pages print. A unit the model guessed rather than read is the failure that moves a rate by five, and the only way to see it is to open two or three of the cited pages.
  - whether any peer is the client itself under another name, and whether the self drop caught it.
  - `summary.peers.durationMs` and the Parallel run cost beside the client run's, so the owner can decide whether the peer search stays on every run or becomes a separate, rarer step.
- [ ] **Then**: if the country rung is empty in practice, the decision owed is whether the region rung is honest enough to lead with, or whether a thin run should say so more loudly than one sentence. That is an owner decision, not a code change to make first.

`docs/research.md` carries the per environment checklist the spike belongs to (Parallel, the AI Gateway, the schedule, Slack, the Vercel firewall rule).
