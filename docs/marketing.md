# Marketing site and enquiries

_How the public site is built, how to change what it says, how an enquiry travels from the contact form to the ops team, and what each environment needs before the site goes live. Spec: [0009 Marketing site and retainer enquiry](specs/0009-marketing-site-retainer-enquiry/index.md)._

## The pages

Four prerendered pages in German and English under `src/app/[locale]/(marketing)/`:

| Page | English | German | What it holds |
|---|---|---|---|
| Landing | `/en` | `/de` | The hero with the company lookup field into sign up, three proof points, how it works, the packages overview, the campaign wall, a closing call to action |
| Pricing | `/en/pricing` | `/de/preise` | The four packages of the owner's ladder in price order (three snapshots and the implementation partner on demand), what every package includes, a short FAQ |
| About | `/en/about` | `/de/ueber-uns` | The story in three paragraphs, a campaign grid, how we work |
| Contact | `/en/contact` | `/de/kontakt` | The contact facts and the enquiry form |

Every page is static: no page or layout on this path reads `searchParams`, `headers()` or `cookies()`. The routes and their German slugs live in `PATHNAMES` and `MARKETING_ROUTES` (`src/i18n/pathnames.ts`); a slug of the other language is a 404. Each page has:

- its title and description from `marketing.<page>.meta.*`, the canonical URL and the `hreflang` links through `marketingMetadata` in `src/features/marketing/metadata.ts`, plus the Open Graph and Twitter fields;
- a social card (1200 by 630, the page's statement in Geist Bold on the jet ground) from the `opengraph-image.tsx` next to the page, rendered by `src/features/marketing/og-image.tsx` with the font vendored in `src/assets/fonts/` (OFL). Next builds the card URL from the internal locale segment (`/en-CH/pricing/opengraph-image-<hash>/card`), which the request proxy lets through; the card is generated on its first request and cached, not at build time;
- structured data through the `JsonLd` component: `Organization` on every page (from the layout), `WebSite` on the landing, `ItemList` of four `Product` entries with a `CHF` offer on pricing (the implementation partner's offer carries no price), `AboutPage` and `ContactPage`;
- an entry in `sitemap.xml` in both languages with alternates. `robots.txt` answers `disallow: /` on every deployment that is not `VERCEL_ENV=production` (previews, staging, local), so only production invites indexing.

The header (`src/components/marketing-header.tsx`) shows Pricing, About and Contact with `aria-current="page"` on the active one; the footer (`src/features/marketing/ui/marketing-footer.tsx`) shows the signature, the one line site description (`metadata.description`) and the mail address on the left, the Product, Company and, once feature 14 passes links, Legal groups on the right, and a bottom bar with the copyright line (build year, `SITE.legalName`) and the theme control; the language switch lives in the header only, so the page has one `Language` navigation landmark.

## Changing copy, a price or a contact fact

- **Copy**: every string is a key under `marketing.*` in `messages/de-CH.json` and `messages/en-CH.json` (`landing`, `pricing`, `about`, `contact`, `packages`, `nav`, `footer`). `tests/messages.test.ts` fails when the two catalogs drift.
- **A price**: `PACKAGES` in `src/features/marketing/packages.ts` holds the price per package (`priceChf`, null for the implementation partner) and the order by price. Names, promises, best for lines, delivery lines, included points, outputs and outcomes are catalog keys under `marketing.packages.<key>.*`, the four card labels under `marketing.pricing.*`. `tests/features/marketing/catalog.test.ts` fails while a fixed price package carries a price of `0` or less, when the order is not by price, or when a card string is missing in one language.
- **A contact fact**: `SITE` in `src/features/marketing/site.ts` (legal name, street, postal code, city, email, phone, profiles). The phone is `null` and the profiles empty until they exist; the contact page omits the phone row and the `Organization` structured data omits `sameAs` meanwhile. A field that carries a placeholder goes on `SITE_PLACEHOLDERS`; the same test fails while the list is not empty.
- **The email footer address** is a separate key, `email.layout.footerAddress` (see [email.md](email.md)).

## How an enquiry travels

1. The contact page's form (`EnquiryForm`, `src/features/marketing/ui/`) serves the retainer and general questions; `/contact?topic=retainer` preselects the topic on the client. The form validates with `enquirySchema` (`src/features/marketing/schema.ts`) and submits to `submitEnquiry` (`src/features/marketing/actions.ts`).
2. The action checks the honeypot (`website`) and the mount time (`startedAt`, under three seconds is a bot): a bot gets `ok` and nothing is stored. Then the schema, then two counted rate limits through the service client: more than 5 rows with the same address hash in the last hour, or more than 3 with the same email in the last 24 hours, answer `rate_limited` and the form shows the contact address. The address is stored as a SHA 256 hash only.
3. The row lands in `enquiries` (only the service key inserts; a signed in client's row links to their organization, ops and expert testers stay anonymous). Then, never losing the row: the `enquiry.received` alert to Slack (company name and topic only), the `enquiry_received` acknowledgement to the sender in the page language (through the email rail of [email.md](email.md), keyed `enquiry/<id>/ack`), and the server side PostHog event `enquiry_sent`.
4. Ops work the enquiries on `/admin/enquiries` (status filter, newest first, 50 per page) and `/admin/enquiries/<id>` (every stored field except the address hash, the sender's organization when linked, the status and note form). The Slack button opens the detail page. The first move out of `new` records `handled_by` and `handled_at` once; any status may follow any other.
5. Retention (`purge-enquiries`, Mondays 03:00 Zurich): the address hash is nulled after 30 days, closed enquiries are deleted 12 months after they were handled. Inserts and ops changes of status and note are audited; the purge is not, it logs its counts.

## Local development

- The dev server serves the pages at http://localhost:3000/en and /de. Two workers on one Trigger.dev environment conflict: run `pnpm trigger:dev` from this checkout only, or the acknowledgement run fails with an input error on a worker that does not know the template.
- `pnpm email:dev` previews `enquiry_received` in both languages; Mailpit at http://127.0.0.1:54324 receives the real acknowledgement.
- `pnpm build && pnpm budget` prints the first load JavaScript of the eight prerendered pages against the budget (see Known limits) and exits 1 when a page is over, when the browser Sentry SDK sits in a module script, or when zod reaches a content page; `pnpm budget --url <deployment>` measures a deployment with the Vercel bypass secret from `VERCEL_AUTOMATION_BYPASS_SECRET`.
- The gallery (`/admin/design`, Marketing section) shows the package card, the FAQ and the enquiry form empty and with every error, so axe scans every state.
- Tests: `tests/features/marketing/` (schema, action branches, JSON-LD, catalog and site facts, components), `tests/features/enquiries/` (schemas, the workflow action), `tests/trigger/purge-enquiries.test.ts`, `tests/trigger/send-email-enquiry.local.test.ts` (the acknowledgement through the task against Mailpit), `tests/scripts/bundle-budget.test.ts` (the tag parsing, the page list and the comparison), `tests/instrumentation-client.test.ts` (the deferred Sentry load), the `publicEnv` cases in `tests/env.test.ts`, `supabase/tests/enquiries.test.sql` (policies, grants, constraints, audit), `e2e/marketing.spec.ts` (pages with axe in both themes, slugs, prefill, the contact thread, the rate limit, the discoverability layer) and `e2e/enquiries.spec.ts` (the ops pages).

## Per environment checklist

- [x] Owner: the three fixed prices in `packages.ts`, the contact facts in `site.ts` (and an empty `SITE_PLACEHOLDERS`), both received on 2026-09-06.
- [ ] Owner: a phone number and the LinkedIn company URL in `site.ts` when they exist, and a pass over the German package strings, the FAQ and the about story in both catalogs.
- [ ] `NEXT_PUBLIC_APP_URL` is the absolute public host: canonical links, alternates, the sitemap and the social card URLs derive from it.
- [ ] Deploy the tasks so the `purge-enquiries` schedule registers; `TRIGGER_SECRET_KEY` in Vercel so the action can trigger the alert and the acknowledgement.
- [ ] `OPS_ALERT_WEBHOOK_URL` in Trigger.dev for the `enquiry.received` alert; on staging `EMAIL_ALLOWED_RECIPIENTS` keeps the acknowledgement from reaching outside addresses (stored as `skipped`).
- [ ] Run Google's Rich Results Test and the Schema.org validator on the four pages; record warnings in the verify record.
- [ ] Run Lighthouse mobile on the four pages of the Vercel preview and record LCP, CLS and INP in the verify record.
- [ ] Production only: `VERCEL_ENV=production` lifts the `disallow: /` in `robots.txt`; submit the sitemap to Search Console.

## Known limits

- The first load JavaScript budget (spec 0009, AC-16, amended 2026-09-06) is 250 kB gzipped for `/`, `/pricing` and `/about` and 350 kB for `/contact`, the same in both languages, measured as the module `<script>` files the prerendered HTML references (the `nomodule` polyfill and chunks loaded later through `import()` do not count). `BUDGETS_KB` in `scripts/bundle-budget.mts` is the single source; `pnpm build && pnpm budget` checks the local build and `e2e.yml` runs `pnpm budget --url` against every deployment. The build of 2026-09-06 measured about 220 kB for the content pages and about 326 kB for the contact page. What stays in the number: React DOM and the App Router runtime (about 125 kB), the Radix primitives of the header, the next-intl runtime, and on `/contact` zod with its forty message locales (about 45 kB, a zod packaging matter) plus the form. The browser Sentry SDK loads through `import()` after the `load` event on public pages (at once in the signed in areas), so an error before `load` on a public page is not reported. The next cuts, in order, are recorded in the Follow-up of the spec.
- The social cards are generated on first request rather than at build time (see above); on Vercel the route is cached after the first hit and the font file is traced into the function.
- Copy changes need a deploy; a headless CMS is the recorded follow up if that becomes a daily need.
