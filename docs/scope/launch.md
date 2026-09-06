# Launch · SME24

Part of the [SME24 scope](index.md). What Release 1 needs before pilot clients and the public arrive: the funnel entry, the legal duties of a Swiss B2B product that handles company and contact data, and the instruments that show whether the loop works.

## Slice 4: Launch readiness

### 13. Marketing site & retainer enquiry · in-progress
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
- [ ] Verify it: `/check verify marketing site & retainer enquiry`
- [x] Test it: `/test marketing site & retainer enquiry`
- [ ] Review it (fresh model): `/check review marketing site & retainer enquiry`
- [ ] Document it: `/document marketing site & retainer enquiry`

### 14. Legal, privacy & cookie consent · needs a decision
Swiss revised FADP basics with GDPR readiness for EU clients: privacy policy, terms, a data processing agreement template, a record of what is processed and where it is stored, deletion and export on request, and a cookie consent banner that gates analytics and marketing scripts until consent is given. The consent pattern is cross cutting, so it needs a decision before analytics ships.
**Done when:** privacy, terms and DPA pages exist in both languages; no analytics or marketing script loads before consent and the choice is remembered; a client can request deletion or export and ops can fulfil it with a record.
- [ ] Design it (spec): `/architect legal, privacy & cookie consent`

### 15. Analytics & monitoring · needs a decision
Conversion funnel events (lookup started, run finished, benchmark viewed, checkout started, payment completed, enquiry sent) plus runtime error monitoring, failed background job alerts and slow page reporting. The event taxonomy is the decision; consent from feature 14 gates the client side part.
**Done when:** each funnel event is recorded with organization and language, a funnel view shows drop off between steps, runtime errors and failed research runs alert your team with enough context to reproduce.
- [ ] Design it (spec): `/architect analytics & monitoring`
