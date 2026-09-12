# Client funnel · SME24

Part of the [SME24 scope](index.md). The free half of the promise: a client signs in, enters a company name, and sees its EHS risk benchmarked against its own country's figures and priced in its own currency (Swiss figures and CHF first; Slice 10 opens the other countries). Slice 1 is the walking skeleton, the thinnest real thread through auth, database, background jobs, AI and UI. Later slices thicken it.

## Slice 1: Core loop (the walking skeleton)

### 6. Auth, organizations & roles · in-progress
Real sign in from day one. A client signs up and lands in an organization for their company; experts and ops sign in to their own areas. Roles (client member, expert, ops) gate every route and every row. One member per organization for now; invitations arrive in Slice 8.
**Done when:** a new client can sign up, sign in and sign out; each role sees only its own area; a signed out visitor is redirected; sessions survive a refresh.
spec [0005](../specs/0005-auth-organizations-roles/index.md)
- [x] Design it (spec): `/architect auth, organizations & roles`
- [ ] Build it: `/develop auth, organizations & roles` · code in `src/features/auth/`, `src/app/[locale]/{sign-up,sign-in,verify-code,forgot-password,reset-password,app/onboarding}/`, `src/app/api/auth/`, `src/proxy.ts`, `scripts/invite-user.mts`, `supabase/templates/`
  - [x] Consent column and the sign up thread: migration with `terms_accepted_at` and `accept_terms()`, route map and error map, the session helpers and the confirm handler, the proxy restructure, password sign up end to end through Mailpit (AC-1, AC-3, AC-8, AC-11, AC-12, AC-13)
  - [x] Onboarding and the rebuilt sign in: `/app/onboarding` for clients without an organization, sign in on the typed action pattern with the unconfirmed and expired link states (AC-3, AC-5, AC-8, AC-11, AC-12)
  - [x] Email code, password reset, sign out and sessions: `/verify-code` with the OTP primitive, forgot and reset pages, local sign out, refresh proven (AC-2, AC-4, AC-6, AC-7, AC-9)
  - [x] Staff invites and providers: the `pnpm user:invite` script, Google and Microsoft with the callback handler, `docs/auth.md` setup checklist (AC-5, AC-10)
  - [ ] Hosted configuration: the five bilingual templates, password rules and leaked password protection on staging and prod, axe over every new page (AC-1, AC-6, AC-13) · Resend SMTP deferred to feature 7 on 5 Sep 2026 until a sending domain exists (`docs/auth.md`) · staging holds the settings as code since 6 Sep 2026 (`supabase/config.toml` pushed on deploy: site URL, Resend SMTP, the templates, Google on); still open: Microsoft on staging, leaked password protection (Pro plan), and production, which feature 26 creates
- [x] Verify it: `/check verify auth, organizations & roles`
- [x] Test it: `/test auth, organizations & roles`
- [x] Review it (fresh model): `/check review auth, organizations & roles`
- [x] Document it: `/document auth, organizations & roles`

### 7. Transactional email & ops alerts · done
The messages every step of the flow relies on: sign in links if auth uses them, benchmark ready, payment receipt, expert assigned, gap report ready, all in the recipient's language. Plus alerts to your team when a payment lands, a research run fails, or a retainer enquiry arrives.
**Done when:** each event in the flow sends the right email in German or English within a minute; ops alerts reach your team channel; failed sends are visible to ops.
spec [0006](../specs/0006-transactional-email-ops-alerts/index.md)
- [x] Design it (spec): `/architect transactional email & ops alerts`
- [x] Build it: `/develop transactional email & ops alerts` · code in `src/lib/email/`, `src/lib/alerts/`, `src/trigger/`, `src/features/emails/`, `src/app/[locale]/admin/emails/`, `src/app/api/webhooks/resend/`, `supabase/schemas/`, `docs/email.md`
  - [x] Thin thread to Mailpit: `email_deliveries` and `notifications` migration with pgTAP, the template registry with the shared layout and the `welcome` template, the `send-email` task on the SMTP transport, `ensureOrganization` returning the organization id and triggering the send (AC-1, AC-3, AC-4, AC-5, AC-13, AC-14, AC-15)
  - [x] Hosted transport and delivery status: the Resend transport, the allowlist, error classification and retries, the signed webhook route with the forward only status rule (AC-5, AC-6, AC-7, AC-8)
  - [x] Alert rail: the alert registry with live and reserved kinds, the Block Kit builder, the `ops-alert` task, the new client and failed email alerts (AC-2, AC-7, AC-11)
  - [x] Ops surface: `/admin/emails` with filters, keyset paging and Realtime, the detail page with the sandboxed preview and retry, the test email and test alert buttons, route map, navigation and messages (AC-9, AC-10)
  - [x] Retention, previews, tests and the checklist: the weekly purge schedule, `pnpm email:dev` previews, Vitest and the Playwright welcome flow behind the local worker, `docs/email.md` (AC-12, AC-14)
- [x] Verify it: `/check verify transactional email & ops alerts`
- [x] Test it: `/test transactional email & ops alerts`
- [x] Review it (fresh model): `/check review transactional email & ops alerts`
- [x] Document it: `/document transactional email & ops alerts`

### 8. Company lookup & research pipeline · done
The core thread. A client enters a company name, a background pipeline researches public disclosures, extracts safety KPIs with sources, and stores them. The dashboard shows the run's progress and the extracted KPIs when it finishes. Real database, real jobs, real AI, narrow scope: KPIs only, no benchmark yet.
**Done when:** entering a company name starts a background run visible in the dashboard; within a few minutes the run stores KPIs with source references and the dashboard renders them; a failed or empty run shows a clear state the client can act on.
spec [0007](../specs/0007-company-research-pipeline/index.md) · code in `src/features/research/`, `src/lib/research/`, `src/lib/ai/`, `src/trigger/research-company.ts`, `src/trigger/sweep-research-runs.ts`
- [x] Design it (spec): `/architect company lookup & research pipeline`
- [x] Build it: `/develop company lookup & research pipeline`
  - [x] Thin thread on the fixture: the migration (KPI seed, `provider_run_id`, the open run index, the quota helper, the insert and update policies) with pgTAP, the catalogue and schemas, `requestResearch`, the lookup form on `/app`, the fixture provider, the `research-company` task writing KPI rows, the live dashboard with the progress list and the KPI table (AC-1, AC-2, AC-3, AC-9, AC-12, AC-6 and AC-7 in part)
  - [x] Real provider (proven on a real Parallel run for Geberit AG on 6 Sep 2026, 18 KPIs from 11 sources in 4.4 minutes): the basis spike, the Parallel SDK provider with the output schema, poll and resume on `wait.for`, error classification, env and structured logs (AC-4, AC-10, AC-13, AC-15, AC-16)
  - [x] Validation pass: `src/lib/ai/` on the AI SDK through the gateway, the validation schema and prompt, the unit, range and conflict rules, the skipped fallback, the company facts write (AC-5, AC-6, AC-7, AC-13)
  - [x] Failure rail and reruns: the `onFailure` hook with error codes, the `research.run_failed` alert with the Trigger.dev link, the stale sweep schedule, `rerunResearch` and the empty and failed states (AC-8, AC-10, AC-11)
  - [x] Hardening and docs: Vitest, pgTAP and the Playwright fixture thread with axe, the design gallery section, `docs/research.md` with the hosted checklist (AC-1, AC-12, AC-14, AC-16)
- [x] Verify it: `/check verify company lookup & research pipeline`
- [x] Test it: `/test company lookup & research pipeline`
- [x] Review it (fresh model): `/check review company lookup & research pipeline`
- [x] Document it: `/document company lookup & research pipeline`

## Slice 2: Show the opportunity

### 9. Peer benchmark & CHF opportunity · done
Thickens the dashboard segment. Extracted KPIs are compared against industry peers, the highest priority gaps are ranked, and the annual cost of incidents is estimated in CHF so the client sees the size of the saving. The peer data set, the cost model and how confidence is shown are the decisions.
**Done when:** the dashboard shows the company's position against peers per KPI, a ranked list of priority gaps, and an annual incident cost estimate in CHF with its assumptions visible; the numbers are traceable to stored inputs.
spec [0008](../specs/0008-peer-benchmark-chf-opportunity/index.md) · code in `src/features/benchmark/`, `src/trigger/benchmark-company.ts`, `supabase/schemas/24_benchmarks.sql` to `26_benchmark_snapshots.sql`, `supabase/seed-data/`
- [x] Design it (spec): `/architect peer benchmark & CHF opportunity`
- [x] Build it: `/develop peer benchmark & CHF opportunity`
  - [x] Thin thread: the three table migration with pgTAP, the provisional seed CSVs with the generator, the NOGA and size band catalogue, the pure model with its table tests, the `benchmark-company` task triggered from the research run, the snapshot query with the waiting states, the dashboard segment (opportunity card, top three gaps, positions with `QuartileBand`) and the Realtime channel (AC-1, AC-2, AC-3, AC-4, AC-5, AC-18, AC-6 in part, AC-9, AC-12, AC-15, AC-14 in part)
  - [x] Transparency and client inputs: the "How this is calculated" disclosure on a `Collapsible` (cut again on 13 Sep 2026, owner decision; the facts form stayed as its own card), `updateCompanyFacts` with the grouped NOGA division picker and the headcount field, the missing input states, the percent rule (AC-10, AC-11, completes AC-6 and AC-9)
  - [x] Moments and the failure rail: the `benchmark_ready` email on the first snapshot per company and member, the `benchmark.failed` alert with the `onFailure` hook (AC-7, AC-8)
  - [x] Ops tooling, hardening and docs: the recompute script, the gallery sections, Vitest, pgTAP and the Playwright thread with axe, `docs/benchmark.md` with the source checklist and the launch gate (AC-13, AC-16, AC-17, completes AC-14)
- [x] Verify it: `/check verify peer benchmark & CHF opportunity`
- [x] Test it: `/test peer benchmark & CHF opportunity`
- [x] Review it (fresh model): `/check review peer benchmark & CHF opportunity`
- [x] Document it: `/document peer benchmark & CHF opportunity`

### 10. Self assessment fallback · done
When the pipeline finds little or nothing, or the client wants to correct it, the client fills in the same KPIs by hand and the benchmark recalculates. Extends the KPI schema and dashboard from features 8 and 9.
**Done when:** a client can enter or edit each KPI in a form with validation, the benchmark and CHF estimate update, and the dashboard shows which values came from research and which from the client.
spec [0010](../specs/0010-self-assessment-fallback/index.md) · code in `src/features/self-assessment/`, `e2e/self-assessment.spec.ts`, the `selfAssessment` namespace, the `kpiRows` field of `getCompanyDashboard` and the badge in `src/features/research/ui/kpi-table.tsx`
- [x] Design it (spec): `/architect self assessment fallback`
- [x] Build it: `/develop self assessment fallback`
  - [x] Thin thread: the schema, the year rules, the save action with the read then write path and the `client_edit` trigger, `kpiRows` on the dashboard query, the "Your figures" card in every run state, the "Your figure" badge in the KPI table, the third moment in `benchmarkStateOf`, the `selfAssessment` catalogs (AC-1, AC-2, AC-4, AC-5, AC-8, AC-9, AC-10, AC-13, AC-3 in part)
  - [x] Thicken the form: prefill captions per source, the refill on a year change, typed fields with comma decimals and the yes or no select, the clear action with its per field button, the older year hint, the conflict and error states, axe (AC-3, AC-6, AC-7, completes AC-1)
  - [x] Harden and document: Vitest tables and component tests, the action tests, the pgTAP assertion, the `seedCompanyKpi` helper and the Playwright thread with axe, the "Client figures" section in `docs/benchmark.md` (AC-11, AC-12)
- [x] Verify it: `/check verify self assessment fallback`
- [x] Test it: `/test self assessment fallback`
- [x] Review it (fresh model): `/check review self assessment fallback`
- [x] Document it: `/document self assessment fallback`

### 27. Derived injury counts · done
The bridge between a rate and the CHF figure. The dashboard works out roughly how many recordable and lost time injuries a year the company's own rates and headcount imply, and shows them above the opportunity figure with a "Calculated" badge so they never read as researched or client entered. No new KPI: the counts live in a new block of the benchmark snapshot, not in `company_kpis`.
**Done when:** a company with rates and a headcount sees both counts in the opportunity card, each marked calculated and naming the figure and year it came from; a company missing an input sees only what can be worked out; and a snapshot written before the change still renders.
spec [0012](../specs/0012-derived-injury-counts/index.md) · code in `src/features/benchmark/` (`model.ts`, `snapshot.ts`, `ui/benchmark-segment.tsx`) and `src/trigger/benchmark-company.ts`
- [x] Design it (spec): `/architect derived injury counts`
- [x] Build it: `/develop derived injury counts`
  - [x] Version safety and the column: the literal keyed `SNAPSHOT_SCHEMAS` restructure landed on its own, the nullable `derived jsonb` migration with the pgTAP check, the v2 block schemas and the `MODEL_VERSION` bump, the four pinned test literals moved deliberately (AC-12, AC-13)
  - [x] The derivation: `exposureCount` lifted out of `costAt` dispatching on rate shape, the derived block in `computeBenchmark` with the Suva fallback and the missing input guards, `hours_per_fte` registered as used, the block carried through the `benchmark-company` parse and insert (AC-1, AC-2, AC-4, AC-6, AC-7, AC-9, AC-10, AC-11, AC-15, AC-16)
  - [x] The card and its strings: the block in the opportunity card above the CHF figure, lost time then recordable at one decimal, the outline `Calculated` badge with its gallery section, the provenance lines including the Suva variant, both catalogs (AC-1, AC-2, AC-3, AC-5, AC-8)
  - [x] Harden and document: Vitest over the model and the version map, the Playwright assertion with axe, `docs/benchmark.md` and the post deploy recompute note (AC-13, AC-14)
- [x] Verify it: `/check verify derived injury counts`
- [x] Test it: `/test derived injury counts`
- [x] Review it (fresh model): `/check review derived injury counts`
- [x] Document it: `/document derived injury counts`

## Slice 8: Thicken the accounts

### 22. Client team invitations
Several people per client company. A member invites colleagues by email, they join the same organization with a role, and an owner can remove them.
**Done when:** an invited colleague joins the inviting company's organization through the emailed link, sees the same dashboard, and an owner can change roles or remove members; expired or reused links fail safely.
Carried over from earlier specs: members join only through `public.add_organization_member` (spec 0002); before the build starts, relax the `company_kpis` update and delete policies for client rows from creator to organization scope and update `company_kpis.test.sql` (spec 0010).
- [ ] Build it: `/develop client team invitations`

### 23. In app notification center · Beta
A bell in the dashboard with unread items mirroring the emails: benchmark ready, assessment scheduled, expert assigned, gap report ready, program updated. Works for clients and experts.
**Done when:** each notified event appears in the bell with an unread count, opening an item marks it read and deep links to the right page, and the list is scoped to the user's organization.
- [ ] Build it: `/develop in app notification center`

## Slice 10: Europe, country by country

The 13 Sep 2026 market decision (regulated companies in Europe, Switzerland first, a wider region later) turns the Swiss specifics into the first country. These rows make the country a real input and put named companies beside the sector statistics. Build order (owner decision of 13 Sep 2026, after the country spec was written): the named peers of feature 30 first, because the peers and the companies are the product; feature 29 (spec 0020, already written) follows, and feature 31 after it. Feature 30 needs from the country only what exists today, `companies.country` with its Swiss default, so it does not wait for 29.

### 29. Client country as a benchmark input · in-progress
Today every company is Swiss by default (`companies.country` defaults to `CH`), the benchmark reads the Suva and Eurostat rows for Switzerland and the cost model prices the gap in CHF with Swiss assumptions. This row makes the country a real input: the research or the client sets it, the peer lookup picks that country's national sector table (Eurostat publishes accidents by NACE section for every EU member, so the industry code already carries across), the cost model prices in that country's currency with that country's wage, hours and absence assumptions, and a country without a seeded table says so rather than borrowing the Swiss one. Which countries get a table first, how the assumption rows split per country and how a currency travels through the snapshot, the email and the marketing example are the decisions.
**Done when:** a company carries a country the client can confirm or correct; the benchmark for a German company compares against Germany's sector rows and prices the gap in EUR with German assumptions; a country with no seeded table shows "no national figure yet" for that country and never a Swiss value; existing Swiss snapshots render unchanged; and the launch gate lists which countries are covered.
spec [0020](../specs/0020-client-country-benchmark-input/index.md)
- [x] Design it (spec): `/architect client country as a benchmark input`
- [ ] Build it: `/develop client country as a benchmark input`
  - [ ] The catalogue and the thin thread: `src/lib/countries.ts`, the country select at lookup and on the facts card with `Intl.DisplayNames` labels, the lookup writes the chosen code, the research prompt asks for the NACE division and a canton only for CH (AC-1, AC-2, AC-3)
  - [ ] Schema, seed and model: `country` on peer, assumption and snapshot rows with defaults, the renamed assumption keys beside the old two, `benchmark-model@5` with country, currency and the stored skipped cost, the task filters by country, the reader normalises old rows to CH and CHF, no recompute owed (AC-4 to AC-8, AC-17)
  - [ ] The surfaces: money in the snapshot currency on the card, gaps, positions and the `benchmark_ready` email, the country named, the per country pending text, the uncovered country no data text, the grouped select, the byte identical Swiss render test (AC-9 to AC-13)
  - [ ] Germany, the gate and the runbook: the DE peer rows read from DGUV and the Eurostat API by hand, the four DE assumptions, the coverage gate query, the "Adding a country" runbook section with the recorded requests, the German fixture thread end to end (AC-14 to AC-16, AC-18, AC-19)
- [ ] Verify it: `/check verify client country as a benchmark input`
- [ ] Test it: `/test client country as a benchmark input`
- [ ] Review it (fresh model): `/check review client country as a benchmark input`
- [ ] Document it: `/document client country as a benchmark input`

### 30. Named published peers · in-progress
Today's peers are nameless sector statistics. This row puts at least three named companies next to the client's figures: companies in the same industry, from any country, that print their LTIFR, TRIFR, lost days or ISO 45001 status in a public report, each with its country, report year, basis (employees only or including contractors) and the source page. They are chosen by a geography ladder, the client's country first, then its region, then Europe, then the world, and the industry never widens before the geography does. The client sees a rank card (the rank among the published peers, the gap to the safest, a table with the client's own saving at each peer's figure) and a bubble chart (frequency across, severity up, headcount as bubble area). Money appears only on the client's own row, never as an estimate against a named company. The peer library is curated by ops, drafted by the research provider where that helps, and an unverified row never reaches a client. Design reference: the Peer Standing page (artifact `3ef5da7c-9080-44f9-8405-b49b75a2cbc5`, indexed in the local `docs/artifacts/README.md`). Four owner calls wait in that page for `/architect`: whether larger listed peers are an acceptable comparison for a 300 person client, where the ladder stops by default, whether money is priced per peer or only at the safest, and whether the chart is client facing or expert only at first.
**Done when:** a company in a covered industry sees, per KPI with named peers, its rank among at least three published companies with the rung the ladder reached written under the table; every peer row shows country, year, basis and a link to its source page; a rate per 200,000 hours is converted to per million before it is compared; fewer than three even worldwide reads "no published peer yet"; the bubble chart has a keyboard focus ring per bubble and a table for screen readers; a point sector row still never says "median"; and the launch gate blocks an unverified peer row the way it blocks a provisional sector row.
spec [0021](../specs/0021-named-published-peers/index.md)
- [x] Design it (spec): `/architect named published peers`
- [ ] Build it: `/develop named published peers`
  - [ ] The thin thread: the whole country catalogue with regions and currencies, the two peer tables with pgTAP, both CSVs with three verified manufacturers, the seed script extension, the task's library read, `benchmark-model@5` with the ladder's happy path and the `peers` block, a first rank card in place of the LTIFR row (AC-1, AC-2, AC-3, AC-5, AC-9)
  - [ ] The rules: freshness, latest year, basis preference, the four rungs and the minimum of three, rank ties, the gap to the best, the ISO share, the saving per peer on one arm, the unknown country rule, the unit conversion (AC-6, AC-7, AC-8, AC-13)
  - [ ] The card: the strip with its screen reader sentence, both rank line shapes, the rung sentence, the linked rows, the no saving text, the gallery section, both catalogs, the forbidden word test on the new keys, the "no published peer yet" text (AC-10, AC-11, AC-12)
  - [ ] Curation, gate and thread: manufacturing and construction peers read and verified, the third gate query, the "Peer library" runbook section, the recompute obligation, the fixture thread end to end (AC-4, AC-14, AC-15, AC-16, AC-17)
- [ ] Verify it: `/check verify named published peers`
- [ ] Test it: `/test named published peers`
- [ ] Review it (fresh model): `/check review named published peers`
- [ ] Document it: `/document named published peers`

### 32. Peer bubble chart · planned
The picture the Peer Standing page promised, split out of feature 30 after its cross check (spec 0021 AC-11, owner decision of 13 Sep 2026): one hand drawn SVG under the positions with LTIFR across, lost days per incident up and headcount as bubble area, the client always drawn, a dashed line at the sector median where one exists, a focusable element per bubble with a tooltip on hover and focus, and a table for screen readers. The snapshot already carries the peers it draws (`chart.peerKeys`), so no model version moves. The contract is written in the spec's rationale under "The chart slice".
**Done when:** a client in manufacturing sees the chart under the positions with at least three published peers that print both figures; every bubble is reachable by keyboard and named by the screen reader table; the chart is hidden with one sentence when the client or the peers lack a figure; axe passes on the client page and the gallery. Gated on the curation of feature 30 yielding three such peers. `from spec 0021`
- [ ] Build it: `/develop peer bubble chart`
