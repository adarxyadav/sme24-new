# Localization

How SME24 speaks German and English, and the rules every feature follows so localization never
becomes a review item. Spec [0004](specs/0004-localization/index.md) holds the decision; this page is
the working reference next to [design.md](design.md). Read it before you write a string, a date or
an amount.

## Two spellings of a language

| Where | Value | Why |
|---|---|---|
| next-intl locale, `html lang`, the `NEXT_LOCALE` cookie, the `[locale]` segment | `de-CH`, `en-CH` | Region aware tags make ICU format numbers, dates and CHF the Swiss way |
| URL prefix, `profiles.locale`, `organizations.locale`, `kpi_definitions` jsonb keys | `de`, `en` | Short and stable in the database and in links |

Only `LOCALE_CODE` and `localeFromCode` in `src/i18n/routing.ts` translate between the two. Never
hardcode either list anywhere else; `LOCALES`, `LOCALE_CODE`, the database checks and
`localeCodeSchema` are the four copies that must agree, and the spec lists them.

The URL decides the language of a request. The stored language (profile, organisation) decides the
language of anything sent or generated outside a request: emails, reports, background jobs.

## Content rules

- **Formal address.** German uses Sie, never du.
- **Swiss spelling.** `ss`, never `ß` (Schliessen, Grösse, Massnahme).
- **British English.** organisation, colour, licence (noun), analyse. Product names keep their own spelling (PostHog, Trigger.dev).
- **Short and plain.** One idea per sentence. Buttons are verbs (Anmelden, Speichern; Sign in, Save).
- **User content is never translated.** Company names, assessment answers and notes render as written.

### Glossary

| German | English | Notes |
|---|---|---|
| Organisation, Kundenunternehmen | organisation, client company | The tenant; "Kundenunternehmen" in the shell, "Organisation" in settings |
| Expertin/Experte | expert | Always both forms in German where a person is meant |
| Bewertung | assessment | The structured questionnaire (feature 17) |
| Befund | finding | One gap found by an assessment |
| Gap-Report | gap report | The generated document (feature 18) |
| Paket | package | The fixed price offer (feature 11) |
| Benchmark | benchmark | Kept as is in both languages |
| Kennzahl | KPI | `kpi_definitions` carries both names |
| Arbeitssicherheit, Gesundheitsschutz, Umweltschutz | EHS | The abbreviation stays "EHS" in both languages |
| Ops Team | ops team | The internal team, `/admin` |
| Anmelden / Abmelden | sign in / sign out | Never "login" |
| MWST | VAT | Swiss value added tax |

## Catalogs and keys

- `messages/de-CH.json` is the authoritative catalog; `messages/en-CH.json` mirrors it key for key. The parity test (`tests/messages.test.ts`) fails on any difference, including ICU placeholders.
- Keys are typed through next-intl's `AppConfig` (`src/i18n/global.d.ts`): an unknown key or namespace fails `pnpm typecheck`.
- **Naming**: `<namespace>.<screen or component>.<key>`, camelCase, verbs for actions (`submit`, `retry`), nouns for labels, never a sentence as a key. Group by feature, not by page layout.
- **Shared namespaces** (every client component may read them): `common`, `ui`, `states`, `theme`, `shell`, `nav`, `brand`, `metadata`. They are the only ones the locale layout sends to the browser.
- **Feature namespaces** (`landing`, `auth`, `forbidden`, `areas`, `scaffold`, `gallery`, and one per later feature): server components read them freely with `getTranslations`. A client component that needs one gets it from a nested provider built with `clientMessages(messages, ["<namespace>"])` from `src/i18n/client-messages.ts`, placed in the page or the shell that renders it. A nested provider replaces the parent's messages, which is why the helper always includes the shared set. Forgetting it drops the shared strings for that subtree.
- Every user facing string in a `.tsx` file comes from the catalogs. The literal scan (`tests/i18n/literals.test.ts`) fails on JSX text, string literals in JSX children and the `aria-label`, `placeholder`, `title` and `alt` attributes with two or more letters. The allow list in `tests/i18n/literal-allowlist.ts` is the only exception, reviewed like code: brand names, units, code samples and identifiers, never a translation you skipped.
- Strings in `.ts` files (actions, schemas, constants, emails) are outside the scan. Review them: a message key in a Zod schema, a translator call in a task, never English prose.

### ICU: plurals, selects, rich text

```json
"findings": "{count, plural, =0 {Keine offenen Befunde} one {# offener Befund} other {# offene Befunde}}",
"greeting": "{name, select, other {Guten Tag {name}}}",
"terms": "Ich akzeptiere die <link>Nutzungsbedingungen</link>."
```

- Always give `=0`, `one` and `other`; `#` renders the count with the locale's number format.
- Rich text uses `t.rich("terms", { link: (chunks) => <Link href="/terms">{chunks}</Link> })`; name the tags after their meaning, not their element.
- Formatted values inside messages use the named formats: `{amount, number, chf}`, `{at, date, dateTime}`.

## Formats and time

Named formats live in `src/i18n/formats.ts` and reach every formatter (request and standalone).
Never call `Intl`, `toLocaleString` or `toLocaleDateString` directly.

| Name | Use for | `de-CH` | `en-CH` |
|---|---|---|---|
| `chf` | prices, invoice lines, VAT | `CHF 4’900.00` | `CHF 4’900.00` |
| `chfWhole` | benchmark and incident cost estimates, so a modelled figure never looks exact | `CHF 48’313` | `CHF 48’313` |
| `percent` | a ratio between 0 and 1, never a pre multiplied number | `12.3%` | `12.3%` |
| `integer` | counts | `1’234’567` | `1’234’567` |
| `dateShort` | tables, lists | `04.09.2026` | `04.09.2026` |
| `dateLong` | headings, letters, documents | `4. September 2026` | `4 September 2026` |
| `dateTime` | anything with a time | `04.09.2026, 15:05` | `04.09.2026, 15:05` |

- The grouping apostrophe comes from ICU's CLDR data and changed between versions: U+2019 (`4’900`) up to CLDR 47 (Node 25.1 locally) and the straight U+0027 (`4'900`) from CLDR 48 (Node 22.23 in CI, so also on Vercel once its Node 22 carries that ICU). Both are correct Swiss formatting. The Vitest test reads the separator from the running ICU and pins it to one of the two apostrophes; the Playwright assertion accepts both. The space between `CHF` and the amount is a no break space (U+00A0).
- **Timezone**: every date and time renders in `Europe/Zurich` (`TIME_ZONE`), in the app and in anything a task sends. A user abroad sees Swiss local time, by design.
- **Relative time** (`format.relativeTime`) is allowed only next to an absolute `dateTime` (a `title` or a second line), so an email or a screenshot stays meaningful later.
- Rappen rounding to 0.05 is a business rule of checkout (feature 11), applied to the amount before formatting, not a format.
- Money arrives as francs from `numeric` columns, never as floats built in JavaScript arithmetic.

## Where each helper runs

| Context | Translate | Format | Locale |
|---|---|---|---|
| Server component, page, layout | `getTranslations` | `getFormatter` | `[locale]` param, `setRequestLocale` on static pages |
| Client component | `useTranslations` | `useFormatter` | `useLocale` |
| Server action | `getTranslations` / `getLocale` | `getFormatter` | the form's hidden `locale` field (full tag) or `getLocale()` |
| Task, email template, report | `createTranslatorFor(locale)` | `createFormatterFor(locale)` | `localeForUser` or `localeForOrganization` (`src/features/localization/queries.ts`) with the service client and an explicit id |

`src/i18n/standalone.ts` is never used inside a request; the request config already carries the same catalogs, formats and timezone.

## Routes

- Every route is one line in `src/i18n/pathnames.ts`; links with parameters are objects (`{ pathname: "/app/companies/[id]", params: { id } }`). An unknown href fails `pnpm typecheck`.
- Marketing pages may localise the German slug (`"/pricing": { "de-CH": "/preise", "en-CH": "/pricing" }`) and must be listed in `MARKETING_ROUTES` for the sitemap and the language alternates.
- `localizedAlternates(pathname)` in `src/i18n/metadata.ts` is the single source of `hreflang` links; spread it into `alternates` in every `generateMetadata`. `x-default` points at German.

## Validation messages

- `parseWith(schema, input, locale)` in `src/lib/validation.ts` parses with Zod's `de` or `en` locale map, so built in messages (required, too short, invalid email) arrive in the request language. In the browser, pass the same map to the resolver: `zodResolver(schema, { error: zodLocaleError(locale) })`.
- A custom rule carries a message key (`z.string().min(2, "companyShort")`); the form translates it from the feature's `validation` namespace through `issueMessage(message, t)`.
- Zod's global configuration is never mutated: concurrent requests in different languages must not leak messages.

## Adding a locale (French, Italian)

1. Copy `messages/de-CH.json` to `messages/fr-CH.json` and translate every key; the parity test keeps it complete.
2. Add the locale to `LOCALES` and its short code to `LOCALE_CODE` in `src/i18n/routing.ts`; the prefix follows.
3. Widen the three database checks (`profiles.locale`, `organizations.locale`, the `create_organization` fallback) in `supabase/schemas/` and diff a migration.
4. Add the Zod locale (`fr` from `zod/locales`) to `zodLocaleError` in `src/lib/validation.ts`.
5. Add the locale to the Playwright loops in `e2e/` and the label keys in the two switchers.
6. Localised marketing slugs: add the French path per entry in `PATHNAMES`. `x-default` stays German.
