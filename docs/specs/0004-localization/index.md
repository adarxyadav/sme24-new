# 0004. Localization: German and English as the foundation

**Date**: 2026-09-04
**Status**: Accepted

## Summary

SME24 speaks German and English from the first screen, and this spec turns the routing you already have into a real localization foundation. The app's locales become `de-CH` and `en-CH` (Swiss German and Swiss English), so every number, date and CHF amount formats the Swiss way in both languages while the URLs stay `/de` and `/en`. Strings live in two catalog files that are typed, checked for parity, and scanned for hardcoded text; emails, background jobs and reports get the same translations and formats through one helper, and every organisation and every person carries a stored language. French and Italian later cost two catalog files and one small migration.

## Requirements

**User stories**:
- As a visitor, I want the site in German or English with the choice visible in the URL so that I can share a link that opens in my language.
- As a client user, I want CHF amounts, dates and times to look Swiss in either language so that a benchmark or invoice reads naturally.
- As a signed in user, I want my language choice remembered so that the emails and documents SME24 sends me use it.
- As an organisation owner, I want my company's reports in my company's language even when a colleague works in English.
- As a developer building a later feature, I want typed message keys, one formatting helper and one rule for every string so that localization is not a review item on each pull request.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: The next-intl locales are `de-CH` and `en-CH` with the URL prefixes `/de` and `/en`; `/` redirects to `/en` (amended 2026-09-05, was `/de`); the `html` element carries `lang="de-CH"` or `lang="en-CH"`; a request to `/de-CH/...` or `/en-CH/...` never serves a second copy of a page (next-intl sees no known prefix, answers 307 to `/en/de-CH/...`, and that route does not exist, so the final answer is 404); and one table in `src/i18n/routing.ts` maps each locale to its short language code (`de-CH` to `de`, `en-CH` to `en`) for the database, and the URL prefixes are derived from that same table so the prefix and the short code are one string by construction.
- **AC-2**: The sidebar menu and the marketing switcher both change the language while keeping the path and the query string, and they translate a route through the pathnames map when it has a localised slug. For a signed in user the switch also writes the short code to `profiles.locale` through the `setLocale` action; for a signed out visitor the action returns ok without writing. Signing in never redirects to another language: the URL wins.
- **AC-3**: The named formats in `src/i18n/formats.ts` produce exactly these strings in a Vitest test for both locales, through the request formatter and through the standalone formatter a task uses: `chf` gives `CHF 4’900.00` for 4900; `chfWhole` gives `CHF 48’313` for 48312.5; `dateShort` gives `04.09.2026`; `dateLong` gives `4. September 2026` in `de-CH` and `4 September 2026` in `en-CH`; `dateTime` gives `04.09.2026, 15:05` for 13:05 UTC on that day; `percent` gives `12.3%` for 0.1234. All dates and times render in `Europe/Zurich`.
- **AC-4**: `messages/de-CH.json` is the authoritative catalog and `messages/en-CH.json` mirrors it exactly (the existing parity and placeholder tests, updated); every top level namespace is a feature or a shared group named in `docs/localization.md`; message keys are typed through next-intl's `AppConfig` so `pnpm typecheck` fails on an unknown key or namespace; and `docs/localization.md` records the content rules (formal Sie, Swiss spelling with `ss`, British English, glossary, key naming, ICU plural and rich text usage, the named formats, the timezone rule).
- **AC-5**: A Vitest test parses every `.tsx` file under `src/` with the TypeScript compiler and fails on JSX text, on string literals and template literals inside JSX expression containers, and on `aria-label`, `placeholder`, `title` and `alt` string literals, whenever they contain two or more letters, unless the file or the literal is in the allow list in `tests/i18n/literal-allowlist.ts` (brand names such as `SME24`, units, code samples). The test passes on the tree after this feature. Strings in `.ts` files (actions, schemas, constants) are outside the scan and stay a review concern, written down in `docs/localization.md`.
- **AC-6**: The locale layout passes an explicit `messages` prop holding only the shared namespaces (`common`, `ui`, `states`, `theme`, `shell`, `nav`, `brand`, `metadata`) to `NextIntlClientProvider` (today it passes none, which sends the whole catalog); a client component that needs a feature namespace receives it through a nested provider built with `clientMessages(messages, [...namespaces])`, which always includes the shared set; and a test asserts the rendered `/de` landing page HTML does not contain the `gallery.title` sentence from `de-CH.json`.
- **AC-7**: `createTranslatorFor(locale)` and `createFormatterFor(locale)` in `src/i18n/standalone.ts` return next-intl's translator and formatter with the same catalogs, formats and timezone as the app, without a request; `localeForUser(client, userId)` and `localeForOrganization(client, organizationId)` in `src/features/localization/queries.ts` return the next-intl locale from the stored short code, use `maybeSingle` and fall back to the default locale when no row exists (a deleted recipient must not fail a retried task forever), and throw only on a database error; and the scaffold check task takes an optional `userId`, resolves the locale with `localeForUser` (default locale without an id), and stores `payload.message` plus `" · "` plus the `scaffold.summary` message (new key in both catalogs, with the insert time formatted as `dateTime`) in its `message` column, visible on the ops admin page.
- **AC-8**: `parseWith(schema, input, locale)` in `src/lib/validation.ts` takes the full locale (`de-CH` or `en-CH`), maps it through `LOCALE_CODE` and parses with the Zod locale map for `de` or `en` (built in messages such as required, too short, invalid email arrive in the request language), `zodLocaleError(locale)` gives the same map to `zodResolver` in the browser, and a custom rule carries a message key that the form translates from the feature's `validation` namespace; the gallery form on `/admin/design` shows its errors in German on `/de` and in English on `/en`.
- **AC-9**: `organizations.locale text not null default 'de'` with the check `in ('de','en')` exists; `create_organization` copies the caller's `profiles.locale` into it; an owner may update `locale` through the existing owner update policy (the owner column trigger is a deny list that pins only `archived_at`, `created_by` and `id`, so it needs no change); a plain member has no update path at all; ops keep full access; pgTAP gains assertions for each rule and the generated types are current.
- **AC-10**: `localizedAlternates(pathname)` in `src/i18n/metadata.ts` returns the canonical URL plus `de-CH`, `en-CH` and `x-default` (pointing at `/en` since the amendment of 2026-09-05) language alternates for a route, resolving localised slugs through the pathnames map; the landing page uses it in `generateMetadata`; and `sitemap.ts` lists every route in the marketing route list for both locales with those alternates.
- **AC-11**: Playwright renders every public page in `en` with axe (no WCAG 2.2 AA violations), switches from `/de?x=1` to `/en?x=1` keeping the query, switches back from the sidebar menu as a signed in user and sees the menu show the new language after a reload, reads one CHF amount in the gallery Formatting section as `CHF 4’900.00` in the real browser, and asserts that `/de-CH` ends on `/en/de-CH` with status 404 (amended 2026-09-05).
- **AC-12**: A missing message key throws in development and test; in production `onError` reports `MISSING_MESSAGE` to Sentry once per key per process (a module level set of reported keys, keyed on the message key next-intl quotes so one key is one report across locales, guards the call; the Sentry fingerprint only groups) and `getMessageFallback` renders the key path instead of crashing. Both live in `src/i18n/on-error.ts`, shared by the request config and the standalone factory, and a Vitest test imports and covers them.
- **AC-13**: Every existing route (`/`, `/sign-in`, `/forbidden`, the area roots and `/admin/design`) is in the `pathnames` map, so `Link`, `redirect`, `useRouter` and `getPathname` are typed; `pnpm typecheck` fails on an unknown href; the proxy builds its sign in and forbidden redirects with `getPathname`; and the area gate keeps working for every area in both languages.

## Decision

**Chosen option**: Option 1: Extend the existing next-intl setup in place

Keep next-intl v4 and the routing decided in spec 0001, and grow it into the foundation: region aware locales (`de-CH`, `en-CH`) behind the short URL prefixes, one formats module and timezone, typed and parity checked catalogs with a literal text scan, a standalone translator for tasks and emails, a stored language on profiles and organisations, a typed route map with localised marketing slugs, and a metadata helper for language alternates. No second library, no translation platform.

**Implementation skills**: `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `react-email` (`resend/resend-skills`, `.claude/skills/react-email/`, its i18n reference shows the standalone translator pattern the email feature reuses)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Locales, prefixes and codes (`src/i18n/routing.ts`)

```ts
export const LOCALES = ["de-CH", "en-CH"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_CODE = { "de-CH": "de", "en-CH": "en" } as const satisfies Record<Locale, string>;
export type LocaleCode = (typeof LOCALE_CODE)[Locale];          // "de" | "en"
export function localeFromCode(code: string): Locale            // unknown code gives the default locale

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "en-CH", // amended 2026-09-05, was "de-CH"
  // The URL prefix is the short code, so `localeFromCode(prefix)` also serves the proxy.
  localePrefix: { mode: "always", prefixes: { "de-CH": `/${LOCALE_CODE["de-CH"]}`, "en-CH": `/${LOCALE_CODE["en-CH"]}` } },
  localeDetection: false,
  localeCookie: { name: "NEXT_LOCALE" },
  alternateLinks: false, // `localizedAlternates` is the single authority for language links
  pathnames: PATHNAMES,
});
```

- The locale is what next-intl formats with, what `html lang` shows and what the `NEXT_LOCALE` cookie stores. The short code is what the database stores (`profiles.locale`, `organizations.locale`, the `kpi_definitions` jsonb keys) and what the URL prefix is. Only `LOCALE_CODE` and `localeFromCode` translate between the two; nothing else hardcodes either list.
- The `[locale]` segment receives `de-CH` or `en-CH`: the proxy rewrites `/de/...` to `/de-CH/...` internally, and `generateStaticParams` returns the locales, so `next build` prerenders `/de-CH/...` route files that are reachable only through that rewrite. A direct request to `/de-CH/...` has no known prefix, so next-intl answers 307 to `/de/de-CH/...`, which is a 404 route; that is the intended answer, and nobody should "fix" it with a catch all. `hasLocale` guards stay as they are.
- `pathnames` (`PATHNAMES` in `src/i18n/pathnames.ts`, imported by routing): one entry per route. Marketing routes may localise the German slug (`"/pricing": { "de-CH": "/preise", "en-CH": "/pricing" }`); the signed in areas, sign in and forbidden stay identical in both languages (`"/app": "/app"`). Dynamic routes use next-intl templates (`"/app/companies/[id]"`), and a link with parameters is an object (`{ pathname: "/app/companies/[id]", params: { id } }`). Unknown paths pass through at runtime and fail `pnpm typecheck`, which is the point. `MARKETING_ROUTES` is the `readonly` list of public routes the sitemap and the alternates helper iterate; this feature ships it with `/`, feature 13 adds its pages and their German slugs.
- The proxy keeps its order (next-intl, then Supabase session refresh, then the area gate). It reads the prefix as today (`pathname.split("/")[1]`), turns it into the locale with `localeFromCode`, and builds redirects with `getPathname({ locale, href: "/sign-in" })` and `getPathname({ locale, href: "/forbidden" })` instead of string concatenation; `areaFromPathname` reads the segment after the prefix as today, because area paths are not localised.

### Formats and timezone (`src/i18n/formats.ts`)

```ts
export const TIME_ZONE = "Europe/Zurich";
export const formats = {
  dateTime: {
    dateShort: { day: "2-digit", month: "2-digit", year: "numeric" },
    dateLong: { day: "numeric", month: "long", year: "numeric" },
    dateTime: { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
  },
  number: {
    chf: { style: "currency", currency: "CHF" },
    chfWhole: { style: "currency", currency: "CHF", maximumFractionDigits: 0 },
    percent: { style: "percent", maximumFractionDigits: 1 },
    integer: { maximumFractionDigits: 0 },
  },
} as const satisfies Formats;
```

- Usage everywhere: `format.number(amount, "chf")`, `format.dateTime(date, "dateShort")`, and inside messages `{amount, number, chf}`. `chf` is for prices, invoice lines and VAT; `chfWhole` for benchmark and incident cost estimates so a modelled figure never looks exact. Percentages come from a fraction (0.123), never from a pre multiplied number.
- The request config sets `timeZone: TIME_ZONE` and `formats`; the standalone factory passes the same two. Relative time (`format.relativeTime`) is allowed only next to an absolute `dateTime` (a `title` or a second line), so an email and a screenshot stay meaningful later.
- Every date format uses explicit parts rather than a `dateStyle`, because `dateStyle: "short"` gives a two digit year in `de-CH` and the `medium` and `long` styles abbreviate or change between ICU versions; explicit parts give the same strings on Node 22 (Vercel) and Node 25 (local). The grouping apostrophe in `1’234` is U+2019 up to CLDR 47 (Node 25.1 locally) and the straight U+0027 from CLDR 48 (Node 22.23 in CI); both are correct Swiss formatting, so the tests read the separator from the running ICU and accept either apostrophe, never a dot or space (found when CI first ran on 5 September 2026).
- Rappen rounding to 0.05 is a business rule of feature 11 (checkout) applied to the amount before formatting, not a format.

### Request configuration (`src/i18n/request.ts`)

- `locale` from the request, `messages` from `messages/${locale}.json`, `formats`, `timeZone`.
- `createOnError(captureException)` and `getMessageFallback` are imported from `src/i18n/on-error.ts` (shared with `standalone.ts`); each caller passes its own runtime's `captureException` (`@sentry/nextjs` in the request config, `@sentry/node` in `standalone.ts`, which Trigger.dev bundles), so the report always reaches the client that runtime configured. The returned `onError(error)`: in `development` and `test` rethrow; in production, `MISSING_MESSAGE` and `INVALID_MESSAGE` go to Sentry through `captureException` with the key as the fingerprint for grouping, guarded by a module level `Set` of already reported keys so each key is sent once per process; other codes are logged with `log.warn`. `getMessageFallback({ namespace, key })`: returns `${namespace}.${key}` so the page renders and the gap is visible.
- Typed messages: `src/i18n/global.d.ts` declares `AppConfig` with `Locale` from routing, `Messages` as `typeof import("../../messages/de-CH.json")` and `Formats` as `typeof formats`.

### Client messages (`src/i18n/client-messages.ts`)

- `SHARED_NAMESPACES = ["common", "ui", "states", "theme", "shell", "nav", "brand", "metadata"] as const`.
- `clientMessages(messages, extra = [])` picks the shared set plus `extra` from the full catalog (next-intl's messages object). The locale layout changes from a provider without a `messages` prop (which sends the whole catalog) to `<NextIntlClientProvider messages={clientMessages(await getMessages())}>`. A server component whose client children read a feature namespace does `const messages = await getMessages()` and wraps them in `<NextIntlClientProvider messages={clientMessages(messages, ["company"])}>`; on a static page under `(marketing)` it calls `setRequestLocale(locale)` first, as the layout does, because `getMessages` is request scoped. A nested provider replaces, not merges, the parent's messages, which is why the helper always includes the shared set. Server components keep calling `getTranslations` with the full catalog.
- The gallery page (dynamic, under `/admin`) wraps its client sections with `clientMessages(messages, ["gallery"])` so `gallery` leaves the shared bundle (AC-6).

### Standalone translator and formatter (`src/i18n/standalone.ts`)

- `loadMessages(locale)`: the same dynamic import as the request config, so tasks and emails read the one catalog.
- `createTranslatorFor(locale, namespace?)`: next-intl's `createTranslator` with the messages, formats, timezone and the `onError` and `getMessageFallback` from `on-error.ts`.
- `createFormatterFor(locale)`: next-intl's `createFormatter` with formats and timezone.
- Runs in tasks (`src/trigger/`), server only code and React Email templates (feature 7). Never in a request handler, which uses `getTranslations` and `getFormatter`.

### Stored language (`src/features/localization/`)

- `schema.ts`: `localeCodeSchema = z.enum(["de", "en"])` derived from `LOCALE_CODE` values, `setLocaleSchema = z.object({ locale: localeCodeSchema })`.
- `actions.ts`: `setLocale(input)`, a server action. Parses the input, reads the session through the action client; without a session returns `{ ok: true, data: { persisted: false } }`; with one, updates the caller's own `profiles.locale` (RLS plus the existing column grant enforce ownership) and returns `{ ok: true, data: { persisted: true } }`; a database error returns `{ ok: false, error: "persist_failed" }` after a `log.warn`. It never redirects and never calls `revalidatePath` or `revalidateTag`: the URL is the truth for the page, the profile only feeds what leaves the app.
- `queries.ts`: `localeForUser(client, userId)` and `localeForOrganization(client, organizationId)` select the short code with `maybeSingle` and return `localeFromCode(code)`; a missing row gives the default locale, a database error throws like every query. Tasks pass the service client with an explicit id; request code passes the server client.
- Switchers: `LocaleMenuItems` awaits `setLocale({ locale: LOCALE_CODE[target] })` in `onSelect` and then calls `router.replace` as today, so the write is not cut off by the navigation. `LocaleSwitcher` keeps its links (so it prerenders and the language still switches without JavaScript) and adds an `onClick` that starts the same action without awaiting it: persistence there is best effort, and without JavaScript it silently does not happen, which is accepted because the page itself does not depend on it. Both label each option with `lang` set to the target locale. Since 2026-09-07 `LocaleSwitcher` renders as a segmented pill, the sibling of `ThemeToggle` (same height, border, radius and active treatment, text segments "Deutsch" and "English" instead of icons); the segments stay `Link` elements with `hrefLang`, `lang` and `aria-current` on the active one, never a radio group, so the switch keeps working without JavaScript.
- Sign up (feature 6) passes `LOCALE_CODE[locale]` from the URL into the user metadata, which `handle_new_user` already copies; `create_organization` then copies it to the organisation.

### Validation messages (`src/lib/validation.ts`)

- `zodLocaleError(locale)`: takes a `Locale`, maps it with `LOCALE_CODE`, and returns the `localeError` map from `zod/locales` `de()` or `en()`, memoised per code.
- `parseWith(schema, input, locale)`: `schema.safeParse(input, { error: zodLocaleError(locale) })`. An action that receives a form reads the locale from the form's hidden `locale` field, which posts the full locale (`de-CH`), exactly as the sign in action does today with `hasLocale`; an action called with a plain object reads `getLocale()`.
- Browser forms pass the same map as the second argument of `zodResolver(schema, { error: zodLocaleError(locale) })`.
- Custom rules keep the pattern the gallery form already uses: the schema message is a key (`"companyShort"`) and the form renders `t(`validation.${issue.message}`)` when the message matches a key of the feature's `validation` namespace, else the message itself. `issueMessage(issue, t)` in the same module does that lookup.
- Zod's global config is never mutated, so concurrent requests in different languages cannot leak messages.

### Metadata and sitemap (`src/i18n/metadata.ts`, `src/app/sitemap.ts`)

- `localizedAlternates(pathname, params?)`: returns `{ canonical, languages: { "de-CH": url, "en-CH": url, "x-default": url } }` with absolute URLs from `NEXT_PUBLIC_APP_URL` and `getPathname` per locale, `x-default` pointing at the English URL (amended 2026-09-05). Pages spread it into `alternates` in `generateMetadata`; `canonical` is the URL of the current locale.
- `sitemap.ts` maps `MARKETING_ROUTES` times the locales, each entry with the same alternates; `robots.ts` is unchanged.

### Content rules (`docs/localization.md`)

The written reference `/develop` reads for every feature, next to `docs/design.md`: formal Sie, Swiss spelling (`ss`, never `ß`), British English, a glossary of product terms in both languages (organisation, expert, assessment, gap report, package, benchmark, EHS terms), key naming (`<namespace>.<screen or component>.<key>`, camelCase, verbs for actions, no sentence as key), ICU plurals (`{count, plural, =0 {…} one {…} other {…}}`) and rich text (`t.rich` with named tags), the named formats and when to use each, the timezone rule, the relative time rule, the literal allow list policy, how to add a locale (catalog, `routing.ts`, the three database checks, `zod/locales`, the e2e loop).

### Data model sketch

| Table | Change | Column | Rule |
|---|---|---|---|
| `profiles` | exists (spec 0002) | `locale text not null default 'en' check (locale in ('de','en'))` (default amended 2026-09-05) | Own row editable through the column grant; written by `setLocale` |
| `organizations` | add | `locale text not null default 'en' check (locale in ('de','en'))` (default amended 2026-09-05) | `create_organization` copies the caller's `profiles.locale`; owners update it through the existing owner policy (the deny list trigger is unchanged); ops full access |
| `kpi_definitions` | exists | `name`, `description` jsonb keyed by short code | Read with `LOCALE_CODE[locale]` |

No new table, no new relationship. The `organizations` change lands as one migration from `supabase/schemas/10_organizations.sql` and `11_organization_members.sql` (`create_organization` body), `pnpm db:diff`, then the hand checks from `AGENTS.md` (no column grant, function or view is touched, so nothing to re add), `db:reset`, `test:db`, `db:types`.

**State transitions**: none. A language is a value, not a state machine.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `setLocale` (server action) | POST | `locale: "de" \| "en"` | `{ ok: true, data: { persisted: boolean } }` | any; writes only with a session, own row only | `{ ok: false, error: "invalid_input" }`, `{ ok: false, error: "persist_failed" }` |
| `/` | GET | none | 307 to `/en` | none | none |
| `/de-CH/...`, `/en-CH/...` | GET | none | 307 to `/de/de-CH/...`, then 404 | none | never a rendered page |
| `/sitemap.xml` | GET | none | every marketing route in both locales with alternates | none | none |
| `scaffoldCheck` task | trigger | `message`, `shouldFail`, new `userId?` | row whose `message` is the payload message, `" · "`, and the `scaffold.summary` text with the insert time as `dateTime` | service client, explicit id | throws so Trigger.dev retries |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Any render | Current locale | `[locale]` segment, validated by `hasLocale`; set with `setRequestLocale` on static pages |
| Any render | Formatting locale | The same locale (`de-CH` or `en-CH`), so the formatter, ICU arguments and `html lang` agree |
| Any render | Timezone | `TIME_ZONE` constant in `src/i18n/formats.ts` |
| CHF display | Amount and precision | The feature's numeric value in francs (`numeric` columns, never floats for money); format name chosen by the rule above (`chf` or `chfWhole`) |
| Percent display | Fraction | The feature's ratio between 0 and 1 |
| `setLocale` | Short code to store | `LOCALE_CODE[target]` from the switcher |
| `setLocale` | Row to update | `auth.uid()` through the action client; RLS and the column grant refuse anything else |
| Sign in | Locale after sign in | The URL locale in the form's hidden `locale` field, now `de-CH` or `en-CH` (the `[locale]` param), never the profile |
| Proxy redirects | Locale for `getPathname` | `localeFromCode(pathname.split("/")[1])`, valid because the prefix is the short code |
| Email or task | Recipient locale | `localeForUser(serviceClient, userId)` at send time |
| Report or organisation document | Document locale | `localeForOrganization(serviceClient, organizationId)` |
| `create_organization` | Organisation locale | The caller's `profiles.locale` inside the function |
| New profile | Locale | `raw_user_meta_data.locale` set by feature 6 from `LOCALE_CODE[urlLocale]`, else `en` (the default since 2026-09-05) |
| KPI label | Name in the viewer's language | `kpi_definitions.name ->> LOCALE_CODE[locale]` |
| Zod error text | Localized built in message | `zodLocaleError(locale)` passed per parse or to the resolver |
| Zod error text | Custom rule message | The key in the schema, translated by `issueMessage` from `<feature>.validation` |
| Alternates | Canonical and language URLs | `NEXT_PUBLIC_APP_URL` plus `getPathname` per locale over `PATHNAMES` |
| Sitemap | Public routes | `MARKETING_ROUTES` in `src/i18n/pathnames.ts` |
| Client bundle | Namespaces sent to the browser | `SHARED_NAMESPACES` plus the explicit extras per page |
| Missing key in production | Text shown | `getMessageFallback` returns `namespace.key` |
| Literal scan | Allowed literals | `tests/i18n/literal-allowlist.ts` |
| Scaffold check task | Locale | `payload.userId ? await localeForUser(service, payload.userId) : routing.defaultLocale` |
| Scaffold check task | Summary text and time | `createTranslatorFor(locale)("scaffold.summary", { at })` with `at = new Date()` taken right before the insert, formatted as `dateTime` |

**Key invariants**:
- The two locale lists exist once each: the next-intl locales in `routing.ts`, the short codes in `LOCALE_CODE`; the database checks and `localeCodeSchema` mirror the short codes.
- Every user facing string comes from the catalogs; the literal scan and typed keys are the gate, the allow list is the only exception and is reviewed like code.
- `de-CH.json` and `en-CH.json` have identical key sets and identical ICU placeholders.
- Money is formatted only through `chf` or `chfWhole`; dates only through the three named date formats; nothing calls `Intl` or `toLocaleString` directly (the `chart.tsx` `toLocaleString` call moves to the formatter).
- All times render in `Europe/Zurich`.
- Zod's global configuration is never mutated.
- The URL decides the language of a request; the stored language decides the language of anything sent or generated outside a request.
- User written content (company names, assessment answers, notes) is never machine translated.

**Security model**:
- `setLocale` updates only the caller's row; the `profiles` update policy and the column grant (`full_name`, `locale`) already enforce that, the action adds no service client.
- `organizations.locale`: owners update through the existing owner policy; a plain member has no update policy at all; members and assigned experts read; ops all. No new policy, no trigger change, new pgTAP assertions.
- Tasks read locales with the service client and explicit ids only (`AGENTS.md` rule); the helpers take the client as a parameter so they never create one.
- No personal data beyond a language code; no compliance scope beyond what spec 0002 already covers.

**Configuration required**: none. No new environment variables; `NEXT_PUBLIC_APP_URL` (existing) feeds the absolute URLs.

**Critical test scenarios**:
- Happy path: a visitor opens `/de?x=1`, switches to English in the header, lands on `/en?x=1` with `lang="en-CH"`, and the landing page passes axe in both languages, verifies **AC-1**, **AC-2**, **AC-11**
- Formatting: the Vitest table test formats 4900, 48312.5, 0.1234 and the fixed date in both locales through `createFormatterFor` and through the request formatter and gets the exact strings, verifies **AC-3**, **AC-7**
- Persistence: `setLocale({ locale: "en" })` with a mocked session updates the profile and returns `persisted: true`; without a session returns `persisted: false` and never calls `from`, verifies **AC-2**
- Failure case: a missing key throws in test; with `NODE_ENV=production` the `onError` handler reports once per key and the fallback renders `namespace.key`, verifies **AC-12**
- Gate: adding `<p>Hallo</p>` to a component fails the literal scan; adding a key to `de-CH.json` only fails the parity test; using `t("nope")` fails `pnpm typecheck`, verifies **AC-4**, **AC-5**
- Bundle: the rendered `/de` HTML does not contain the `gallery.title` sentence, verifies **AC-6**
- Validation: the gallery form submitted empty on `/de/admin/design` shows German built in messages and the translated custom rule; on `/en/admin/design` English, verifies **AC-8**
- Auth/permission: pgTAP: a member updating `organizations.locale` is refused, an owner succeeds, an owner changing `archived_at` is still refused, `create_organization` by a user with `locale = 'en'` creates an `en` organisation, verifies **AC-9**
- SEO: `localizedAlternates("/")` returns the three alternates with absolute URLs and `sitemap.xml` lists `/de` and `/en`, verifies **AC-10**
- Routing: `/de-CH` ends on `/de/de-CH` with status 404, and a `Link` to `"/nowhere"` fails `pnpm typecheck`, verifies **AC-1**, **AC-13**

## Build plan

Ordered as Tracer Bullet slices: the first slice changes the locale tags and threads one formatted value from a task through the database to a rendered page in both languages, so the riskiest change (the locale rename) is proven end to end on day one; later slices thicken it.

1. [x] **Thin thread: locale tags, formats, one formatted value end to end.** Switch `routing.ts` to `de-CH` and `en-CH` with the `/de` and `/en` prefixes and add `LOCALE_CODE` and `localeFromCode`; rename the catalogs to `de-CH.json` and `en-CH.json` and update every import (`tests/messages.test.ts`, `brand`, `hero`, `primitives`, `theme-toggle` and `area-error` tests, the request config; `resolveJsonModule` is already on); add `formats.ts`, `on-error.ts`, the request config with formats, timezone, `onError` and `getMessageFallback`, the typed `AppConfig` in `global.d.ts`, and `standalone.ts`; give the scaffold check task an optional `userId`, add `localeForUser` and the `scaffold.summary` key, and make the task write the summary; add a Formatting section to the gallery that shows each named format live; update the `lang` assertions in the existing tests and the sign in form's hidden `locale` field to the full locale; write the formats test and the `on-error.ts` test, satisfies **AC-1**, **AC-3**, **AC-7** (task and helpers), **AC-12**
2. [x] **Route map, localised slugs, switch persistence.** Add `pathnames.ts` with every existing route, `MARKETING_ROUTES`, and wire `pathnames` into routing; move the proxy redirects to `getPathname` with `localeFromCode` and set `alternateLinks: false`; create `src/features/localization/` with the schema, the `setLocale` action and the queries; await the action in the sidebar menu and fire it best effort from the marketing links; write the action test and the Playwright switch and `/de-CH` checks, satisfies **AC-2**, **AC-13**, **AC-11** (switch)
3. [x] **Organisation locale.** Add the column and extend `create_organization` in the schema files (the owner column trigger stays as it is), run the diff and the hand checks, `db:reset`, add assertions to `organizations.test.sql` (owner may update `locale`, member cannot update at all, `archived_at` still pinned) and `create_organization.test.sql` (the locale is copied), regenerate types, add `localeForOrganization`, satisfies **AC-9**, **AC-7** (organisation query)
4. [x] **Catalog conventions and gates.** Reorganise the catalogs into the shared and feature namespaces, add `client-messages.ts`, give the locale layout its explicit `messages` prop and wrap the gallery sections in a nested provider, write the literal scan with its allow list and make the tree pass, extend the parity test to the renamed files, write `docs/localization.md`, satisfies **AC-4**, **AC-5**, **AC-6**
5. [x] **Validation messages.** Add `src/lib/validation.ts` (`zodLocaleError`, `parseWith`, `issueMessage`), switch the gallery form to the resolver with the locale map and the `validation` namespace lookup, and use `parseWith` in the existing sign in action; unit tests for both locales, satisfies **AC-8**
6. [x] **Metadata helper and sitemap.** Add `metadata.ts`, use it in the landing page's `generateMetadata`, rewrite `sitemap.ts` over `MARKETING_ROUTES`; unit test the helper, satisfies **AC-10**
7. [x] **English coverage in Playwright.** `e2e/localization.spec.ts`: the `en` render with axe for every route in `MARKETING_ROUTES` plus sign in, the query keeping switch, the signed in sidebar switch with a reload, the CHF assertion in the gallery Formatting section, and the `/de-CH` check; keep the German suite as it is, satisfies **AC-11**

## Consequences

**Positive**:
- Swiss formatting is automatic wherever next-intl formats, including inside message strings, so later features never think about it.
- Typed keys, the parity test and the literal scan turn "every string is translatable" into a CI failure instead of a review comment.
- Emails, tasks and reports share the app's catalogs and formats through one module; feature 7 and feature 18 only pick a locale.
- Broken links become type errors because the route map is typed; the project had no route typing before.
- Adding French or Italian is a catalog file, a locale entry with its prefix, one migration widening three checks, a Zod locale import and one line in the e2e loop.

**Negative / tradeoffs**:
- Every route is one line in `pathnames.ts`, and links with parameters are objects rather than template strings; a forgotten entry still works at runtime but fails typecheck, which is noise until fixed.
- The locale rename touches many files at once (catalog names, tests, the `lang` assertions, the sign in form); slice 1 is a large diff for a small visible change.
- The `[locale]` segment and cookie carry `de-CH` while the database carries `de`; the mapping lives in one place, but a developer will meet both spellings.
- The literal scan is a heuristic: it can flag legitimate text (a code sample) and needs the allow list maintained; a string built outside JSX (a constant passed to a prop) escapes it, so review still matters there.
- Nested client providers replace the parent's messages; forgetting `clientMessages` in a nested provider drops the shared strings for that subtree. The helper and the rule in `docs/localization.md` are the guard.
- ICU outputs come from the runtime: Node locally (25) and on Vercel (22) can differ in details such as `Sept` versus `Sep`; every named format uses explicit parts and no abbreviation, and a change in ICU shows up as a failing formats test rather than a silent drift.
- The `AGENTS.md` rule that names `messages/<locale>.json` with `de` and `en` goes stale the moment slice 1 renames the catalogs; `/sync` corrects it after merge, and until then the spec is the authority.
- Time is always Zurich time; a user abroad sees Swiss local time, by design, and a later per user timezone would be a profile column and a format change in one module.

**Neutral**:
- No new dependency; `zod/locales`, next-intl's standalone `createTranslator` and `createFormatter`, and the TypeScript compiler API for the scan are already installed.
- `docs/localization.md` joins `docs/design.md` as a reference `/develop` reads for every feature.
- The `chart.tsx` tooltip formatting moves to the formatter, a small change inside a shadcn component that the CLI diff will show later.

## Migration plan

**Strategy**: no data migration; one additive schema migration and one deployment.
**Phases**:
1. Deploy the schema migration (`organizations.locale` with a default and the `create_organization` body) before or with the app; the old app version keeps working because the function signature is unchanged and the column has a default.
2. Deploy the app with the locale rename; an existing `NEXT_LOCALE=de` cookie is ignored by next-intl (unknown value) and rewritten to the resolved locale on the next request, and with detection off the cookie never redirects anyway.
**Rollback**: revert the app commit; the column and the function body are harmless to the previous version.
**Risks**: preview deployments share the staging database (`AGENTS.md`), so the migration must land on `main` first; an unlisted route only fails typecheck, so CI catches it before deploy.

## Follow-up

- [ ] Feature 6 (auth): pass `LOCALE_CODE[locale]` from the sign up URL into the user metadata so `handle_new_user` and `create_organization` store the right language; use `parseWith` in its actions.
- [ ] Feature 7 (email): React Email templates take a `locale` and use `createTranslatorFor` and `createFormatterFor`; the sending task resolves the locale with `localeForUser`, organisation wide mails with `localeForOrganization`.
- [ ] Feature 8 (research): the AI prompt receives the organisation locale for generated summaries; `kpi_definitions` labels use `LOCALE_CODE[locale]`.
- [ ] Feature 11 (checkout): apply Rappen rounding to 0.05 before formatting with `chf`; Stripe Checkout receives `locale` from `LOCALE_CODE`.
- [ ] Feature 13 (marketing): add each page to `PATHNAMES` with its German slug and to `MARKETING_ROUTES`; use `localizedAlternates` in every `generateMetadata`; add a language settings field for the organisation in the client area (or in feature 22).
- [ ] Feature 15 (analytics): capture `locale` (the short code) as a property on every server side event.
- [ ] Feature 18 (gap report): generate in the organisation locale; the document renderer uses the standalone formatter.
- [ ] After merge, `/sync` records in root `AGENTS.md`: the catalog file names, `docs/localization.md` as the content reference, the route map rule (every route in `pathnames.ts`, links with params as objects), the formats rule (never call `Intl` directly), and `src/i18n/standalone.ts` for tasks and emails.
- [ ] French and Italian (deferred in the scope): follow the "how to add a locale" section of `docs/localization.md`; the `x-default` alternate stays English.

## Amendment 2026-09-05: English as the default language

Owner decision, recorded in spec 0001's amendment of the same day: the default locale is `en-CH`. In this spec that changes `DEFAULT_LOCALE` and `routing.defaultLocale` (AC-1), the `x-default` alternate (AC-10), the fallback of `localeFromCode`, `resolveLocale`, `localeForUser` and `localeForOrganization` (AC-7), the column defaults of `profiles.locale` and `organizations.locale` (AC-9) and the fallback inside `handle_new_user` and `create_organization`. The migration `20260905182208_english_default.sql` switches the two column defaults and the two function bodies; existing rows keep their stored language. The lines above marked "amended 2026-09-05" are read with this section.

- **Follow-up for `/architect`**: fold the amended values into `## Feature design` and the value sourcing table.
