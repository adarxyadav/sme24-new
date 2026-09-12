# 0018. Contact directory sold to the expert network

**Date**: 2026-09-12
**Status**: Proposed

## Summary

SME24 owns a purchased list of about 80,000 EHS and operations contacts at about 40,000 companies worldwide, and sells access to it to the experts who already sign in under `/expert`. An expert searches by company, title and country, sees every email and phone masked, and spends one credit (CHF 1.99) to reveal a row, which then stays visible to them. Credits come in prepaid packs bought on the existing order rail (the same orders, Stripe webhook, settlement function and QR bill invoice as an assessment package), so no second money path exists. The list itself never enters the repository: a hand run script loads it straight into the database, only for the countries the lawyer clears, and the database is the only place a raw email or phone can be read, through one function that debits the credit and returns the row in the same transaction.

Three decisions are the owner's, taken on 12 September 2026 and recorded here as fixed: buyers are the existing expert accounts (no consultant self serve signup in this slice), payment is credit packs on the spec 0011 rail with the button reading "1 credit, CHF 1.99", and the import loads only the countries the lawyer clears, held as a list in the import policy. The lawyer's answer on the licence and the countries is a launch gate for the feature, not a build blocker.

## Requirements

**User stories**:

- As an EHS consultant with an SME24 expert account, I want to find the safety and operations people at companies I target, so that my outreach starts from a real name and a real address instead of a switchboard.
- As that consultant, I want to see enough of a contact (name, title, company, the shape of the email and phone) to judge whether it is worth paying for, and to pay only for the rows I actually use.
- As that consultant, I want the rows I paid for to stay visible and to leave with me as a file, so that a credit is a purchase and not a rental.
- As the owner, I want every reveal paid for through the same order and invoice machinery as everything else, so that revenue from the directory is booked, invoiced and reconciled like an assessment sale.
- As ops, I want to see who bought what and unlocked what, and to remove a person from the directory the day they object, so that the list stays lawful.
- As a person on the purchased list, I want my data to leave the directory when I ask, and never to come back with the next import.
- As the engineer, I want a proof that no path other than a paid reveal can read a raw email or phone, and that a credit can never be spent twice or go below zero, so that neither the data nor the money needs manual repair.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: `supabase/schemas/50_directory_companies.sql`, `51_directory_contacts.sql`, `52_directory_suppressions.sql`, `53_directory_unlocks.sql`, `54_directory_credit_entries.sql` and `55_directory_imports.sql` declare the six tables of the data model sketch with RLS on. `directory_companies`, `directory_contacts` and `directory_suppressions` carry **no select policy for `authenticated`** except the ops one: an expert or a client selecting any of the three through PostgREST gets zero rows, and `directory_search` and `directory_unlocked_contacts` (both `security definer`) are the only read paths. pgTAP files `directory_contacts.test.sql`, `directory_search.test.sql`, `directory_reveal.test.sql`, `directory_unlocks.test.sql` and `directory_credit_entries.test.sql` prove it with a handful of invented rows: an expert selecting `directory_contacts` gets zero rows, an expert cannot insert, update or delete on any of the six tables, and a client gets `SM403` from every directory function. The rows in `docs/legal/record-of-processing.md` land in the same migration commit, because `record_of_processing.test.sql` fails until they do.
- **AC-2**: `pnpm directory:import <path-to-xlsx> [--dry-run]` (`scripts/directory-import.mts`) reads the workbook from a path outside the repository, maps the twelve columns by header name and refuses to run when one is missing, and upserts through the service client: a company by `(name_normalised, country)` and a contact by lowercased `email`. It skips a row whose email is not a valid address, whose country is in `IMPORT_POLICY.excludedCountries`, whose country cannot be mapped to an ISO 3166 alpha 2 code (reported by the unmapped name so the map can grow), whose country is missing while `IMPORT_POLICY.loadRowsWithoutCountry` is `false`, or whose email hash sits in `directory_suppressions`. It writes one `directory_imports` row with the counts per outcome and per country, prints those counts and nothing else (never an email, a name or a company name), and `--dry-run` prints the same counts without writing. It refuses to run against any Supabase URL that is not the local stack while `IMPORT_POLICY.status` is not `'cleared'`.
- **AC-3**: `IMPORT_POLICY` in `src/features/directory/import-policy.ts` is `{ status: 'awaiting_lawyer' | 'cleared', excludedCountries: readonly CountryCode[], loadRowsWithoutCountry: boolean, licenceNote: string }`, shipped as `awaiting_lawyer` with an empty exclusion list and `loadRowsWithoutCountry: false`. A Vitest test asserts that a `cleared` policy names a non empty `licenceNote` (the lawyer's answer, dated) and that every code in the list is a valid alpha 2 code; nothing else about the list is asserted, because its contents are the lawyer's, not the engineer's.
- **AC-4**: `directory_search(q, country, title, after_name, after_id, page_size)` returns at most 25 rows ordered by `(company name normalised, contact id)` with keyset pagination, and refuses a page deeper than 40 pages of one query (`SM429`, `page_depth`), so one query can walk at most 1,000 rows. `q` matches the company name (case insensitive contains, backed by a trigram index), `title` matches the contact title the same way, `country` is an exact alpha 2 match; all three are optional, and an empty query returns the first page of the whole directory. Every row carries `email_masked`, `phone_masked` and `mobile_masked` from `private.mask_email` and `private.mask_phone` (first character of the local part, then bullets, then `@` and the full domain; the first four and last two characters of a phone, every other digit a bullet) and `unlocked boolean`; the raw `email`, `phone` and `mobile` columns are non null only when `unlocked` is true for the caller. The function raises `SM403` (`forbidden`) unless the caller is ops or an expert whose `expert_profiles.status` is `active`.
- **AC-5**: `/expert/directory` (force dynamic, in the expert shell, `Directory` in the expert sidebar after `Profile`) renders the search form (company, title, country as a labelled select over the codes present in the directory), the results table (company, city and country, name, title, masked email, masked phone, and per row either "Unlock · 1 credit, CHF 1.99" or the revealed values), a "Load more" control that carries the keyset cursor in the URL, the caller's credit balance and a "Buy credits" link in the page header, and the empty state from the design system. Every string lives under the `directory` namespace in both catalogs, the page is built to `docs/design.md`, and it passes axe in Playwright.
- **AC-6**: `packages` gains `kind text not null default 'assessment' check (kind in ('assessment','directory_credits'))` and `credits integer null check ((kind = 'directory_credits') = (credits is not null))`, and the `key` check gains `directory_50`. One row `directory_50` is seeded by a data migration: `kind 'directory_credits'`, `credits 50`, `price_rappen 9950` (50 × CHF 1.99 net), the default VAT rate. `CREDIT_PACKS` and `CREDIT_PRICE_RAPPEN = 199` in `src/features/directory/catalogue.ts` hold the same key, credits and price, kept equal to the table by a Vitest test in the shape of `tests/features/checkout/packages.test.ts`; that existing test now compares `PACKAGES` to the `assessment` rows only, so the pricing page never lists a credit pack.
- **AC-7**: `orders`, `invoices` and `order_events` accept an expert buyer: `organization_id` and `orders.company_id` become nullable, `orders` and `invoices` gain `buyer_expert_id uuid null references profiles(id) on delete restrict`, `orders` gains `credits integer null`, and the check `orders_check_buyer` holds `num_nonnulls(organization_id, buyer_expert_id) = 1`, `(company_id is null) = (organization_id is null)` and `(credits is null) = (buyer_expert_id is null)`. An expert inserts a pending order only with `buyer_expert_id = auth.uid()`, `created_by = auth.uid()`, `organization_id` and `company_id` null, `status 'pending'` and a `package_key` whose `kind` is `directory_credits`; an expert reads only orders, invoices and order events where `buyer_expert_id` (or the order's) is theirs; a client can never set `buyer_expert_id`. `orders.test.sql` gains a case per rule, and every existing case still passes.
- **AC-8**: `public.settle_order` grants the credits inside the same transaction that writes `paid`: when the order's package `kind` is `directory_credits` it inserts one `directory_credit_entries` row (`expert_id` the buyer, `delta` the order's frozen `credits`, `reason 'purchase'`, `order_id`), guarded by the partial unique index on `(order_id) where reason = 'purchase'` so a settle retry, an ops mark paid racing the webhook, or a second webhook delivery grants exactly once. The invoice copies `buyer_expert_id` and leaves `organization_id` null. A pgTAP case settles a credit pack order twice and finds one ledger row.
- **AC-9**: `startCreditCheckout(previous, input)` and `requestCreditInvoice(previous, input)` in `src/features/directory/actions.ts` (expert only, `requireActiveExpert` mints the lazy `Actor.service()` the way `requireClient` and `requireOps` do) parse `{ packKey, billing address fields, paymentMethod, locale }` with `creditCheckoutSchema`, reuse `computeAmounts`, `next_order_reference`, the billing address rules and the Stripe session helper of spec 0011, freeze `credits` and `package_name_snapshot` (the pack name in the buyer's language) onto the order, store the session id through the service client and withhold the payable URL unless that write is confirmed (spec 0011's rule), and answer the spec 0011 typed results. The bank transfer path issues the invoice through the existing `issue-invoice` task; the credits arrive when ops mark it paid. `/expert/directory/credits` holds the pack card, the billing form and the two buttons, and the return page reads the order and never writes it.
- **AC-10**: `confirm-order`, `render-invoice`, `issue-invoice`, `sweep-orders`, the ops order actions and the ops orders list all handle an order whose `organization_id` is null: the confirmation email goes to `created_by` with `organizationId` omitted, the `payment.received` alert names the buyer as `Expert: <full name>`, `payment.completed` is **not** captured for an expert order (its schema requires an organization) and `directory.credits_purchased` is captured instead, the invoice PDF renders from the frozen billing address unchanged, and `/admin/orders` shows the buyer column as the expert's name with a `Credits` badge. No existing test changes its expectation; the client path keeps asserting its non null organization at the boundary.
- **AC-11**: `directory_reveal(contact_id)` (`security definer`) runs in one transaction under `pg_advisory_xact_lock` keyed on the caller's user id: it refuses a caller who is not an active expert (`SM403`), refuses a missing or suppressed contact (`SM404`), returns the full row without a debit when a `directory_unlocks` row for the caller already exists, otherwise raises `SM402` (`insufficient_credits`) when `sum(delta)` over the caller's ledger is below 1, else inserts the unlock and a ledger row (`delta -1`, `reason 'unlock'`, `unlock_id`) and returns the full row with the new balance. `directory_credit_entries` and `directory_unlocks` revoke insert, update and delete from `authenticated`; the function is the only write path. pgTAP proves the debit, the idempotent second call, the refusal at zero, and that two reveals on a balance of one leave the balance at zero and one unlock.
- **AC-12**: `revealContact(previous, input)` in `src/features/directory/actions.ts` parses `{ contactId, locale }`, calls `directory_reveal` on the user client, maps `SM402` to `insufficient_credits`, `SM404` to `not_found`, `SM403` to `forbidden`, answers `{ ok: true, data: { contact, balance, alreadyUnlocked } }` and never throws for an expected failure. The unlock button swaps in the revealed values and the new balance in the click handler that awaited the result (never a `useEffect` on `result`), and `insufficient_credits` renders an inline sentence with the link to `/expert/directory/credits`.
- **AC-13**: `/expert/directory/unlocks` lists the caller's unlocked contacts newest first through `directory_unlocked_contacts(after_created_at, after_id, page_size)` (the same masking free shape as a revealed row) with keyset pagination, and `GET /[locale]/expert/directory/unlocks/export` (a route handler on the user client, expert only, `notFound` for anyone else) streams the caller's unlocks as `text/csv; charset=utf-8` with a byte order mark, RFC 4180 quoting, one header row in the caller's language, the columns company, country, city, first name, last name, title, email, phone, mobile, unlocked at, and `Content-Disposition: attachment; filename="sme24-directory-unlocks-<yyyy-mm-dd>.csv"`. A cell that starts with `=`, `+`, `-` or `@` is prefixed with a single quote so a spreadsheet never executes it.
- **AC-14**: `directory.searched` (`locale`, `resultCount`, `hasQuery`, `hasCountry`, `hasTitle`, `page`), `directory.unlocked` (`locale`, `contactId`, `alreadyUnlocked`, `balanceAfter`) and `directory.credits_purchased` (`locale`, `orderId`, `packageKey`, `credits`, `grossRappen`) join `ANALYTICS_EVENTS` with schemas that declare no `organizationId` (an expert belongs to none) and carry no query text, no name, no email and no company name. `directory.searched` fires from the search page's server read after the function returns, `directory.unlocked` from `revealContact` after the RPC succeeds, `directory.credits_purchased` from `confirm-order` only when `alreadySettled` is false, with a `dedupeKey` on the order id. `tests/lib/analytics/catalogue.test.ts` places the three in the no organization group and `docs/analytics.md` gains their rows.
- **AC-15**: `/admin/directory` (ops only, `Directory` in the admin sidebar before `Design gallery`) shows the latest `directory_imports` row (batch, when, counts per outcome and per country), the totals (companies, contacts, suppressed), and a table of experts with a balance or an unlock (name, email, balance, credits bought, unlocks, last unlock) from `directory_ops_summary()`; a "Remove a person" form takes an email address, and `removeDirectoryContact(previous, input)` (ops only) calls `directory_remove_contact(email, reason)`, which deletes the contact row (cascading their unlocks, leaving ledger rows with `unlock_id` null) and inserts the email hash into `directory_suppressions` in one transaction, answering `removed` or `not_found` (a not found email is still suppressed, so an objection lands before the next import). The action carries no email into the log or an event.
- **AC-16**: The privacy page gains a "Contact directory" block from a `DIRECTORY_PROCESSING` constant in `src/features/legal/processors.ts` (the source batch name, the purpose, the legal basis, the objection address and the promise to remove within 30 days and keep the hash so the person never returns), `RETENTION` gains the six tables, `docs/legal/record-of-processing.md` carries a row per table, and the terms page gains a "Purchased contacts" clause (own business development only, no resale or sharing, no bulk extraction beyond the export of one's own unlocks, respect for every objection, compliance with the marketing law of the contact's country) shipped as `CURRENT_TERMS_VERSION '2'` with its `legal.terms.changelog.2` key in both catalogs, a `TERMS_VERSIONS` entry and a moved `TERMS_UPDATED`, all in the same commit as the lawyer's wording.
- **AC-17**: The launch gate is recorded and mechanical: `IMPORT_POLICY.status` flips to `cleared` only in a commit that also carries the lawyer's `licenceNote` and the exclusion list they named, the per environment checklist in `docs/directory.md` lists that commit, one real import on staging with its `directory_imports` row, one real pack purchase and one reveal, the Slack alert, the two invoices (card and bank transfer) and the CSV, and nothing in the feature goes to production before every box is ticked. No personal data from the list appears in a test, a fixture, a seed, a migration, an artifact, a screenshot or a pull request.

## Decision

**Chosen option**: Option 2: An expert buyer on the existing order rail, a credit ledger granted by `settle_order`, and reads only through two definer functions.

The expert becomes a second kind of buyer on `orders` (a `buyer_expert_id` column with a check that exactly one buyer shape holds), so a credit pack is an ordinary order that Stripe, the webhook, `settle_order`, the invoice number sequence, the QR bill PDF and the ops mark paid all already know how to handle; `settle_order` grants the credits in the same transaction as `paid`. Credits are an append only ledger whose balance is a sum, debited by one `security definer` function that checks, debits and returns the full contact row atomically; the directory tables themselves are unreadable to every app role, so the database, not the app, is the only thing that ever masks or reveals a value.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `stripe-best-practices` (`stripe/ai`, `.claude/skills/stripe-best-practices/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `posthog-instrumentation` (`posthog/posthog-for-claude`, `.claude/skills/posthog-instrumentation/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `frontend-design` (`anthropics/skills`, `.claude/skills/frontend-design/`)

## Rationale

Reasoning, the options weighed and the questions still open for the owner: see [rationale.md](rationale.md).

## Feature design

### How the spec 0002 table contract applies

The directory is not tenant data: no client organization owns a contact, and an expert belongs to no organization. So none of the six tables is kind T, and the "copy this for every kind T table" block does not apply. Each table names its kind and its deviation in its schema file header, the way `orders` and `packages` do:

| Table | Kind | Ownership column | Who reads | Who writes | Deviation from the kind's template, and why |
|---|---|---|---|---|---|
| `directory_companies` | G global reference | none | ops directly; experts only through `directory_search` and `directory_unlocked_contacts` | the import script (service role), `directory_remove_contact` | Kind G says every signed in user reads. Here nobody reads the table: the data is personal and priced, so the only read is a definer function that masks and checks the role. No audit trigger: an import writes tens of thousands of rows in one run and `directory_imports` is the audit of that run, the same reasoning `packages` gives for skipping it. |
| `directory_contacts` | G | none | as above | as above | As above. Holds the raw email and phones; the mask lives in `private.mask_email` and `private.mask_phone`, so the raw value never leaves Postgres unmasked except through `directory_reveal`. |
| `directory_suppressions` | G | none | ops | `directory_remove_contact`, the import script | Holds a SHA 256 hash of the email, never the address, so an objection outlives the row it was about without keeping the data. |
| `directory_unlocks` | E expert owned | `expert_id` | that expert (own rows), ops | `directory_reveal` only; insert, update and delete revoked from `authenticated` | The kind E template lets the expert write their own rows; here the write costs money, so it is a function. Audit trigger on. |
| `directory_credit_entries` | E | `expert_id` | that expert (own rows), ops | `settle_order` (purchase), `directory_reveal` (unlock), the service client after `requireOps` (grant, refund) | Append only: no update or delete for anyone but the service role, guarded like `order_events`. Audit trigger on. |
| `directory_imports` | I internal | none | ops | the import script (service role) | One row per import run; ops read it on `/admin/directory`. |

`orders`, `invoices` and `order_events` stay kind T with the spec 0011 deviation (no expert read of a client's order) and gain a second buyer shape: an expert reads exactly the rows where they are the buyer, never a client's, and a client never sees an expert's.

### Data model sketch

**`packages`** gains two columns and one key:

| Column | Type | Notes |
|---|---|---|
| `kind` | `text not null default 'assessment' check (kind in ('assessment','directory_credits'))` | The pricing page and the checkout of spec 0011 read `assessment` rows only |
| `credits` | `integer null check ((kind = 'directory_credits') = (credits is not null) and (credits is null or credits > 0))` | How many credits one purchase grants |

The `key` check gains `directory_50`. Seeded by a data migration (production needs the row): `directory_50`, `kind 'directory_credits'`, `credits 50`, `price_rappen 9950`, `sort_order 10`, `is_active true`. `CREDIT_PACKS` in `src/features/directory/catalogue.ts` mirrors key, credits and price; `CREDIT_PRICE_RAPPEN = 199` is the unit price the button shows.

**`orders`** (kind T, spec 0011) gains the second buyer shape, additively:

| Column | Change | Notes |
|---|---|---|
| `organization_id` | `not null` dropped | Null for an expert buyer. Every existing policy compares it to `jwt_org_id()`, which is false for null, so no client ever sees an expert order |
| `company_id` | `not null` dropped | Null with `organization_id` |
| `buyer_expert_id` | `uuid null references profiles(id) on delete restrict` | The expert who bought; `restrict` because an order is kept ten years and a profile is anonymised, never deleted |
| `credits` | `integer null check (credits is null or credits > 0)` | Frozen from `packages.credits` at purchase, like the price, so a pack resized later never changes what a pending invoice buyer receives |
| check `orders_check_buyer` | new | `num_nonnulls(organization_id, buyer_expert_id) = 1 and (company_id is null) = (organization_id is null) and (credits is null) = (buyer_expert_id is null)` |
| index | new | `(buyer_expert_id, created_at desc) where buyer_expert_id is not null` |

**`invoices`**: `organization_id` nullable, `buyer_expert_id uuid null references profiles(id) on delete restrict`, check `num_nonnulls(organization_id, buyer_expert_id) = 1`, partial index on `buyer_expert_id`. **`order_events`**: `organization_id` nullable (the trail row of an expert order carries null; the order id is the join).

**`directory_companies`** (kind G, restricted)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `name` | `text not null check (char_length(name) between 1 and 300)` | As in the list, trimmed |
| `name_normalised` | `text not null` | `lower`, trimmed, inner whitespace collapsed; the import key and the sort key |
| `country` | `text null check (country ~ '^[A-Z]{2}$')` | Alpha 2 from the import map; null when the list gave none |
| `city`, `state` | `text null` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Unique index `(name_normalised, coalesce(country, ''))`; index `(name_normalised)`; GIN trigram index on `name` (`pg_trgm`, enabled in `extensions`).

**`directory_contacts`** (kind G, restricted)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | The id every event and unlock carries; opaque outside the database |
| `company_id` | `uuid not null references directory_companies(id) on delete cascade` | |
| `first_name`, `last_name` | `text null check (char_length(x) <= 200)` | Shown unmasked in results: the name is what a consultant searches for |
| `title` | `text null check (char_length(title) <= 300)` | |
| `email` | `text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')` | The import key |
| `phone`, `mobile` | `text null check (char_length(x) <= 50)` | Kept as typed, trimmed |
| `street`, `city`, `state`, `postal_code` | `text null` | |
| `country` | `text null check (country ~ '^[A-Z]{2}$')` | The search filter column |
| `source_batch` | `text not null` | The workbook's Summary sheet source name, `20260902 Global Account Lists` for the first file |
| `imported_at` | `timestamptz not null` | Set by every upsert, so a row absent from the next file is findable |
| `created_at`, `updated_at` | | |

Indexes: `(company_id, id)`, `(country)`, GIN trigram on `title`, `(last_name, first_name)`.

**`directory_suppressions`** (kind G, restricted): `email_hash text primary key` (SHA 256 hex of the lowercased email), `reason text not null check (reason in ('data_subject_request','bounce','ops'))`, `created_by uuid null references profiles(id) on delete set null`, `created_at`.

**`directory_unlocks`** (kind E): `id uuid pk`, `expert_id uuid not null references profiles(id) on delete cascade`, `contact_id uuid not null references directory_contacts(id) on delete cascade`, `created_at`. Unique `(expert_id, contact_id)`; index `(expert_id, created_at desc, id)` for the unlocks page keyset.

**`directory_credit_entries`** (kind E, append only)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | |
| `expert_id` | `uuid not null references profiles(id) on delete cascade` | |
| `delta` | `integer not null check (delta <> 0)` | Positive for a purchase or grant, negative for an unlock or a refund reversal |
| `reason` | `text not null check (reason in ('purchase','unlock','grant','refund'))` | `grant` and `refund` exist so a later ops action needs no migration; no UI writes them in this slice |
| `order_id` | `uuid null references orders(id) on delete restrict` | Set for `purchase` |
| `unlock_id` | `uuid null references directory_unlocks(id) on delete set null` | Set for `unlock`; null after a removed contact cascades the unlock away |
| `created_by` | `uuid null references profiles(id) on delete set null` | The ops actor for `grant` or `refund` |
| `note` | `text null check (char_length(note) <= 500)` | Ops reason |
| `created_at` | | |

Unique partial `(order_id) where reason = 'purchase'` (one grant per order, whatever the retries); unique partial `(unlock_id) where reason = 'unlock'`; index `(expert_id)`. The balance is `sum(delta)` at read time, never stored.

**`directory_imports`** (kind I): `id`, `source_batch text not null`, `file_name text not null` (the base name only), `rows_read`, `rows_loaded`, `rows_updated`, `rows_skipped_invalid`, `rows_skipped_country`, `rows_skipped_no_country`, `rows_skipped_suppressed` (all `integer not null default 0`), `countries jsonb not null default '{}'` (loaded counts per alpha 2 code), `excluded_countries text[] not null`, `dry_run boolean not null`, `started_at`, `finished_at timestamptz null`, `created_at`.

### State transitions

An order keeps the spec 0011 and 0014 machine; an expert order never enters a delivery state (there is nothing to schedule), which the app enforces by never offering the schedule action on a `credits` order and the database by `orders_check_delivery_columns` being unaffected.

A contact: `present → removed` (deleted, hash suppressed). A suppression never lifts through the app; ops delete the hash row by hand if a person asks to be re listed, which nobody will.

A credit: `granted (+n) → spent (−1 per unlock)`. Balance is never negative: `directory_reveal` checks under the advisory lock, and the ledger has no other debit path.

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `directory_search(q, country, title, after_name, after_id, page_size)` | RPC, definer | `q text` (opt, 2 to 100 chars), `country text` (opt, alpha 2), `title text` (opt), cursor pair (opt), `page_size int default 25` (max 25) | rows: `contact_id`, `company_id`, `company_name`, `company_country`, `company_city`, `first_name`, `last_name`, `title`, `country`, `city`, `email_masked`, `phone_masked`, `mobile_masked`, `unlocked`, `email`, `phone`, `mobile` (raw three null unless `unlocked`) | active expert or ops | `SM403` forbidden, `SM429` page_depth |
| `directory_reveal(contact_id)` | RPC, definer | `contact_id uuid` | the full row plus `balance int`, `already_unlocked bool` | active expert | `SM403`, `SM404` not_found, `SM402` insufficient_credits |
| `directory_credit_balance()` | RPC, definer | none | `int` | expert (own), ops with an `expert_id` overload | `SM403` |
| `directory_unlocked_contacts(after_created_at, after_id, page_size)` | RPC, definer | cursor pair (opt), `page_size int default 25` (max 500, for the export) | full rows plus `unlocked_at` | active expert (own unlocks) | `SM403` |
| `directory_ops_summary()` | RPC, definer | none | one row per expert with a balance or an unlock: `expert_id`, `full_name`, `email`, `balance`, `credits_bought`, `unlocks`, `last_unlock_at` | ops | `SM403` |
| `directory_remove_contact(email, reason)` | RPC, definer | `email text`, `reason text` | `removed bool` | ops | `SM403` |
| `startCreditCheckout(previous, input)` | server action | `packKey`, billing fields, `locale` | `checkoutUrl`, `orderId`, `reference` | active expert | spec 0011's `CheckoutError` set |
| `requestCreditInvoice(previous, input)` | server action | as above | `orderId`, `reference`, `invoiceNumber` | active expert | as above |
| `revealContact(previous, input)` | server action | `contactId`, `locale` | `contact`, `balance`, `alreadyUnlocked` | active expert | `insufficient_credits`, `not_found`, `forbidden`, `validation`, `unexpected` |
| `removeDirectoryContact(previous, input)` | server action | `email`, `reason` | `removed` | ops | `validation`, `forbidden`, `unexpected` |
| `/[locale]/expert/directory` | GET page | `q`, `country`, `title`, `after` (search params) | the page | expert shell gate | `notFound` on a malformed cursor |
| `/[locale]/expert/directory/credits` | GET page | `order` (return) | the page | expert shell gate | |
| `/[locale]/expert/directory/unlocks` | GET page | `after` | the page | expert shell gate | |
| `/[locale]/expert/directory/unlocks/export` | GET route handler | none | `text/csv` attachment | expert (route checks the claims itself) | `404` for anyone else |
| `/[locale]/admin/directory` | GET page | none | the page | ops shell gate | |
| `pnpm directory:import <xlsx> [--dry-run]` | script | the file path, `IMPORT_POLICY` | counts on stdout, one `directory_imports` row | the service key of the target environment | exit 1 on a missing header, a missing key, or a non local URL while not `cleared` |

Every function is `security definer`, `set search_path = ''`, `revoke execute from anon, public`, `grant execute to authenticated`, and starts with its role check (`private.jwt_app_role()` and, for an expert, `expert_profiles.status = 'active'`), the shape `assigned_organization_contacts` already uses.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| import | `name_normalised` | derived: `lower(trim(regexp_replace(name, '\s+', ' ', 'g')))`, one function `normaliseCompanyName` in `src/features/directory/normalise.ts` shared by the script and its test |
| import | `country` (alpha 2) | `COUNTRY_NAMES` in `src/features/directory/countries.ts`, a map from the spellings the list uses to alpha 2, grown from the unmapped names the dry run reports; a row whose name is unmapped is skipped and counted |
| import | `email` | the Email column, lowercased and trimmed, validated by `z.email()` |
| import | `email_hash` (for the suppression check) | SHA 256 hex of the lowercased email through Node's `crypto`, the same function `directory_remove_contact` uses in SQL (`encode(sha256(convert_to(lower(email), 'UTF8')), 'hex')`), with a Vitest and a pgTAP case on one invented address to keep the two equal |
| import | `source_batch` | the `--batch` flag, defaulting to the Summary sheet's source cell; recorded on every contact and the import row |
| import | skip or load | `IMPORT_POLICY` (`excludedCountries`, `loadRowsWithoutCountry`, `status`), the suppression table |
| import | which environment | `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the shell or `.env.local`, the `benchmarks:recompute` pattern; "local" means a URL whose host is `127.0.0.1` or `localhost` |
| `directory_search` | `email_masked` | `private.mask_email(email)`: first character of the local part, then `max(3, length(local) − 1)` bullets (U+2022), then `@` and the domain; the prototype's rule |
| `directory_search` | `phone_masked`, `mobile_masked` | `private.mask_phone(x)`: characters at positions 1 to 4 and the last 2 kept, every other digit a bullet, non digits kept |
| `directory_search` | `unlocked` | `exists (select 1 from directory_unlocks where expert_id = auth.uid() and contact_id = c.id)`; ops always `false` (ops read raw rows through their table policy, not through the reveal) |
| `directory_search` | page and cursor | `page_size` clamped to 25; the cursor is `(name_normalised, contact id)` of the last row, base64url in the `after` search param, parsed with a zod schema; page depth counted by the `page` search param the page passes, capped at 40 |
| `directory_search` | the country select's options | `directory_countries()` (definer, expert or ops): distinct `country` codes with a count, labelled through `Intl.DisplayNames` in the reader's locale in the server component |
| search page | balance in the header | `directory_credit_balance()` |
| unlock button | "1 credit, CHF 1.99" | `CREDIT_PRICE_RAPPEN` through `rappenToChf` and the `chf` number format; no five Rappen rounding, because a unit price is not a cash total (spec 0011 applies `roundToFiveRappen` to totals only) |
| `startCreditCheckout` | `net_rappen`, `vat_rate`, `vat_rappen`, `gross_rappen` | `packages.price_rappen` and `vat_rate` read at action time through `computeAmounts` (spec 0011) |
| `startCreditCheckout` | `credits` | `packages.credits` at action time, frozen |
| `startCreditCheckout` | `package_name_snapshot` | `directory.packs.<key>.name` in the buyer's locale |
| `startCreditCheckout` | `reference` | `next_order_reference()` (spec 0011) |
| `startCreditCheckout` | billing address | the form, validated by the spec 0011 billing rules, prefilled from nothing (an expert has no company record); `billing_name` defaults to the expert's `full_name` |
| `startCreditCheckout` | the Stripe locale and return URLs | `LOCALE_CODE[locale]`, the return path `/expert/directory/credits?order=<id>` |
| `settle_order` | the credits to grant | `the_order.credits` (frozen), never `packages.credits` at settle time |
| `settle_order` | `invoices.buyer_expert_id` | `the_order.buyer_expert_id` |
| `confirm-order` | the alert's `organizationName` for an expert order | `'Expert: ' || profiles.full_name` (falls back to `'Expert'` when null) |
| `confirm-order` | which event to capture | `order.buyer_expert_id is null` → `payment.completed`, else `directory.credits_purchased` |
| `directory_reveal` | `balance` | `coalesce(sum(delta), 0)` over the caller's ledger rows inside the lock |
| `revealContact` | `alreadyUnlocked` | the function's return column |
| unlocks page and export | the rows | `directory_unlocked_contacts` in pages of 25 (page) or 500 (export, looping until a short page) |
| export | header row language | `getLocale()` of the request, keys `directory.export.columns.*` |
| export | `unlocked at` | `directory_unlocks.created_at` formatted ISO 8601 in UTC (a spreadsheet parses it; the page shows it in `Europe/Zurich` through `dateTime`) |
| export | file name date | the server clock in `Europe/Zurich`, `yyyy-mm-dd` |
| `/admin/directory` | balances, counts | `directory_ops_summary()`, `directory_imports` (latest row), counts from the tables under the ops policies |
| `directory_remove_contact` | the hash | the SQL expression above, on the lowercased input |
| events | `contactId` | `directory_contacts.id` |
| events | `locale` | `LOCALE_CODE[locale]` of the request (`getLocale()`), never a header string |
| privacy page | the directory block's facts | `DIRECTORY_PROCESSING` in `processors.ts` (batch name, supplier description, objection address from `SITE`, the 30 day promise) |
| terms | the new clause | `legal.terms.sections.purchasedContacts.*` in both catalogs, wording from the lawyer, changelog under `legal.terms.changelog.2` |

### Key invariants

1. No app role can select a raw `email`, `phone` or `mobile` from `directory_contacts`: the table has no `authenticated` select policy but the ops one, and both definer read functions null the raw columns unless an unlock row exists for the caller. Enforced by policies and function bodies; proven by pgTAP.
2. A credit balance is never negative: the only debit is `directory_reveal`, which checks `sum(delta) >= 1` under `pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0))` before inserting.
3. One unlock per expert per contact: `unique (expert_id, contact_id)`; a second reveal returns the row without a debit.
4. One grant per order: the partial unique index on `directory_credit_entries (order_id) where reason = 'purchase'`, inserted with `on conflict do nothing` inside `settle_order`, so any number of settle calls grant once.
5. Credits are granted in the same transaction as `paid`: a paid credit pack order without a ledger row cannot exist, and a ledger row without a paid order cannot exist (the insert happens after the status update in the same function).
6. Exactly one buyer shape per order and per invoice: `orders_check_buyer` and its invoice twin; a client never sets `buyer_expert_id` (not in their insert policy's `with check`) and an expert never sets `organization_id`.
7. `orders.credits` is frozen at purchase and is what `settle_order` grants, so a resized pack changes only future orders.
8. A suppressed hash never re enters: the import checks `directory_suppressions` before every upsert, and `directory_remove_contact` writes the hash before deleting the row.
9. Every amount is whole Rappen through `computeAmounts`; `gross_rappen = net_rappen + vat_rappen` stays a check constraint (spec 0011).
10. No search result, event, log line, alert or script output carries an email address, a phone number, a person's name or a company name from the list; the CSV export is the one surface that does, to the buyer, of their own unlocks.
11. The list never enters the repository: the script reads a path outside it, `docs/raw/` stays gitignored, tests use invented rows, and the import is refused against a hosted database until `IMPORT_POLICY.status` is `cleared`.

### Security model

Compliance scope: the revised Swiss FADP and the GDPR for contacts in the EU, plus the marketing law of every loaded country for the buyer's use (the terms clause moves that duty to the buyer). The people on the list are data subjects who never signed up to SME24; the legal basis is legitimate interest under the supplier's licence, which the lawyer confirms as the launch gate. Audit logs are not negotiable: `directory_unlocks` and `directory_credit_entries` carry the `private.audit_row()` trigger, `orders` and `invoices` already do, and `directory_imports` is the audit of every bulk write.

| Who | Can | Cannot |
|---|---|---|
| Expert, `active` | search (masked), reveal for a credit, read their own unlocks, balance, orders, invoices and order events, buy a credit pack, export their own unlocks | read any directory table directly, read another expert's anything, set `organization_id` on an order, buy an assessment package, update or delete an unlock or a ledger row |
| Expert, `invited` or `inactive` | nothing in the directory (`SM403` from every function; the shell gate redirects them first) | |
| Client | nothing in the directory (`SM403`); their own orders as before | see any expert order or any directory row |
| Ops | read every directory table, the ops summary, remove a person, mark a bank transfer credit order paid, read every order | reveal (ops read raw rows through the table policy, never through a paid path), write a ledger row except through a future ops action on the service client |
| Service role | everything, from `scripts/` and `src/trigger/` only | |
| `anon` | nothing (no policy, execute revoked) | |

The proxy gates `/expert` and `/admin` by role for page renders; every action and the export route re check the claims themselves because the proxy never runs for a server action post (AGENTS.md). Writes an expert action must make outside their grants (the session id on the order) go through the lazy `Actor.service()` minted after authorization, the spec 0011 shape.

### Configuration required

No new environment variable. The import script reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) from the shell or `.env.local`, swapped to the target environment the way `docs/auth.md` describes for `pnpm user:invite`. `pg_trgm` is enabled in the `extensions` schema by the migration. One dev dependency for reading the workbook: `exceljs` (streaming reader, maintained, no native build); the runner up is `xlsx` (SheetJS), whose npm release has been stale since 2022.

### Critical test scenarios

- Happy path: an active expert imports twenty invented rows locally, searches a company, sees masked values, buys `directory_50` by card (the signed webhook fixture of spec 0011), sees a balance of 50, reveals one row, sees 49 and the raw values, reloads and still sees them, finds the row on the unlocks page and in the CSV; verifies **AC-2**, **AC-4**, **AC-5**, **AC-8**, **AC-9**, **AC-11**, **AC-12**, **AC-13**.
- Failure case: a balance of one and two reveals of different contacts leave one unlock and a balance of zero, the second answering `insufficient_credits`; `settle_order` called twice on one credit order writes one ledger row; a reveal of a removed contact answers `not_found`; verifies **AC-8**, **AC-11**, **AC-15**.
- Auth and permission: a client and an `invited` expert calling any directory function get `SM403`; an expert selecting `directory_contacts`, `directory_companies` or `directory_suppressions` gets zero rows and cannot insert into any of the six tables; an expert cannot insert an order with an `organization_id` or an assessment `package_key`; a client cannot insert an order with `buyer_expert_id`; the export route answers 404 to a client; verifies **AC-1**, **AC-7**, **AC-13**.
- Import policy: the script exits 1 against a non local URL while `awaiting_lawyer`, skips an excluded country and a suppressed hash, reports an unmapped country name, and never prints an address; verifies **AC-2**, **AC-3**, **AC-17**.
- Events and legal: the three events parse with ids only and no organization; the record of processing test passes with the six rows; the terms dialog appears once after the version bump and `accept_terms('2')` clears it; verifies **AC-14**, **AC-16**.

## Build plan

Tracer Bullet: milestone 1 stands the data up and proves the boundary, milestone 2 shows it, milestone 3 puts money through it end to end, then the instruments and the legal surface thicken it. The migration is sliced in two (the directory tables in milestone 1, the order rail widening in milestone 3) so a reviewer reads the money change on its own.

**Milestone 1, data (AC-1, AC-2, AC-3)**

1. Enable `pg_trgm`; write `50_directory_companies.sql` to `55_directory_imports.sql` with the tables, indexes, RLS, the ops policies, the revokes, the audit triggers on the two kind E tables, and `private.mask_email` and `private.mask_phone`; `pnpm db:diff directory`, read the migration for the four hand fixes AGENTS.md lists, `db:reset`, `db:types`; satisfies **AC-1**.
2. `directory_search` and `directory_countries` (definer, role and status check, masking, keyset, the depth cap) in `56_directory_functions.sql`; satisfies **AC-4**.
3. pgTAP: `directory_contacts.test.sql` (zero rows and no writes for an expert and a client, ops read), `directory_search.test.sql` (mask rules on invented rows, the role refusals, the depth cap); the six rows in `docs/legal/record-of-processing.md`; satisfies **AC-1**.
4. `src/features/directory/{normalise,countries,import-policy,catalogue}.ts` with their Vitest tests, then `scripts/directory-import.mts` behind `pnpm directory:import` with `exceljs`, the header check, the policy and suppression checks, the batched upserts, the counts, the `directory_imports` row and the hosted refusal; a Vitest test drives it against a small invented workbook written in the test's temp dir; satisfies **AC-2**, **AC-3**.

**Milestone 2, browse (AC-4, AC-5)**

5. `src/features/directory/{schema,queries}.ts`: the search params schema (query, country, title, cursor, page), `searchDirectory` and `listDirectoryCountries` on the user client; satisfies **AC-4**.
6. `/expert/directory` page, `ui/search-form.tsx`, `ui/results-table.tsx` (masked rows, the unlock button as a client component that is inert until milestone 3 wires it), the balance header with the "Buy credits" link, the sidebar entry, the `directory` namespace in both catalogs, the design gallery section for the masked value cell if it is a new primitive, axe in `e2e/directory.spec.ts`; satisfies **AC-5**.

**Milestone 3, unlock (AC-6 to AC-12)**

7. The rail migration: `packages.kind` and `credits` with the `directory_50` seed row, the three nullable columns and `buyer_expert_id` on `orders` and `invoices`, `orders.credits`, `orders_check_buyer`, the expert policies on the three tables, `settle_order` copying `buyer_expert_id` and granting the credits, `directory_reveal`, `directory_credit_balance`, `directory_unlocked_contacts`; pgTAP `directory_reveal.test.sql`, `directory_unlocks.test.sql`, `directory_credit_entries.test.sql`, the new cases in `orders.test.sql` and a settle twice case; `db:types`; satisfies **AC-6**, **AC-7**, **AC-8**, **AC-11**.
8. `CREDIT_PACKS` equality test and the `assessment` filter on `tests/features/checkout/packages.test.ts`; satisfies **AC-6**.
9. `startCreditCheckout` and `requestCreditInvoice` with `requireActiveExpert`, sharing the spec 0011 helpers (extract the session creation and the order insert into a server only module both features import if the checkout action does not already expose them); `/expert/directory/credits` with the pack card, the billing form and the return state; satisfies **AC-9**.
10. The null organization branches in `confirm-order`, `render-invoice`, `issue-invoice`, `sweep-orders`, the ops order actions and `/admin/orders`, with the expert buyer name, the `Credits` badge and the event switch; satisfies **AC-10**.
11. `revealContact`, the live unlock button (click handler success, inline insufficient credits sentence), `/expert/directory/unlocks` and the export route with the CSV rules; Playwright: buy by card through the webhook fixture, reveal, reload, export; satisfies **AC-11**, **AC-12**, **AC-13**.

**Milestone 4, instruments (AC-14, AC-15)**

12. The three events in `events.ts` and `catalogue.ts`, the catalogue test groups, the three capture calls, the `docs/analytics.md` rows; satisfies **AC-14**.
13. `directory_ops_summary`, `directory_remove_contact` (with the hash equality pgTAP case), `removeDirectoryContact`, `/admin/directory` with the import card, the totals, the expert table and the removal form, the admin sidebar entry, axe; satisfies **AC-15**.

**Milestone 5, legal (AC-16, AC-17)**

14. `DIRECTORY_PROCESSING`, the privacy page block, `RETENTION` rows, the record of processing rows reviewed, the terms clause with `CURRENT_TERMS_VERSION '2'`, its changelog key, `TERMS_VERSIONS` and `TERMS_UPDATED`, the Playwright terms dialog case; satisfies **AC-16**.
15. `docs/directory.md` (the runbook: how an import runs, how a removal runs, the per environment checklist) and, when the lawyer answers, the commit that flips `IMPORT_POLICY` to `cleared` with the `licenceNote` and the exclusion list; the staging import, purchase, reveal, alert, invoices and CSV ticked in the checklist; satisfies **AC-17**.

## Consequences

**Positive**:
- One money path. A credit pack is an order, so revenue, invoice numbering, VAT, the QR bill, the sweep, the ops mark paid and the Slack alert all work on day one without a second implementation to keep honest.
- The data boundary is a database fact, not an app promise: no role can read a raw value, and pgTAP proves it on every CI run.
- A retry anywhere is safe: the grant is keyed on the order, the debit on the unlock, both under a lock, and the import upserts on stable keys.
- A person's objection is one ops action and outlives every future import.

**Negative / tradeoffs**:
- `orders.organization_id`, `orders.company_id` and `invoices.organization_id` become nullable, so the generated types widen and every existing consumer of those columns (six tasks and actions, the ops list) grows a branch or a boundary assertion. This is the price of one rail; a separate credit orders table would have avoided it at the cost of a second money path.
- Bumping the terms version puts a dialog in front of every signed in user once, clients included, for a clause most of them will never use. Spec 0015 designed the version bump for exactly this and the alternative (a separate expert only terms acceptance) is a second consent machine.
- A masked email keeps the domain, so a determined buyer can guess `first.last@domain` from the name and the domain without paying. The prototype chose this trade, because a masked domain shows nothing worth buying; the spec keeps it and notes it as an accepted risk.
- Purchased lists go stale. Nothing here re verifies a contact; the next import is the refresh, and a bounce is an ops removal.
- No rate limit on search beyond the page depth cap; a scraper with an expert account can walk the masked directory. The account is invited by ops and the `directory.searched` event makes volume visible; a daily cap is deferred until it is needed.

**Neutral**:
- Two migrations, one per slice, both additive and backward compatible (a nullable column and a widened check).
- `exceljs` joins the dev dependencies for the script only; nothing in `src/` imports it.
- A new runbook, `docs/directory.md`, in the shape of `docs/experts.md`.
- The directory tables have no audit trigger; `directory_imports` and the script's exit code are the record of every bulk write.

## Follow-up

- [ ] Owner question, before milestone 3: is CHF 1.99 the net price of a credit (VAT on top, the pack invoiced at CHF 99.50 plus 8.1%) or the gross price? The spec assumes net, like every other price on the site; the button then reads "1 credit, CHF 1.99" with the "excl. VAT" note the pricing page already uses.
- [ ] Owner question, before milestone 3: one pack of 50 to start, or a ladder (for example 20, 50, 200 with a discount)? The spec ships one pack; a second is a `packages` row, a `CREDIT_PACKS` entry and a card.
- [ ] Owner question, before the first hosted import: load the rows with no country at all (about 12,000, 15 percent of the list) once the lawyer clears the named countries, or leave them out because they cannot be assigned to a cleared jurisdiction? The spec ships `loadRowsWithoutCountry: false`.
- [ ] Owner question, for the lawyer: how long may a purchased contact be kept without re verification, and does the licence allow SME24 to keep an export a buyer took after the licence ends? The record of processing marks the six tables `indefinite` until answered.
- [ ] Owner question: are all expert buyers established in Switzerland? The rail charges 8.1 percent MWST on every order; a buyer abroad is the deferred "EU VAT and multi currency" item and would need reverse charge handling before their first pack.
- [ ] Owner question: should ops be able to grant or refund credits from `/admin/directory` in this slice? The ledger reasons `grant` and `refund` exist so the answer is an action and a form, not a migration; the spec ships neither.
- [ ] Launch gate (AC-17): the lawyer's licence and country answer folded into `IMPORT_POLICY` with a dated `licenceNote`, then the staging import, purchase, reveal, alert, invoices and CSV, all in `docs/directory.md`'s checklist. Feature 26 owns go live and lists this gate.
- [ ] Deferred: a daily search cap per expert once `directory.searched` shows a volume that looks like scraping.
- [ ] Deferred: an inbound objection form on the public site for people on the list (today: an email to the privacy address, handled on `/admin/directory`).
- [ ] Deferred: a bounce feed from the buyer's mailer into `directory_suppressions` with reason `bounce`; today ops remove by hand.
- [ ] Deferred: self serve consultant signup (the owner's decision 1 keeps buyers to invited experts in this slice; public expert sign up is already on the Deferred list).
- [ ] `/sync`: the AGENTS.md rule for the directory (the read boundary, the one debit function, the rail's second buyer shape, the import policy gate) and the `pnpm directory:import` command line.
