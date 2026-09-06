# 0009. Marketing site and retainer enquiry: rationale

The decision record for [index.md](index.md). `/develop` skips this file.

## Context

> ⚠️ Premise note: the scope row asks for "pricing for the four packages" and "the free benchmark as the lead magnet", but nothing in the repo holds a price, a package description, a contact address or an about story, and the `packages` table belongs to feature 11, which is not built. A marketing site that ships with invented numbers is worse than no pricing page: a wrong CHF figure in a search snippet is a promise the sales conversation then has to walk back. The framing that holds is: the pages, the metadata, the form and the ops rail are built now on real code paths, the facts (prices, descriptions, contact, story) live in one catalog file and one site file that you fill, and a test refuses a placeholder so the pages cannot go live half real. A second, smaller premise question: "server rendered" in the scope row reads as "the HTML comes from the server", which the static build satisfies better than a request time render (faster, cheaper, cacheable at the edge), so the pages stay static and only the form's action runs on demand.

The public site today is one landing page in the `(marketing)` route group: the hero with the campaign statement, three proof points and a sign in button, with the header ready for links that do not exist yet, a footer with the signature, the `alternatesMetadata` helper and a sitemap that iterates `MARKETING_ROUTES` (one route). The product plan (`docs/scope/index.md`) says the free benchmark is the entry to the paid loop and Release 1 ships after the launch slice, which makes this feature the front door for the pilot clients and for search: a visitor has to understand the offer, see prices in CHF, trust the people behind it and start the lookup, in German or English, on a phone.

Forces. One engineer, a design system with a campaign vocabulary already built (spec 0003: the inverse block, the statement with the square stop, the campaign pieces and frames, the deck imagery in `public/campaign/`), two languages with localized slugs and a single authority for language links (spec 0004), an email and alert rail with a reserved `enquiry.received` kind (spec 0006), and a data model that reserved a kind I table for the enquiry (spec 0002). The retainer package is sold by conversation, so it needs a form, and a form on a public page is a spam surface the moment it is indexed. Swiss B2B pricing is shown excluding VAT and feature 11 owns the tax computation. Search engines need per page metadata, language alternates, structured data and social cards to rank a two language site correctly, and Core Web Vitals on mobile are a ranking signal as well as the scope's own bar. The revised FADP applies to the contact data the form collects, and cookie consent (feature 14) is not built yet, so nothing on these pages may set a tracking cookie before consent.

Not deciding means the landing page stays a placeholder with a sign in button while the funnel behind it works, and the retainer package has no path into the product at all. Deciding it badly (a separate marketing host, a form service, a CMS) splits the brand, the languages and the data across vendors for a one person team.

## Options considered

### Option 1: Everything in the app: static Next.js pages, one form on a table, the existing rails

Four prerendered pages in the `(marketing)` group built from the campaign components, copy in the message catalogs, prices in one catalog file and contact facts in one site file. Metadata, alternates, a generated social card and typed JSON-LD per page, the sitemap fed by `MARKETING_ROUTES`. One enquiry form on the contact page (topic retainer or general) backed by an `enquiries` table through a server action with a honeypot, a timing check and two counted rate limits, then the existing alert task and a new acknowledgement template. A small ops page in the shape of `/admin/emails`.

**Pros**:
- No new vendor, host or secret; the site inherits the design system, the two languages, the typed routes and the language alternates that already exist.
- Every enquiry is a row with an audit trail, an ops status and a Slack alert; the acknowledgement goes through the same delivery table ops already watch.
- Static pages give the best Core Web Vitals for free and keep the marketing path cookie free until feature 14.
- Prices and facts in one place each, with a test that refuses a placeholder.

**Cons**:
- Copy changes are a pull request and a deploy; there is no editor for a non engineer.
- The flood guard is Postgres counts and a honeypot, not a captcha or an edge rate limiter; a determined attacker can still fill the table.
- A social card generated at build time means a font file in the repo and a route per page.

### Option 2: A headless CMS for the copy and a form service for the enquiry

Sanity, Contentful or Payload holds the page copy in both languages and the app renders it; the form posts to Formspree, HubSpot Forms or a similar service that emails the team and keeps the leads in its own inbox.

**Pros**:
- Marketing edits pages without a deploy, with previews and version history.
- The form service brings spam filtering, notifications and a lead inbox with no code.

**Cons**:
- Two new vendors, two more accounts to operate, at least one of them outside Switzerland holding contact data of Swiss companies (a data processing agreement and a record entry for each).
- Two language content models in a CMS are real work (references, fallbacks, slugs) that the catalogs already solve; the campaign voice depends on components, not rich text.
- The lead lives outside the product: no row, no audit trail, no ops status, no alert through the existing rail, no link to the organization when the sender later signs up.
- Cost and complexity for one engineer and a site of four pages.

### Option 3: A separate marketing site (Framer, Webflow or a static generator) with the app on a subdomain

The marketing site lives on `sme24.ch` in a site builder; the app moves to `app.sme24.ch`. The enquiry form is the builder's form or Option 1's action exposed as an API.

**Pros**:
- The fastest way to a designed page with visual editing, and the marketing host scales and caches on its own.
- A clean split of concerns: the app never carries marketing code.

**Cons**:
- The brand tokens, the typography and the campaign components would be rebuilt by hand in the builder and drift from the app.
- Two hosts, two language setups and two sets of alternates to keep consistent; a shared link that lands on the wrong language is exactly the failure the scope names.
- Search authority splits across two hosts, and the sign up hand off from the landing field into the app crosses a domain (cookies, analytics, the locale).
- The form still needs the table, the alert and the acknowledgement, so the app side of Option 1 is built anyway.

### Option 4: Form to email only, no table

The simplest enquiry: the action sends an email to the team and an acknowledgement to the sender and stores nothing.

**Pros**:
- No migration, no ops page, no retention rule.
- Ships in an afternoon.

**Cons**:
- No record: a lost email is a lost lead; no status, no dedupe, no audit trail, and no link to the organization later.
- The rate limits have nowhere to count, so the guard is the honeypot alone.
- Ops watch a mailbox instead of the admin, which the scope explicitly does not want ("alerts ops", "the retainer form stores the enquiry").

## Rationale

Option 1 wins on the forces that matter here: one engineer, a design system built for exactly these pages, a data model and two rails that reserved a place for the enquiry, and a compliance scope that prefers the data in Zurich. The site is four pages that change rarely; the cost of a pull request per copy change is small next to a CMS and its second language model, and the campaign voice is components and statements, not rich text. Option 3's split of hosts would undo spec 0004's single authority for language links and split search authority for a site that has none yet. Option 4 fails the scope's own done line. Option 2 is the right answer the day a marketing person edits pages daily; that day is a follow up, not this feature.

Within Option 1, the calls made on your behalf (this run had nobody at the panel; each is one line in the spec and reversible before `/develop`):

- **Static, not request time rendering.** The scope's "server rendered" is satisfied by prerendering; static pages are faster on mobile, cheaper and cookie free. The only dynamic reads (the `topic` preselect, the `company` prefill) happen on the client inside `Suspense` or on the already dynamic sign up page, so no marketing page loses its static mark. Runner up: `force-dynamic` marketing pages reading `searchParams`; simpler code, worse vitals, no reason.
- **One form, two topics, on the contact page.** The reserved alert kind already carries a `topic`, the scope lists contact and the retainer form side by side, and two forms double the schema, the tests and the ops page. The table is therefore `enquiries` with a `topic` column rather than spec 0002's `retainer_enquiries` name. Runner up: a dedicated `/retainer` page with a second route; clearer URL, more code, same table.
- **The lead magnet is a company name field, not a button.** The scope calls the benchmark the lead magnet; a field that carries the name into sign up is the shortest path from a search result to a research run and costs one query parameter on the sign up form. Runner up: a plain "Sign up" button.
- **Flood guard in Postgres, no captcha, no edge limiter.** Two counted queries (5 per address per hour, 3 per email per day), a honeypot and a timing check stop the plain bots at zero operational cost, in the same pattern as feature 8's per organization quota; the Hobby Vercel plan has no WAF rate limiting and a captcha was declined in spec 0005. Runner up: Upstash Redis rate limiting (a new vendor and secret) or Cloudflare Turnstile (a script on a page that must stay cookie free until feature 14).
- **A hashed address, purged after 30 days.** The guard needs something to count per sender; a SHA 256 of the address is pseudonymised, never shown, and nulled by the purge task, which keeps the FADP record simple. Runner up: no address at all (email only counting), which leaves random address bots unguarded.
- **An acknowledgement email to the sender.** It confirms the address, sets the reply expectation and reuses the rail with one template; `notify: false` because the sender has no account. Runner up: no acknowledgement; one template less, a worse first impression.
- **A small ops page now, not "wait for feature 12".** Without it ops act from Slack alone; `/admin/emails` already set the shape (list, filter, cursor, detail) so the cost is small. Runner up: alert only until feature 12; the lead has a row but no workflow.
- **Prices in a catalog file, facts in a site file.** One place each, typed, testable, with a test that refuses a placeholder; feature 11 promotes the catalog into its table and a test keeps them equal (the `kpi_definitions` pattern of spec 0007). Runner up: the `packages` table now; a migration for four rows that feature 11 would reshape anyway.
- **Prices excluding VAT with the 8.1% note.** Swiss B2B convention; feature 11 computes and shows the tax at checkout. Runner up: gross prices; wrong for the audience.
- **Generated social cards, not PNG files.** One `opengraph-image.tsx` per page with the localized statement in Geist keeps eight cards in step with the copy for free and needs no design work; the font file is OFL licensed and small. Runner up: two hand made PNGs in `public/og/`; less code, stale the first time a statement changes.
- **Typed JSON-LD through `schema-dts`.** Types only, no runtime, and a typo in a property name fails `pnpm typecheck` instead of silently dropping a rich result. Runner up: untyped objects.
- **A `purge-enquiries` task of its own.** The same Monday schedule as the email purge, but its own log line and retry so one purge failing never hides the other. Runner up: a second statement in `purge-email-deliveries`.
- **Design source: `docs/design.md` and the campaign components.** No design tool file exists in the repo and the inventory was built for these pages; confirmed by the owner in the question round.
- **References level: none.** Chosen by the owner in the question round: no citations and no References section; the reasoning stays here in full.

## Cross check

Run on 2026-09-06 on Opus (read only) after the question round; verdict "sound design, right option, but not buildable as written". Every finding was checked against the code and, on the owner's pick, folded into `index.md`:

- Wrong against the code: the ops policy helper is `private.is_ops()` (there is no `jwt_role()`); `EMAIL_TEMPLATE_NAMES` is a closed enum the new template must join; the `chf` format prints two decimals, so the cards use `chfWhole`; the admin routes must be in `PATHNAMES` and the alert link is a bare path the task prefixes; the sign up page reads no query parameter today, so it reads `searchParams` and passes `defaultCompany`.
- Dead or unsafe guards: a server rendered `startedAt` on a prerendered page is one build time value for everyone (now set on the client on mount); `source_path` was a client controlled column (dropped, `locale` says the page); the counts and the insert are not atomic (stated as best effort); an ops or expert tester's claims would land on a lead row (client role only); two ops leaving `new` at once (one statement decides `handled_at`); the audit trigger would fire on every purge null out (trigger on insert and update of `status`, `ops_note` only).
- Mechanisms named: a server action stays dynamic on a static page; the `Suspense` fallback is the full form with `general` selected; the image route's params, `generateImageMetadata` and `readFileSync`, with static PNGs as the fallback; the null recipient is what suppresses the acknowledgement's notification; `sourceEvent` equals the alert kind; the Biome override that permits the service client in `actions.ts`; the rate limited message key; `service_role` keeps delete; anonymous audit rows have a null organization; several JSON-LD script elements per page are fine; `robots.ts` disallows everything off production; a 120 kB first load budget makes AC-16 checkable.
- Nits applied: the alert title is "Enquiry received"; the pricing call to action carries no company parameter; kind I tables carry no tenant contract.
- Declined: dropping the ops role check from `getEnquiries`. The `/admin/emails` query checks the role the same way, and the spec follows the pattern in the repo.

## How the questions were answered

The spec was drafted first from the scope row, `AGENTS.md`, specs 0002 to 0008 and the code, with a recommended pick and a runner up for every decision above. The owner then answered the same questions one by one in the picker on 2026-09-06 (30 questions in seven rounds) and took every recommended pick, with one change: the engineer drafts the package descriptions, the FAQ and the about story in the campaign voice, and the owner supplies only the three prices and the contact facts, before `/check verify`. The spec's first Follow-up item records that split.

## Amendment 2026-09-06: first load JavaScript budget

### Context

`/check verify` met every criterion but one. AC-16 asked for 120 kB of first load JavaScript per marketing route, read from the build's route table. Two things were wrong with that clause. Next 16 prints no sizes in its route table, so the number could not be read where the spec said. And the number itself had no baseline: it was written before a build existed, and a Next 16 App Router page cannot get under it. React DOM and the App Router runtime together weigh about 125 kB gzipped before a single component of ours is added.

The measurement that matters is the set of module `<script>` files the prerendered HTML references, gzipped. That is what a browser downloads before it can hydrate. Two things do not belong in it: the `nomodule` polyfill (38.5 kB gzipped, referenced by every page, never downloaded by a browser that runs modules; the earlier "415 kB" figure in `docs/marketing.md` counted it) and chunks loaded later through `import()` (`posthog-js` after consent today).

Measured on 2026-09-06 in the `sme24-marketing` worktree, production build, module scripts only, gzipped with Node's `zlib` at the default level:

| Page | Before (kB) | After the two cuts (kB) | Budget (kB) |
|---|---|---|---|
| `/` | 380.5 | 221.5 | 250 |
| `/pricing` | 377.1 | 218.1 | 250 |
| `/about` | 379.4 | 220.5 | 250 |
| `/contact` | 402.4 | 326.2 | 350 |

"After" is an experiment build with three edits, reverted afterwards: `@sentry/nextjs` loaded through `import()` after `load`, a `src/lib/env.public.ts` without zod for the three browser importers of `clientEnv`, and the two zod locales imported from their own files. The German pages weigh the same as the English ones within a kilobyte.

What the bytes are, from the Turbopack bundle analyzer (`next experimental-analyze --output`) and the two builds:

| Part | Gzipped | Where it comes from | Fate |
|---|---|---|---|
| React DOM plus the App Router runtime (segment cache, router reducers, the client of React Server Components) | about 125 kB | Next 16 itself | Stays; the floor |
| Browser Sentry SDK in the critical path (`@sentry/core`, `@sentry/browser`, `browser-utils`, the Next integration, tracing) | about 76 kB (the `/contact` delta, where nothing else changed) | `Sentry.init` in `instrumentation-client.ts`, a static import | Moves to an `import()` chunk of 168 kB that loads after the page |
| zod chunk | 82.6 kB | `clientEnv()` in `src/lib/env.ts`, imported by `instrumentation-client.ts`, the analytics provider and the browser Supabase client; on `/contact` also the form's `zodResolver` | Leaves `/`, `/pricing`, `/about`; stays on `/contact` |
| of which zod's forty locales | about 45 kB | `zod/v4/core`, `classic` and `mini` all `export * as locales`; Turbopack keeps a namespace re export whole, so every zod import carries every locale, including Thai and Russian strings | Stays wherever zod stays; a zod packaging matter |
| of which zod's JSON Schema converters | about 7 kB | the same index | Same |
| Radix (the header's sheet and dropdown menus, the tooltip provider, the select and radio group on `/contact`) with `floating-ui` and `remove-scroll` | about 58 kB (about 66 kB on `/contact`) | `MarketingHeader`, the root layout's `TooltipProvider` and `Toaster`, the form | Stays; a later cut |
| `next-intl` runtime with the ICU message parser | about 12 kB | every client component that translates | Stays |
| `react-hook-form` and the resolver | about 10 kB, `/contact` only | the form | Stays |
| `sonner`, `next-themes`, `lucide`, `tailwind-merge`, app code | about 25 kB | the root layout and our components | Stays |
| `nomodule` polyfill | 38.5 kB | Next, for browsers without modules | Not counted |

Two facts from the tool documentation shaped the options. The Sentry Next.js SDK's tree shaking options (`removeTracing`, `removeDebugLogging`) are webpack only; the SDK's guide says they do not apply to Turbopack builds, and Next 16 builds with Turbopack. And zod's namespace re export of its locales is in every entry point of the package, so no import path avoids it.

### Options considered

**Option A: keep 120 kB and cut until it is met.** Every cut in the table above, taken together, leaves about 125 kB of framework plus at least the header. The only ways under 120 kB are a public site with no client component at all (no header sheet, no language menu, no theme toggle, no form) or a public site outside the Next app (Option 3 of the original spec, rejected for the two languages, the design system and the sign up hand off). Pro: the number in the spec would stand. Con: it cannot be met inside the chosen architecture; chasing it would strip the header and the form of behaviour for a target with no user facing meaning.

**Option B: amend the budget to the measured build and cut nothing.** Set 400 kB and move on. Pro: no work, no risk, Lighthouse on the preview still gates the outcome. Con: a landing page would carry 76 kB of error reporting and 83 kB of a validation library in the critical path for nothing; the two are the cheapest bytes on the page to remove, and a budget that merely blesses today's build is not a budget.

**Option C: amend the budget to what the two cheap cuts leave, with headroom, and take those cuts now.** 250 kB for the three content pages, 350 kB for `/contact`; Sentry deferred to after `load` on public pages, zod out of the browser env. Pro: about 160 kB off the content pages and 76 kB off `/contact` for two small modules and one script; the budget is enforceable by a script in CI; nothing user facing changes. Con: an error before `load` on a public page is not reported; `/contact` keeps zod's locales; two follow ups stay open.

**Option D: amend and take every cut, including the header and the root layout.** About 180 kB on the content pages. Pro: the smallest pages. Con: the toaster, the tooltip provider and the header are shared with the signed in areas, so the cut is a shell change with a design system review, for a gain nothing has yet asked for (no Lighthouse number exists).

### Rationale

Option C. The forces: the site exists to load fast on a phone and hand a company name to sign up (the owner's user story), the spec chose one app for the public site and the product (Option 1), Lighthouse mobile on the preview is the outcome gate the criterion already carries, and `/check verify` needs a number it can check where the spec says. A budget is a leading indicator for that gate, so it should sit a little above the honest floor of the chosen architecture, not at a number the architecture cannot reach and not at whatever the last build happened to weigh. The two cuts are the ones with no product cost: Sentry after `load` on pages that have no session and almost no client behaviour, and a browser env that reads six inlined constants without a validation library (they were validated on the server at build time anyway, so the browser parse never found anything). The header and the root layout stay as they are until a Lighthouse number says otherwise; that trigger and the order of the next cuts are in the Follow-up.

Why 250 and 350 and not lower: the content pages measured 218 to 222 kB, the contact page 326 kB; 250 and 350 give about 10 percent of headroom for copy, a section or a dependency bump without a spec amendment, and no more. Why the same number for both languages: the German pages differ by under a kilobyte.

Why the deferred Sentry starts at once in the signed in areas: a hydration error in the client dashboard is exactly what the SDK is for, and those pages are behind a sign in with no LCP target; the public pages accept the blind window for a faster first paint.

Why a script and not the route table: Next 16 prints no sizes; the script measures what a browser downloads, runs locally after a build and in `e2e.yml` against the deployment, and checks the two structural clauses (no Sentry in the module scripts, no zod on the content pages) with two string markers, so the criterion is provable by one command.

Why not `zod/mini` for the browser env: mini's entry re exports the same locales namespace, so the bytes would stay; the honest fix is no zod in that module at all.
