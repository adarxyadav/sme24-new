# 0004. Localization: decision record

The reasoning behind [index.md](index.md). `/develop` does not need this file.

## Context

SME24 sells to regulated Swiss companies, so German is the first language and English the second, with French and Italian deferred in the scope. Spec 0001 chose next-intl v4 with the locale prefix always on (`/de`, `/en`), German as the default, no browser language detection and a cookie written by an explicit switch; the scaffold and the design system (spec 0003) built on that: two catalogs, a parity test, a switcher in the marketing header, on the sign in page and in the sidebar menu, and a `locale` column on profiles (spec 0002). What is missing is everything a real product needs once money and dates appear: Swiss formatting, one rule for the timezone, a way to translate outside a request (emails from Trigger.dev tasks, generated reports), a language for the organisation as opposed to the person, enforcement that no string is hardcoded, translated validation errors, language alternates for search engines, and a written set of content rules.

The forces: the plain `de` locale formats numbers the German way (`4.900,00 CHF`) which is wrong for Switzerland (`CHF 4’900.00`); the catalogs will grow across 24 features and today the whole catalog reaches every browser; the product commits to WCAG 2.2 AA and to Swiss data protection, neither of which changes here; the team is one engineer plus AI, so any process with an external translation service or a separate build step costs more than it saves; and Trigger.dev tasks and React Email templates run without a request, so the request bound next-intl API cannot serve them. Not deciding now means every feature from 6 on formats money its own way and hardcodes a few strings, and the cost of French later becomes a rewrite instead of a file.

## Options considered

### Option 1: Extend the existing next-intl setup in place

Keep next-intl and grow it: region aware locales behind the short prefixes, a formats module, typed and gated catalogs, the standalone translator for tasks, a stored organisation language, a typed route map with localised marketing slugs, and a metadata helper.

**Pros**:
- Everything already built (routing, switchers, catalogs, tests) stays; the change is additive.
- next-intl covers formatting, ICU messages, standalone use and localised pathnames in one library the team already runs.

**Cons**:
- The locale rename to `de-CH` and `en-CH` is one wide diff.
- The route map types every link, which is a per route cost and a new habit.

### Option 2: Move to a compile time library (Lingui or Paraglide)

Replace next-intl with a library that extracts messages from source and compiles per locale bundles, giving tree shaken catalogs and automatic extraction of literals.

**Pros**:
- Extraction finds hardcoded text and unused keys for free; per page bundles are minimal.

**Cons**:
- A rewrite of routing, the proxy, the switchers and the tests for a project four features in.
- Localised pathnames, request scoped configuration and the App Router integration are less mature than next-intl's; the installed skill and the spec 0001 decision would both be thrown away.

### Option 3: Keep the plain locales and format through custom helpers

Leave `de` and `en` as the locales and add `formatChf`, `formatDate` helpers that call `Intl` with `de-CH` or `en-CH`.

**Pros**:
- No rename, no cookie or segment change, smallest diff.

**Cons**:
- next-intl's own formatter, ICU number and date arguments inside messages, and `html lang` keep formatting German style; every later feature must remember the wrapper, and the first `{amount, number}` in a message is a bug.

### Option 4: A hosted translation platform as the source of truth

Crowdin, Lokalise or Tolgee hold the catalogs; CI pulls them.

**Pros**:
- Built for external translators and review workflows; French and Italian could be outsourced.

**Cons**:
- An account, a sync step and cost for a team that writes both languages in the same pull request; parity becomes an external state rather than a test in the repo.

## Rationale

Option 1 wins because the constraints are continuity and reach, not tooling. next-intl already runs the routing spec 0001 decided and the switchers spec 0003 built; making `de-CH` and `en-CH` the locales fixes formatting at the root, so the formatter, the ICU arguments in messages and the `lang` attribute agree without wrappers (Option 3's trap), and next-intl's custom prefixes keep the short URLs the scope and the SEO work assume. The standalone `createTranslator` and `createFormatter` give tasks and emails the same catalogs, which a compile time library (Option 2) would also do but at the price of a rewrite. With one engineer writing both languages, catalogs in the repo gated by tests beat a platform (Option 4); the platform stays a future option if outside translators join for French and Italian.

The finer calls, each made with the engineer:
- **Swiss formatting in both languages** (`en-CH` rather than `en-GB`): one set of conventions across the product; a Swiss reader in English still expects `04.09.2026` and `CHF 1’234.50`.
- **Short codes in the database, full locales in the app**: the cross check suggested storing `de-CH` in `profiles.locale` and `organizations.locale` and dropping the mapping. Kept the short codes: the database describes a language, not a formatting region (French later is `fr` in the jsonb keys and the checks, whatever the app calls its locale), the seeded rows and spec 0002 already use them, and the mapping is one small table whose inverse doubles as the URL prefix.
- **Formal Sie and British English**: the audience is safety officers and management in regulated companies, and Switzerland follows British conventions.
- **Two CHF formats**: prices and invoices need Rappen; benchmark and incident estimates are models and must not look exact.
- **Fixed `Europe/Zurich`**: Swiss users, one rendering on server and client, and emails cannot know a browser timezone. Runner up: the viewer's timezone, which needs a client pass on every date.
- **Localised marketing slugs with a typed route map**: German search terms in the URL serve the lead magnet; the cost is one map entry per route, which also types every link. Runner up: English slugs everywhere with plain string links.
- **Switch writes the profile, URL stays the truth**: the stored language is for what leaves the app (emails, documents); the URL decides the page. Redirecting on sign in would fight the switcher.
- **Organisation locale**: reports belong to the company, so a company language exists next to the personal one. Runner up: the requester's locale, which flips a report between colleagues.
- **Recipient locale at send time**: a task takes an id and reads the current value, so a replayed run and a mail triggered by ops both use the recipient's language.
- **Typed keys plus a literal scan** rather than an ESLint rule: the project declined ESLint for Biome; the TypeScript compiler API gives the same detection inside Vitest.
- **Per parse Zod locale maps**: Zod 4 accepts an error map in the parse context and in the resolver, so built in messages are localised without mutating global config; custom rules keep the message key pattern the gallery form already uses.
- **Per feature namespaces with a shared set sent to the browser**: the catalog will reach a few hundred kilobytes; the shared set plus explicit extras keeps the landing page light without a merge step.
- **Throw in development, report and show the key in production**: a customer sees a key path instead of an error page; Sentry gets one event per key.
- **Helper now, pages in feature 13** for alternates and the sitemap: the slug map and the alternates are one concern and should live in one place from the start.

## Evidence

### ICU outputs pinned on 2026-09-04 (Node 25.1.0, full ICU)

| Locale | `chf` 4900 | `chfWhole` 48312.5 | plain number | `percent` 0.1234 | `dateStyle: short` | `dateLong` | `dateTime` | explicit day month year |
|---|---|---|---|---|---|---|---|---|
| `de-CH` | CHF 4’900.00 | CHF 48’313 | 1’234’567.891 | 12.3% | 04.09.26 | 4. September 2026 | 04.09.2026, 15:05 | 04.09.2026 |
| `en-CH` | CHF 4’900.00 | CHF 48’313 | 1’234’567.891 | 12.3% | 04.09.2026 | 4 September 2026 | 4 Sept 2026, 15:05 (with `dateStyle: medium`) | 04.09.2026 |
| `de` | 4.900,00 CHF | 48.313 CHF | 1.234.567,891 | 12,3 % | 04.09.26 | 4. September 2026 | 04.09.2026, 15:05 | 04.09.2026 |
| `en-GB` | CHF 4,900.00 | CHF 48,313 | 1,234,567.891 | 12.3% | 04/09/2026 | 4 September 2026 | 4 Sept 2026, 15:05 | 04/09/2026 |

Two consequences shaped the formats module: `dateStyle: "short"` gives a two digit year in `de-CH`, and `dateStyle: "medium"` abbreviates the month in `en-CH` (`Sept`), which differs between ICU versions; so every named date format uses explicit parts (`dateLong` as `day: "numeric", month: "long", year: "numeric"` gives the same `4. September 2026` and `4 September 2026`). The apostrophe is U+2019.

### Cross check findings folded in (2026-09-04)

A read only review on a second model found fourteen gaps, all resolved in `index.md`: the `/de-CH` behaviour (next-intl's `getPathnameMatch` finds no prefix, so it redirects to `/de/de-CH`, a 404 route), the locale layout's explicit `messages` prop, the scaffold task's summary source, the owner column trigger being a deny list that already permits `locale`, the switch and action ordering, the literal scan's coverage of expression containers and template literals, `parseWith` taking the full locale, the prefix and short code identity used by the proxy, `alternateLinks: false`, the `onError` once per key guard, the browser evidence moved to Playwright, the JSON import updates, and the cookie rewrite timing.

### next-intl behaviour checked in `node_modules` (v4.14.2)

- `localePrefix.prefixes` maps a locale to a custom prefix (`routing/types.d.ts`).
- With `pathnames` defined, `Link` and friends type `href` as the map's keys (`createNavigation.d.ts`); an unknown pathname passes through unchanged at runtime (`navigation/shared/utils.js`, "Unknown pathnames").
- A nested `IntlProvider` inherits `messages` only when the prop is undefined; a passed object replaces the parent's (`use-intl` `react.js`), hence `clientMessages` always including the shared set.
- `IntlConfig` exposes `formats`, `timeZone`, `onError` and `getMessageFallback`.

### Zod 4 (v4.5.4)

- `zod/locales` ships `de` and `en`; the parse context accepts `error` (a per call error map), so `schema.safeParse(input, { error })` localises without `z.config`.

### Current tree (2026-09-04)

- `src/i18n/`: `routing.ts`, `request.ts`, `navigation.ts`, `query.ts`; `src/proxy.ts` builds redirects by string.
- Catalogs `messages/de.json` (17.5 KB) and `en.json`, 14 namespaces, all sent to the browser.
- Switchers: `src/components/locale-switcher.tsx` (links), `src/components/shell/locale-menu-items.tsx` (radio items, `router.replace`).
- `profiles.locale` with the `('de','en')` check; `kpi_definitions.name` jsonb keyed by short code; no organisation locale.
- One `useFormatter` use (`scaffold-checks-live.tsx`), one raw `toLocaleString` (`src/components/ui/chart.tsx`).
- Tests: `tests/messages.test.ts` (parity and placeholders), Playwright `landing.spec.ts` (redirect, both locales with axe, the header switch).
