# Contact directory

_How the purchased contact list reaches the database, how an expert buys and reveals a contact, how a person leaves, and what each environment needs before the feature goes live. Spec: [0018 Contact directory sold to the expert network](specs/0018-contact-directory/index.md). The credit pack rides the order rail of [spec 0011](specs/0011-package-checkout-swiss-vat/index.md); the confirmation email rides the rail in [email.md](email.md); the legal surface is in [legal.md](legal.md)._

## The boundary, in one paragraph

The six `directory_*` tables carry no select policy for an expert or a client. Every read an expert makes goes through a `security definer` function that checks their role and their `expert_profiles.status`, masks every email and phone (`private.mask_email`, `private.mask_phone`) and returns the raw columns only for a row they paid for: `directory_search` for the browse, `directory_unlocked_contacts` for the unlocks page and the CSV. `directory_reveal` is the only debit path and the only writer of `directory_unlocks`: it takes an advisory lock on the caller, refuses a balance below one (`SM402`), inserts the unlock and the `-1` ledger row in one transaction and returns the full row. The balance is `sum(delta)` over `directory_credit_entries`, never stored. `supabase/tests/directory_*.test.sql` prove all of it on every CI run.

## How the list loads

1. The workbook stays outside the repository (`docs/raw/` is gitignored; the list holds personal data and the repo is public). It never enters a migration, a seed, a fixture, a screenshot or a pull request.
2. `pnpm directory:import <path-to-xlsx> --dry-run` reads the `Contacts` sheet by header name (the twelve columns in `IMPORT_COLUMNS`, `src/features/directory/catalogue.ts`) and prints the counts per outcome and per country, plus the country spellings it could not map. Grow `COUNTRY_NAMES` in `countries.ts` from that list; a spelling that is not there is skipped, never guessed. A cell holding digits is counted but not printed.
3. `pnpm directory:import <path-to-xlsx>` upserts a company by `(name_normalised, country)` and a contact by lowercased email, in batches of 500, and writes one `directory_imports` row with the counts. A row is skipped when its email is not an address, its country is in `IMPORT_POLICY.excludedCountries`, its country is unmapped, its country is missing while `loadRowsWithoutCountry` is `false`, or its email hash sits in `directory_suppressions`.
4. **The policy gate.** `IMPORT_POLICY` in `src/features/directory/import-policy.ts` ships as `awaiting_lawyer`. While it is not `cleared`, the script refuses any Supabase URL whose host is not `127.0.0.1` or `localhost`. Flipping it to `cleared` happens only in a commit that also carries the lawyer's dated `licenceNote` and the exclusion list they named; `tests/features/directory/import-policy.test.ts` refuses a `cleared` policy with an empty note.
5. The gate protects loading, not serving: once staging holds rows, every active expert on staging and on every preview that shares it can search and reveal them. So the staging import is the **last** step of the checklist below, after the lawyer's commit, never a first smoke test.

## How a credit travels

1. `/expert/directory/credits` sells `directory_50` (50 credits, CHF 99.50 net, the default MWST rate; `CREDIT_PACKS` in `catalogue.ts` and the seed migration `20260912032600_directory_credit_pack_seed.sql` are kept equal by a Vitest test). The billing country is fixed to Switzerland (owner decision, 2026-09-12).
2. `startCreditCheckout` inserts the pending order under the expert's own insert policy, which ties `credits` to the package's (`orders: experts create a pending credit order`), then opens the Stripe session and stores its id through the lazy service client scoped to `buyer_expert_id`; the payable URL is withheld until that write lands (the spec 0011 rule, shared in `src/features/checkout/stripe-session.ts`). `requestCreditInvoice` inserts the same row for a bank transfer and queues `issue-invoice`.
3. `settle_order` grants the credits in the same transaction as `paid`: one `directory_credit_entries` row with `reason 'purchase'`, `delta` the order's frozen `credits`, guarded by the partial unique index on `(order_id)`, so a webhook redelivery, a settle retry or an ops mark paid racing the webhook grants exactly once. `confirm-order` then sends `order_confirmed` with the extra `credits` sentence and captures `directory.credits_purchased` (never `payment.completed`, which needs an organization).
4. An expert order never enters a delivery state: `private.check_order_transition` refuses the edge, `classifyScheduleError` maps it to `not_deliverable`, and `/admin/orders` marks the row `Credits` and offers no schedule action. The invoice PDF lives at `experts/<buyer_expert_id>/<invoice id>.pdf` in the `invoices` bucket, readable by the buyer through the existing download route.

## How a person leaves

`/admin/directory` holds the "Remove a person" form. `removeDirectoryContact` calls `directory_remove_contact(email, reason)`, which inserts the SHA 256 hash of the lowercased address into `directory_suppressions` and deletes the contact row in one transaction; the buyers' unlocks cascade away and their ledger debits keep `unlock_id` null. A not found address is still suppressed, so an objection lands before the next import. There is no refund and no notice to the buyer in this slice (owner decision, 2026-09-12); the function answers how many unlocks it cascaded so ops can make a goodwill call by hand. The privacy page promises removal within 30 days (`DIRECTORY_PROCESSING.removalDays`).

## The events

`directory.searched` (browser, consent gated, the shape of the search and the row count, never the text), `directory.unlocked` (server, after the reveal RPC) and `directory.credits_purchased` (server, deduped on the order). None carries an organization; see [analytics.md](analytics.md).

## Local development

- `supabase start` applies the migrations; the directory tables are empty until you import. `pnpm directory:import docs/raw/<file>.xlsx --dry-run` reports, without the flag it loads (about a minute for 80,000 rows).
- The seeded `expert@example.com` is `active`; grant credits by hand with a `directory_credit_entries` row (`reason 'grant'`) or buy a pack by invoice and mark it paid from `/admin/orders`.
- Tests: `supabase/tests/directory_*.test.sql` and the expert buyer cases in `orders.test.sql` (pgTAP), `tests/features/directory/` and `tests/scripts/directory-import.test.ts` (Vitest, invented rows only), and `e2e/directory.spec.ts` (Playwright with axe over the browse, the reveal, the unlocks page, the CSV, the invoice purchase and the ops removal).

## Per environment checklist (staging, then production)

Do these once per hosted environment, in this order. Nothing in the feature goes to production before every box is ticked (spec 0018, AC-17).

- [ ] **The lawyer's answer is in.** The commit that flips `IMPORT_POLICY.status` to `cleared` carries the dated `licenceNote` and the exclusion list the lawyer named. Record the commit here: `<sha>`.
- [ ] **The pack is on sale.** `directory_50` exists in `packages` after the migrations run; `/expert/directory/credits` shows CHF 99.50 net and CHF 107.56 total.
- [ ] **One real pack purchase by card** on a test expert account: the order lands `paid`, `directory_credit_entries` holds one `purchase` row of 50, the balance in the header reads 50, and `order_confirmed` arrives with the credits sentence.
- [ ] **One real pack purchase by invoice**: the invoice PDF renders at `experts/<id>/…`, downloads from the credits page, and marking it paid from `/admin/orders` grants the credits once.
- [ ] **The Slack alert lands.** Both purchases post `payment.received` naming `Expert: <name>`.
- [ ] **The staging import**, last: `pnpm directory:import` with the staging keys in `.env.local`, first `--dry-run`, then for real; `/admin/directory` shows the run with its counts.
- [ ] **One real reveal**: the test expert searches, reveals one row, reloads and still sees it, finds it on the unlocks page and in the CSV; the balance reads 49.
- [ ] **One real removal** of that revealed contact from `/admin/directory`: the row is gone from the search, the unlocks page and the next CSV; a second import does not bring it back.
- [ ] **The terms dialog** appears once for an existing user after the deploy (version 2) and accepting it clears it.
