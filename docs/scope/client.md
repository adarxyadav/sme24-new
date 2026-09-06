# Client funnel · SME24

Part of the [SME24 scope](index.md). The free half of the promise: a client signs in, enters a company name, and sees its EHS risk benchmarked in CHF. Slice 1 is the walking skeleton, the thinnest real thread through auth, database, background jobs, AI and UI. Later slices thicken it.

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
  - [ ] Hosted configuration: the five bilingual templates, password rules and leaked password protection on staging and prod, axe over every new page (AC-1, AC-6, AC-13) · Resend SMTP deferred to feature 7 on 5 Sep 2026 until a sending domain exists (`docs/auth.md`)
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

### 9. Peer benchmark & CHF opportunity · in-progress
Thickens the dashboard segment. Extracted KPIs are compared against industry peers, the highest priority gaps are ranked, and the annual cost of incidents is estimated in CHF so the client sees the size of the saving. The peer data set, the cost model and how confidence is shown are the decisions.
**Done when:** the dashboard shows the company's position against peers per KPI, a ranked list of priority gaps, and an annual incident cost estimate in CHF with its assumptions visible; the numbers are traceable to stored inputs.
spec [0008](../specs/0008-peer-benchmark-chf-opportunity/index.md) · code in `src/features/benchmark/`, `src/trigger/benchmark-company.ts`, `supabase/schemas/24_benchmarks.sql` to `26_benchmark_snapshots.sql`, `supabase/seed-data/`
- [x] Design it (spec): `/architect peer benchmark & CHF opportunity`
- [ ] Build it: `/develop peer benchmark & CHF opportunity`
  - [x] Thin thread: the three table migration with pgTAP, the provisional seed CSVs with the generator, the NOGA and size band catalogue, the pure model with its table tests, the `benchmark-company` task triggered from the research run, the snapshot query with the waiting states, the dashboard segment (opportunity card, top three gaps, positions with `QuartileBand`) and the Realtime channel (AC-1, AC-2, AC-3, AC-4, AC-5, AC-18, AC-6 in part, AC-9, AC-12, AC-15, AC-14 in part)
  - [x] Transparency and client inputs: the "How this is calculated" disclosure on a `Collapsible`, `updateCompanyFacts` with the grouped NOGA division picker and the headcount field, the missing input states, the percent rule (AC-10, AC-11, completes AC-6 and AC-9)
  - [ ] Moments and the failure rail: the `benchmark_ready` email on the first snapshot per company and member, the `benchmark.failed` alert with the `onFailure` hook (AC-7, AC-8)
  - [ ] Ops tooling, hardening and docs: the recompute script, the gallery sections, Vitest, pgTAP and the Playwright thread with axe, `docs/benchmark.md` with the source checklist and the launch gate (AC-13, AC-16, AC-17, completes AC-14)
- [ ] Verify it: `/check verify peer benchmark & CHF opportunity`
- [ ] Test it: `/test peer benchmark & CHF opportunity`
- [ ] Review it (fresh model): `/check review peer benchmark & CHF opportunity`
- [ ] Document it: `/document peer benchmark & CHF opportunity`

### 10. Self assessment fallback · Beta
When the pipeline finds little or nothing, or the client wants to correct it, the client fills in the same KPIs by hand and the benchmark recalculates. Extends the KPI schema and dashboard from features 8 and 9.
**Done when:** a client can enter or edit each KPI in a form with validation, the benchmark and CHF estimate update, and the dashboard shows which values came from research and which from the client.
- [ ] Build it: `/develop self assessment fallback`

## Slice 8: Thicken the accounts

### 22. Client team invitations
Several people per client company. A member invites colleagues by email, they join the same organization with a role, and an owner can remove them.
**Done when:** an invited colleague joins the inviting company's organization through the emailed link, sees the same dashboard, and an owner can change roles or remove members; expired or reused links fail safely.
- [ ] Build it: `/develop client team invitations`

### 23. In app notification center · Beta
A bell in the dashboard with unread items mirroring the emails: benchmark ready, assessment scheduled, expert assigned, gap report ready, program updated. Works for clients and experts.
**Done when:** each notified event appears in the bell with an unread count, opening an item marks it read and deep links to the right page, and the list is scoped to the user's organization.
- [ ] Build it: `/develop in app notification center`
