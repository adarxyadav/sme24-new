# Launch · SME24

Part of the [SME24 scope](index.md). What Release 1 needs before pilot clients and the public arrive: the funnel entry, the legal duties of a Swiss B2B product that handles company and contact data, and the instruments that show whether the loop works.

## Slice 4: Launch readiness

### 13. Marketing site & retainer enquiry · done
Server rendered public pages in German and English: landing page leading into the free company lookup, pricing for the four packages, about, contact, and a retainer enquiry form for the package sold without checkout. Metadata, sitemap, structured data and social cards on every page, so the free benchmark works as the lead magnet.
**Done when:** every public page renders server side in both languages with correct metadata, canonical and language alternate links, sitemap and social cards; the retainer form stores the enquiry and alerts ops; pages meet WCAG 2.2 AA and Core Web Vitals targets.
spec [0009](../specs/0009-marketing-site-retainer-enquiry/index.md)
- [x] Design it (spec): `/architect marketing site & retainer enquiry`
- [x] Build it: `/develop marketing site & retainer enquiry` · code in `src/app/[locale]/(marketing)/`, `src/features/marketing/`, `src/features/enquiries/`, `src/app/[locale]/admin/enquiries/`, `src/trigger/purge-enquiries.ts`, `src/lib/email/templates/enquiry-received.tsx`, `supabase/schemas/32_enquiries.sql`, `src/lib/env.public.ts`, `src/instrumentation-client.ts`, `scripts/bundle-budget.mts`, `docs/marketing.md`
  - [x] Thin thread: the `enquiries` migration with pgTAP, the packages and site catalog files, `submitEnquiry` with the honeypot, timing and rate limit guards, the `enquiry.received` alert and the `enquiry_received` acknowledgement email, the contact page with the form and confirmation in both languages, the admin enquiry detail with `updateEnquiry` (AC-8, AC-9, AC-10, AC-11, AC-14, AC-1 and AC-3 for contact, AC-12 in part)
  - [x] The public pages: landing with the company name field into sign up, pricing from the catalog with the FAQ, about, header links and the footer groups, Open Graph and Twitter metadata with generated social cards, JSON-LD per page, the sitemap routes and German slugs (AC-2, AC-4, AC-5, AC-6, AC-7, completes AC-1 and AC-3, AC-16 in part)
  - [x] Ops, retention, hardening and docs: `/admin/enquiries` list with filter and cursor, the `purge-enquiries` task, gallery sections, Vitest, pgTAP and Playwright with axe, the Rich Results and Lighthouse checks, `docs/marketing.md` (AC-13, AC-15, AC-17, completes AC-12 and AC-16)
  - [x] First load budget (spec amendment 2026-09-06): `src/lib/env.public.ts` for the browser without zod, Sentry loaded after the page in `src/instrumentation-client.ts`, `scripts/bundle-budget.mts` behind `pnpm budget` with its `e2e.yml` step, the Biome override, the Vitest suites, `docs/marketing.md` and the verify rerun (completes AC-16 at 250 kB per content page and 350 kB for contact)
  - [x] The owner's package ladder (second spec amendment 2026-09-06): `PACKAGES` reordered by price with the four prices, `PackageCard` rebuilt with the best for, delivery, pills, output and outcome lines and "On demand", the new catalog keys in both languages, the phone and profiles optional in `site.ts` with the contact page and the `Organization` JSON-LD omitting them, the tests, `docs/marketing.md` and the verify record (the amended AC-6, AC-8 and AC-3)
  - [x] The section vocabulary, the hero benchmark and the expert register (third spec amendment 2026-09-08): the anchor, major and minor tiers with their grounds, openers and the tier map in `docs/design.md` rendered by `SectionHeader`; the landing hero on the page ground with `HeroBenchmark` and `hero-example.ts` and the landing route out of `DARK_HERO_ROUTES`; the expert register directory at `/expert-network/directory` (`/expertennetzwerk/verzeichnis`) with `RegisterDirectory`, `register.ts`, `register.json` built by `scripts/build-register.mts` behind `pnpm register:build`, its `PATHNAMES` entry, `opengraph-image.tsx`, the `CollectionPage` JSON-LD and the bundle budget entry at the same 250 kB ceiling; the two accessibility fixes from the 8 Sep review (the named results table and the stable live region)
- [x] Verify it: `/check verify marketing site & retainer enquiry`
- [x] Test it: `/test marketing site & retainer enquiry`
- [x] Review it (fresh model): `/check review marketing site & retainer enquiry`
- [x] Document it: `/document marketing site & retainer enquiry`

### 14. Legal, privacy & cookie consent · done
Swiss revised FADP basics with GDPR readiness for EU clients: privacy policy, terms, a data processing agreement template, a record of what is processed and where it is stored, deletion and export on request, and a cookie consent banner that gates analytics and marketing scripts until consent is given. The consent pattern is cross cutting, so it needs a decision before analytics ships.
**Done when:** privacy, terms and DPA pages exist in both languages; no analytics or marketing script loads before consent and the choice is remembered; a client can request deletion or export and ops can fulfil it with a record.
Carried over from earlier specs: point the sign up consent links at the real pages, add a terms version beside `terms_accepted_at` and re consent when it changes (spec 0005); fill the footer's legal group and the enquiry form's privacy link (spec 0009); the retention rules for `benchmark_snapshots` and for enquiries belong in the record of processing (specs 0008 and 0009).
spec [0015](../specs/0015-legal-privacy-cookie-consent/index.md)
- [x] Design it (spec): `/architect legal, privacy & cookie consent`
- [x] Build it: `/develop legal, privacy & cookie consent` · code in `src/features/legal/`, `src/app/[locale]/(marketing)/{privacy,terms,imprint,cookies}/`, `src/app/[locale]/admin/data-requests/`, `src/lib/analytics/client.tsx`, `supabase/schemas/33_data_requests.sql`, `supabase/schemas/01_profiles.sql`, `docs/legal.md`, `docs/legal/record-of-processing.md`
  - [x] The consent thread end to end: the `sme24_consent` cookie with its version segment, `setConsent`, the bar hidden by default in the root layout with accept and reject at equal weight, the rewritten analytics gate and the withdrawal path, Playwright proving zero PostHog requests before a choice (AC-1, AC-2, AC-3, AC-4, AC-5, AC-5b)
  - [x] The four legal pages: the `PROCESSORS` and `RETENTION` constants with the test tying them to the purge tasks, the routes with German slugs, metadata and social cards, the German and English copy, the consent control on `/cookies`, the footer legal group and the real sign up and enquiry links, the record of processing with its pgTAP check (AC-6, AC-7, AC-8, AC-8b, AC-9, AC-16)
  - [x] The terms version and re consent: the `profiles.terms_version` migration with pgTAP, `CURRENT_TERMS_VERSION` at `'1'`, the blocking dialog comparing by equality and the changelog key test (AC-10)
  - [x] Data requests and the ops surface: the `data_requests` migration with RLS and pgTAP, the four actions with the transition map and the refusal note rule, the anonymisation routine including the `auth.users` scrub, the `data_request.received` alert, the client card, `/admin/data-requests` list and detail, and `docs/legal.md` (AC-11, AC-12, AC-13, AC-14, AC-15)
- [x] Verify it: `/check verify legal, privacy & cookie consent`
- [x] Test it: `/test legal, privacy & cookie consent`
- [x] Review it (fresh model): `/check review legal, privacy & cookie consent`
- [x] Document it: `/document legal, privacy & cookie consent`

### 15. Analytics & monitoring · done
Conversion funnel events (lookup started, run finished, benchmark viewed, checkout started, payment completed, enquiry sent) plus runtime error monitoring, failed background job alerts and slow page reporting. The event taxonomy is the decision; consent from feature 14 gates the client side part.
**Done when:** each funnel event is recorded with organization and language, a funnel view shows drop off between steps, runtime errors and failed research runs alert your team with enough context to reproduce.
Carried over from earlier specs: `benchmark.viewed` and `benchmark.computed` with their properties (spec 0008), `kpi.client_saved` and `kpi.client_cleared` (spec 0010), and confirm or rename the provisional `enquiry_sent` event and add the marketing funnel events (spec 0009).
spec [0017](../specs/0017-analytics-monitoring/index.md)
code in `src/lib/analytics/`, `src/lib/alerts/`, `src/trigger/instrumentation.ts`, `docs/analytics.md`
- [x] Design it (spec): `/architect analytics & monitoring`
- [x] Build it: `/develop analytics & monitoring`
  - [x] The catalogue and one event end to end: `ANALYTICS_EVENTS` with its per event Zod schemas under a `satisfies` check, `captureServerEvent` retyped to accept only a catalogue name and to validate properties, and `enquiry_sent` renamed to `enquiry.sent` and proven in PostHog (AC-1, AC-2, AC-3, AC-7, AC-8)
  - [x] The server side funnel: capture at `requestResearch`, the `research-company` and `benchmark-company` tasks, `saveClientKpis`, `clearClientKpi`, `startCheckout` and the `confirm-order` task, each after the write that makes its work durable; `payment.completed` fires in `confirm-order` rather than inside `settleOrder`, because that core is shared with the ops `markOrderPaid` path and the three fields the event needs (`created_by`, `organization_id`, `locale`) are already on the order row the task selects; the `expert.profile_completed` and `expert.assigned` renames were already carried by milestone 1's closed union (AC-4, AC-5, AC-7, AC-8)
  - [x] The one browser event: `captureBrowserEvent` behind the existing consent gate and `benchmark.viewed` from a client child of `BenchmarkSegment`, with Playwright proving no event and no identifier before a consent answer (AC-4, AC-6)
  - [x] Monitoring: the `task.failed` alert kind fired from the existing `tasks.onFailure` hook, and the Sentry release plus source map upload from the Vercel commit SHA (AC-9, AC-10)
  - [x] Tests and the runbook: the catalogue consistency and capture failure suites, `docs/analytics.md` with the taxonomy table and the funnel insight recipe, and the `PROCESSORS` review, which found the privacy page and the record of processing both claiming PostHog "loads only after you accept" and corrected all three surfaces to the two paths and their two bases (AC-11, AC-12)
- [ ] Verify it: `/check verify analytics & monitoring`
- [x] Test it: `/test analytics & monitoring`
- [x] Review it (fresh model): `/check review analytics & monitoring`
- [x] Document it: `/document analytics & monitoring`

### 25. Peer data curation & model honesty · Beta · done
The first peer seed is provisional by design (spec 0008), and the plan was to read the published tables and clear the flags. Research for spec 0016 found that premise does not hold: no Swiss or European body publishes the indirect to direct accident cost ratio the CHF figure multiplies by, no Swiss source publishes safety outcomes by company size band, and the Suva accident tables use their own premium class scheme rather than NOGA sections. On top of that, eleven of the twenty two seeded rows carry one number repeated as all three quartiles, so a client in those sectors is told they sit in the "Top quarter" of a distribution nobody measured. So this feature changes what the product claims rather than the arithmetic behind it, and leaves the values themselves for you to replace afterwards against a schema that can finally record what they came from.
**Done when:** the CHF headline is a range with the point estimate inside it, a peer row records whether it holds a distribution or a single point and is described accordingly with no quartile wording on a point row, every KPI declares whether a Swiss source exists for it, the launch gate distinguishes an unread value from a declared assumption, the marketing example is tied to the seed by a test, and one watched `pnpm benchmarks:recompute` has moved every snapshot to `benchmark-model@3`.
spec [0016](../specs/0016-peer-data-curation-launch-gate/index.md)
code in `src/features/benchmark/`, `src/features/research/catalogue.ts`, `supabase/schemas/24_benchmarks.sql`, `supabase/seed-data/`, `src/trigger/benchmark-company.ts`
- [x] Design it (spec): `/architect peer data curation & launch gate`
- [x] Build it: `/develop peer data curation & model honesty`
  - [x] The schema and the two flags: the five new columns through `db:diff` then the regenerated seed, `provisional` split from `is_assumption`, the two gate queries and the pgTAP flag assertions (AC-1, AC-2, AC-3)
  - [x] The point row end to end: shape derived from the values, the two new positions with the ISO branch routed through them, the text only rendering with the broadened group note, the catalogue completeness test, the second fixture and the Playwright thread with axe (AC-4, AC-5, AC-6, AC-6b, AC-13b, AC-15)
  - [x] The range and the caveats: `benchmark-model@3` with its schema key, the range led card with outward rounding, the gallery states, and the assumption and peer caveats carried through to the disclosure (AC-9, AC-10, AC-11, AC-12, AC-16)
  - [x] Per KPI peer status: the catalogue fields with the extended equality test and the reworded sourceless and pending states (AC-7, AC-8)
  - [x] The email range, the marketing example test and `docs/benchmark.md` with the confirmed dead ends (AC-13, AC-14, AC-17)
- [x] Review it (fresh model): `/check review peer data curation & model honesty`
- [x] Verify it: `/check verify peer data curation & model honesty`
- [x] Test it: `/test peer data curation & model honesty`

### 25b. Seller facts & MWST registration
Split from row 25 on 11 Sep 2026: it shared nothing with the peer data but a checklist line, and it blocks the first sale rather than the launch. From spec 0011, the seller facts printed on every invoice: the legal name, address, the `CHE-...MWST` UID and the IBAN the QR-bill pays into, held behind `SELLER_PLACEHOLDERS` until they are real. Confirm with your accountant that SME24 is MWST registered before the first sale, since charging 8.1% without a registration is a real problem. Configuration and an accountant, not a spec.
**Done when:** `SELLER_PLACEHOLDERS` is empty in the production environment and the MWST registration is confirmed.
- [ ] Build it: `/develop seller facts & MWST registration`

### 26. Production environment & go live
No production exists yet: `main` deploys to staging and the `production` branch has nowhere to go. This row is the production half of every runbook: a production Supabase project in Zurich, the Vercel production environment on the product domain, the sending domain verified in Resend with the auth and product email keys, the Parallel, AI Gateway, Trigger.dev and Slack values, the Supabase custom auth domain so consent screens and email links show the product domain (spec 0005), the Vercel firewall rules from spec 0001, branch protection on `main` and `production`, and the first promotion pull request. `docs/auth.md`, `docs/email.md`, `docs/research.md`, `docs/benchmark.md` and `docs/marketing.md` already carry the per environment checklists; this is where they get ticked for production. Feature 25 must be done first.
**Done when:** the `production` branch deploys to the product domain; every runbook's production checklist is ticked; a pilot client can sign up, run a research, see a benchmark and send an enquiry on production; the e2e job is green on the production deployment.
- [ ] Build it: `/develop production environment & go live`
