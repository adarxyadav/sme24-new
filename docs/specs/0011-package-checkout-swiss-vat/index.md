# 0011. Package checkout with Swiss VAT

**Date**: 2026-09-07
**Status**: Accepted

## Summary

A client picks one of the three fixed price assessment packages and buys it, either by card through Stripe's hosted payment page or by asking for an invoice they pay from their bank. Either way SME24 charges 8.1% MWST (Swiss VAT) on top of the listed CHF price, issues a numbered invoice as a stored PDF carrying a Swiss QR-bill, and shows the paid order in the client's dashboard. The database is the single source of truth for every amount: money is stored as whole Rappen (centimes) as integers so no rounding drift can occur, and prices plus the billing address are copied onto the order at purchase so a later price change never rewrites a past invoice. Payment confirmation reaches the database only through the Stripe webhook, never through the browser, so closing the tab cannot lose an order.

## Requirements

**User stories**:

- As a client, I want to buy an assessment package with my card and immediately see the paid order in my dashboard, so that I know the purchase went through even if I close the browser during payment.
- As a client at a Swiss SME, I want an invoice with a QR-bill I can pay from e-banking, so that I can buy without putting a company purchase on a personal card.
- As a client, I want a proper Swiss invoice showing the net price, the 8.1% MWST and the gross total with your UID number, so that my bookkeeper can reclaim the VAT.
- As ops, I want to see a bank transfer land and mark the order paid, so that the client gets their confirmation and the assessment can be scheduled.
- As ops, I want a Slack message the moment a payment arrives, so that scheduling starts without watching a dashboard.
- As the engineer, I want a duplicated webhook, a double clicked buy button and an abandoned checkout to leave the database in exactly one correct state, so that money never needs manual repair.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: A signed in client with a company can buy each of the three fixed price packages (`culture` CHF 2'000, `sms` CHF 5'000, `compliance` CHF 10'000) by card. Stripe Checkout opens in the client's language, shows the gross amount in CHF, and on success the dashboard lists the order as paid.
- **AC-2**: Every order stores its money as integer Rappen in four columns (`net_rappen`, `vat_rate`, `vat_rappen`, `gross_rappen`), where `vat_rappen` is `net_rappen * vat_rate` rounded to the nearest whole Rappen and `gross_rappen = net_rappen + vat_rappen` exactly. No floating point number is ever stored or transported for an amount.
- **AC-3**: A paid order produces exactly one `invoices` row carrying an invoice number from a Postgres sequence with no gaps, the issue date, the due date, and frozen copies of the seller's name, address and UID. An issued invoice is never updated afterwards except to record the rendered PDF path.
- **AC-4**: The invoice PDF renders in a Trigger.dev task and is stored in a private Supabase Storage bucket. It shows the seller with its `CHE-...MWST` UID, the buyer's frozen billing address, the invoice number and date, the package as a line item, the net amount, the VAT rate and VAT amount, the gross total in CHF, and a Swiss QR-bill with a SCOR creditor reference. The client downloads it from the dashboard through a signed URL that expires.
- **AC-5**: Payment confirmation reaches the database only through `/api/webhooks/stripe`. The route verifies the Stripe signature, inserts the event id into `stripe_events` (a unique key, so a redelivery is a no operation), enqueues the confirmation task and returns 200 in well under Stripe's timeout. The browser return page reads the order and never writes it.
- **AC-6**: A client who abandons Stripe Checkout, or whose card is declined, leaves a `pending` order and nothing else: no invoice row, no invoice number consumed, no email sent. `checkout.session.expired` (or the sweep) moves it to `expired`, and expired orders are hidden from the client dashboard.
- **AC-7**: The same Stripe event delivered twice, or two `checkout.session.completed` events racing, results in exactly one paid order, one invoice, one invoice number, one confirmation email and one Slack alert. The guards are database constraints (`stripe_events.event_id` primary key, `orders.stripe_checkout_session_id` unique, `invoices.order_id` unique) plus Trigger.dev idempotency keys, not application read then write checks.
- **AC-8**: A client may instead request an invoice for bank transfer. The order is created as `pending` with `payment_method 'bank_transfer'`, an invoice is issued immediately with its number, due date 30 days out and the QR-bill PDF, and the dashboard shows "awaiting payment" with the invoice downloadable.
- **AC-9**: Ops marks a bank transfer order paid in the admin. That calls the same shared `settleOrder` core as a card payment, differing only in its two inputs (the paid moment and the actor): the order becomes `paid`, the confirmation email goes out and the `payment.received` Slack alert fires. Ops can also cancel a stale pending order, which keeps the invoice on record as cancelled and never deletes it.
- **AC-10**: Marking an order paid is atomic and committed before any follow up work. A failing PDF render or a bouncing email never leaves the order unpaid; each retries on its own and raises an ops alert after exhausting retries.
- **AC-18**: `confirm-order` is resumable, not merely idempotent. A retry after the task committed the paid transaction but died before enqueueing its follow up work reads the order's current state, skips what is already done and enqueues only what is missing. A crash at any point in the task leaves the client with a paid order, an invoice, a confirmation email and an ops alert once retries settle.
- **AC-19**: A package with no price (`retainer`) cannot enter checkout. `startCheckout` and `requestInvoice` reject it with the typed `package_not_purchasable` error before any insert, so a null price never reaches the `net_rappen > 0` constraint as an opaque database error.
- **AC-11**: A billing address is collected and validated before checkout starts (company name, street, postcode, town, country, optional UID), prefilled from the company record where available, and frozen onto the order. A signed in client with no company is routed to company setup before they can buy.
- **AC-12**: Orders and invoices are readable only by members of the owning organization and by ops. An assigned expert reads neither table, deviating from the tenant table contract, and the schema files state why. A pgTAP file proves each denial.
- **AC-13**: Every order state change writes an `order_events` row (from status, to status, actor, actor role, reason) and the standard `audit_log` row. No app role can update or delete an `order_events` row.
- **AC-14**: A Vitest test asserts the `packages` table equals `PACKAGES` in `src/features/marketing/packages.ts` on key, price and sort order, so the pricing page and the checkout can never disagree.
- **AC-15**: Every amount shown in the UI and on the invoice is formatted through the existing next-intl `chf` format from integer Rappen, with the 0.05 Rappen display rounding of spec 0004 applied at the display boundary only, never to a stored or charged amount.
- **AC-16**: The three pricing page buttons of spec 0009 lead to checkout: a signed out visitor is sent through sign up and lands back on the checkout for the package they picked.
- **AC-17**: Seller facts (name, address, UID, IBAN) come from configuration with a placeholder guard, mirroring `SITE_PLACEHOLDERS`: a test fails if a placeholder value would reach production.

## Decision

**Chosen option**: Option 2: Stripe Checkout for cards with an invoice first bank transfer path, both settled by a webhook only confirmation, with orders, invoices and their numbering owned by our database.

SME24 owns the order, the invoice and the arithmetic; Stripe is the card acquirer and nothing more. Amounts are computed in our code as integer Rappen and passed to Stripe already calculated, so `automatic_tax` is not used and the bank transfer path shares the exact same computation.

**Implementation skills**: `stripe-best-practices` (`stripe/ai`, `.claude/skills/stripe-best-practices/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `react-email` (`resend/resend-skills`, `.claude/skills/react-email/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

## Rationale

Reasoning, the options weighed and the references: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

Five tables. Every amount is `bigint` holding whole Rappen (1 CHF = 100 Rappen), so CHF 2'000.00 is `200000`. No `numeric` and no float ever carries an amount, which removes the whole class of currency rounding bugs at the type level.

**`packages`** (kind G, global reference data; no `organization_id`, every signed in user reads, ops writes)

| Column | Type | Notes |
|---|---|---|
| `key` | `text primary key` | Matches `PACKAGE_KEYS`: `compliance`, `sms`, `culture`, `retainer` |
| `price_rappen` | `bigint null` | Net price excluding VAT; null for `retainer` (sold by conversation) |
| `vat_rate` | `numeric(5,4) not null default 0.081` | The rate applied at purchase time |
| `sort_order` | `integer not null` | Display order, mirrors `packages.ts` |
| `is_active` | `boolean not null default true` | An inactive package cannot start a new checkout |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Names, promises and included points stay in the message catalogs under `marketing.packages.<key>.*`; only the price, order and activity live here. Seeded by a data migration (production needs the rows), never by `seed.sql`.

**`orders`** (kind T tenant, the tenant table contract with one deviation: no expert read policy)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organizations(id) on delete cascade` | |
| `company_id` | `uuid not null references companies(id) on delete restrict` | Which company the assessment is for; `restrict` so a company with orders cannot vanish |
| `package_key` | `text not null references packages(key)` | |
| `reference` | `text not null unique` | Human reference, `SME24-2026-0042`, allocated at creation |
| `status` | `text not null default 'pending' check (status in ('pending','paid','cancelled','refunded','expired'))` | Payment states only; delivery states are feature 12 |
| `payment_method` | `text not null check (payment_method in ('card','bank_transfer'))` | |
| `net_rappen` | `bigint not null check (net_rappen > 0)` | Frozen copy of the package price |
| `vat_rate` | `numeric(5,4) not null` | Frozen copy of the rate |
| `vat_rappen` | `bigint not null check (vat_rappen >= 0)` | |
| `gross_rappen` | `bigint not null check (gross_rappen = net_rappen + vat_rappen)` | The invariant lives in the database |
| `currency` | `text not null default 'CHF' check (currency = 'CHF')` | Widened by a later migration if ever needed |
| `package_name_snapshot` | `text not null` | The package name in the buyer's language at purchase, for the invoice line |
| `billing_name` | `text not null` | |
| `billing_street` | `text not null` | |
| `billing_postcode` | `text not null` | |
| `billing_town` | `text not null` | |
| `billing_country` | `text not null default 'CH' check (billing_country ~ '^[A-Z]{2}$')` | |
| `billing_uid` | `text null` | The buyer's `CHE-...` number when they have one |
| `locale` | `text not null check (locale in ('de','en'))` | Drives the Stripe locale, the PDF and the email language |
| `stripe_checkout_session_id` | `text null unique` | Null for bank transfer; unique so one session yields one order |
| `stripe_payment_intent_id` | `text null` | Recorded for reconciliation and refunds |
| `due_date` | `date null` | Set on the bank transfer path |
| `paid_at`, `cancelled_at`, `expires_at` | `timestamptz null` | |
| `created_by` | `uuid null references profiles(id) on delete set null` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Indexes: `(organization_id, created_at desc)`, `(company_id, created_at desc)`, partial `(status) where status = 'pending'`, and the two unique constraints above.

**`order_events`** (kind T, append only)

`id uuid pk`, `organization_id` (cascade), `order_id uuid not null references orders(id) on delete cascade`, `from_status text null`, `to_status text not null`, `actor_id uuid null` (no foreign key, the trail outlives the user), `actor_role text not null check (actor_role in ('client','ops','service','system'))`, `reason text null`, `occurred_at timestamptz not null default now()`. Index `(order_id, occurred_at desc)`. Update and delete revoked for every app role, guarded the same way `audit_log` is.

**`invoices`** (kind T)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | |
| `organization_id` | `uuid not null` (cascade) | |
| `order_id` | `uuid not null references orders(id) on delete restrict unique` | One invoice per order; `restrict` because an issued invoice must outlive any cleanup |
| `number` | `text not null unique` | `2026-0001`, formatted from the sequence |
| `issued_at` | `timestamptz not null default now()` | |
| `due_date` | `date not null` | |
| `seller_name`, `seller_address`, `seller_uid`, `seller_iban` | `text not null` | Frozen at issue, so changing the config never rewrites history |
| `qr_reference` | `text not null unique` | SCOR (ISO 11649) creditor reference derived from the order reference |
| `pdf_path` | `text null` | Supabase Storage object path; null until the render task succeeds |
| `pdf_rendered_at` | `timestamptz null` | |
| `pdf_failed_at` | `timestamptz null` | Set when the render exhausts its retries. `pdf_path` and `pdf_failed_at` both null means still rendering; `pdf_failed_at` set means ops must retry. Cleared on a successful retry |
| `cancelled_at` | `timestamptz null` | Set when ops cancels; the row is never deleted |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

A sequence `public.invoice_number_seq` supplies the number. It is drawn once, inside the transaction that issues the invoice, and never in a transaction that might roll back for an unrelated reason.

**`stripe_events`** (kind I internal, ops read only)

`event_id text primary key` (Stripe's own id), `type text not null`, `payload jsonb not null`, `received_at timestamptz not null default now()`, `processed_at timestamptz null`, `error text null`. No `organization_id`; the order id is inside the payload.

**Relationships**: `organizations 1:N orders`, `companies 1:N orders`, `packages 1:N orders`, `orders 1:1 invoices`, `orders 1:N order_events`.

### State transitions

```
                      ┌──────────── ops cancels ─────────────┐
                      │                                       ▼
(create) ──> pending ──┼── webhook: session.completed ──> paid ──> refunded
                      │                                       (ops, feature 12+)
                      ├── webhook: session.expired ────> expired
                      │
                      └── ops marks paid (bank transfer) ──> paid
```

- `pending` is the only state a client action creates.
- Only the webhook task and an ops action write `paid`. The browser never does.
- **Both arrows into `paid` run one shared function**, `settleOrder(orderId, paidAt, actor)` in `src/features/checkout/settle.ts`. It is the only code that writes `paid`, issues the invoice and enqueues the follow up work. The two callers differ solely in their inputs: the webhook task passes the Stripe event's timestamp and `actor_role 'service'`; the ops action passes `now()` and the acting user with `actor_role 'ops'`. There is no second confirmation path, and no branch inside `settleOrder` on payment method.
- `expired` comes from `checkout.session.expired` or the sweep task; card path only. The sweep distinguishes two cases by the session id, which is why the insert ordering above is fixed: a `pending` card order with a **null** `stripe_checkout_session_id` older than 1 hour never reached Stripe (the action crashed between insert and session creation) and is expired outright; one **with** a session id is expired only when Stripe says so, because Stripe's own session lifetime governs it. A bank transfer order is never swept, only cancelled by ops.
- `cancelled` is an ops action on a pending bank transfer order; the invoice row stays with `cancelled_at` set.
- `refunded` is reachable from `paid` by ops only; the refund mechanics belong to feature 12, this spec only reserves the state and its `order_events` row.
- Every transition writes one `order_events` row. A transition not in this diagram is rejected by a trigger, the same pattern `research_runs` already uses.

### API surface

| Endpoint / action | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `startCheckout` (server action) | action | `packageKey` (req), `companyId` (req), billing address fields (req) | `{ ok: true, data: { checkoutUrl } }` or `{ ok: false, error }` | client member of the org | `package_inactive`, `package_not_purchasable`, `company_not_found`, `invalid_billing_address`, `stripe_unavailable` |
| `requestInvoice` (server action) | action | `packageKey` (req), `companyId` (req), billing address fields (req) | `{ ok: true, data: { orderId, reference } }` | client member of the org | same as above, minus `stripe_unavailable` |
| `/api/webhooks/stripe` | POST | raw body, `stripe-signature` header | 200 always once the signature verifies | Stripe signature only, no session | 400 on a bad signature; never 5xx for a duplicate |
| `/[locale]/app/orders` | GET (RSC) | none | The org's orders, newest first, paginated | client member | none, an empty list renders the empty state |
| `/[locale]/app/orders/[id]` | GET (RSC) | `id`, `session_id` (opt, from the Stripe return) | Order detail plus the invoice download link | client member of the owning org | 404 for another org's order (never 403, which would confirm it exists) |
| `/[locale]/app/orders/[id]/invoice` | GET (route) | `id` | 302 to a short lived Storage signed URL | client member of the owning org | 404 when no invoice, 404 for another org |
| `markOrderPaid` (server action) | action | `orderId` (req), `reason` (opt) | typed result | ops only | `not_pending`, `not_found` |
| `cancelOrder` (server action) | action | `orderId` (req), `reason` (req) | typed result | ops only | `not_pending`, `not_found` |
| `retryInvoiceRender` (server action) | action | `invoiceId` (req) | typed result | ops only | `not_found`, `already_rendered` |

**The Stripe return page is `/[locale]/app/orders/[id]`**, not a separate route: `startCheckout` sets Stripe's `success_url` to that order's own detail page. So the return is a normal read of a row the client already owns, and the `session_id` Stripe appends is ignored entirely, which means a tampered or missing one changes nothing. The order id in the path is the only identifier that matters, and RLS already protects it.

**The webhook may not have landed when the client returns.** A `pending` card order whose `stripe_checkout_session_id` is set renders a "confirming your payment" state rather than "awaiting payment", and polls the row for up to 60 seconds before falling back to "this is taking longer than usual, we will email you". No client side write, no assumption that payment failed.

Server actions return the typed result shape and never throw for an expected failure; the read paths (`queries.ts`) throw; the tasks throw so Trigger.dev retries. This follows the project's single error handling rule.

The order list paginates from the first version (page size 20, keyset on `created_at desc, id`), even though an early organization has few orders.

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| `startCheckout` | `net_rappen` | `packages.price_rappen` read at action time, frozen onto the order |
| `startCheckout` | `vat_rate` | `packages.vat_rate` read at action time, frozen onto the order |
| `startCheckout` | `vat_rappen` | Derived: `round(net_rappen * vat_rate)` to the nearest whole Rappen, by the pure `computeAmounts` in `src/features/checkout/money.ts` |
| `startCheckout` | `gross_rappen` | Derived: `net_rappen + vat_rappen`, asserted by a database check constraint |
| `startCheckout` | `reference` | Derived: `SME24-<year>-<counter>` from `public.order_reference_seq`; the year is the server clock in `Europe/Zurich` |
| `startCheckout` | Rejection of a null price package | `packages.price_rappen is null` checked before any insert, returning the typed `package_not_purchasable`. `is_active` is a separate, independent gate |
| `startCheckout` | Order row versus Stripe session ordering | Fixed: insert the `pending` order first (committing the reference and the frozen amounts), then create the Stripe session, then update the row with its id. A Stripe failure therefore leaves a `pending` card order with a null `stripe_checkout_session_id`, which is exactly what the sweep keys on |
| `startCheckout` | `package_name_snapshot` | The `marketing.packages.<key>.name` message resolved in the order's `locale` at creation |
| `startCheckout` | `locale` | The next-intl active locale of the request, which is the URL segment, not the browser header |
| `startCheckout` | Stripe `locale` parameter | Derived from `orders.locale` (`de` or `en`), per the spec 0004 follow up |
| `startCheckout` | Stripe line item amount | `gross_rappen` passed as `unit_amount` with `currency: 'chf'`; Stripe's minor unit for CHF is the Rappen, so the integer passes across unchanged |
| `startCheckout` | Prefilled billing address | `companies` row (`name`, `uid`) where present; street, postcode and town have no column today, so they are always typed by the client |
| `startCheckout` | `billing_uid` validation | The pure `isValidSwissUid` helper: shape `CHE-###.###.###` optionally suffixed ` MWST`, plus the official mod 11 check digit over the nine digits with weights `5,4,3,2,7,6,5,4`. An empty value is allowed (the field is optional); a present but malformed one returns `invalid_billing_address`. The same helper is offered to `companies.uid` as a follow up, since that column has no format check today |
| `startCheckout` | Divergence between `billing_uid` and `companies.uid` | Deliberate: the order's copy is frozen billing data and the company's is research data. An edit at checkout never writes back to `companies`, because the buyer is stating who to invoice, not correcting the research. Ops reconciles the two in feature 12 if it matters |
| `startCheckout` / `requestInvoice` | `company_id` | Chosen by the client when the org holds several companies; the single company is preselected. No company at all routes to company setup first |
| `requestInvoice` | `due_date` | Derived: issue date plus 30 days, the Swiss default, from `INVOICE_DUE_DAYS` |
| `settleOrder` (webhook caller) | `paidAt` | The Stripe event's own timestamp, not our clock, so a delayed delivery records when payment actually happened |
| `settleOrder` (ops caller) | `paidAt` | `now()` at the moment ops confirms; there is no Stripe event on this path, and ops is asserting the money arrived, not when |
| `settleOrder` (webhook caller) | `actor_id`, `actor_role` | `null` and `'service'` |
| `settleOrder` (ops caller) | `actor_id`, `actor_role` | The acting ops user's id and `'ops'`, so `order_events` shows who confirmed a bank transfer |
| sweep task | `actor_role` | `'service'`. **`'system'` is not used by this feature**; it stays in the check constraint for the wider `audit_log` convention of spec 0002. Every non human writer here is `'service'` |
| webhook task | `stripe_payment_intent_id` | The Checkout Session's `payment_intent` field; stays null on the bank transfer path |
| invoice issue | `number` | `nextval('public.invoice_number_seq')` formatted as `<year>-<4 digits>` |
| invoice issue | `issued_at` | `now()` at the issuing transaction |
| invoice issue | `seller_name`, `seller_address`, `seller_uid`, `seller_iban` | The `SELLER` constant in `src/features/checkout/seller.ts`, populated from environment variables, frozen onto the row at issue |
| invoice issue | `qr_reference` | Derived by the pure `scorReference` helper from the **invoice number's numeric part only**, not the order reference text. The `SME24` prefix and the hyphens are dropped, leaving digits (`2026` plus the zero padded counter), which the helper zero pads to a fixed width, appends `RF00`, converts letters to digits per ISO 11649 (`R` = 27, `F` = 15), takes `98 - (n mod 97)` and substitutes the two check digits. The result is `RF<check><digits>`. Using the invoice number rather than the order reference keeps the reference stable for the document it is printed on, and unique because invoice numbers are |
| PDF task | Every amount printed | The frozen `invoices` and `orders` columns only; the task never re reads `packages` |
| PDF task | Ordering against the confirmation email | Fixed: the email is enqueued **after** the render task reports success, not beside it. The confirmation email always carries a PDF that exists. If the render exhausts its retries, the email still goes out after the alert, without the attachment and with a line saying the invoice follows shortly |
| `retryInvoiceRender` | Whether a render permanently failed | Derived: `pdf_path is null` **and** `pdf_failed_at is not null`. A row with both null is still rendering. The column is added to `invoices` so ops can tell the two apart and retry the failed one |
| PDF task | Invoice language | `orders.locale`, so the PDF matches the email and the buyer |
| PDF task | `pdf_path` | Derived: `invoices/<organization_id>/<invoice id>.pdf` in the private Storage bucket |
| dashboard | Displayed CHF amounts | `gross_rappen` etc. divided by 100 at the display boundary only, formatted by the next-intl `chf` format, with the 0.05 Rappen display rounding of spec 0004 |
| dashboard | Invoice download link | A Supabase Storage signed URL minted per request with a short expiry, never a stored public URL |
| `payment.received` alert | `organizationName` | `organizations.name` resolved in the task |
| `payment.received` alert | `amountChf` | Derived: `gross_rappen / 100`, the alert schema's existing field takes CHF |
| `payment.received` alert | `reference` | `orders.reference` |
| confirmation email | Recipient language | `profiles.locale` of the buyer, the existing `sendEmail` behaviour, which may differ from `orders.locale` if they switched; the PDF keeps the purchase language |

### Key invariants

1. `gross_rappen = net_rappen + vat_rappen` on every order, enforced by a check constraint, not by application code.
2. `vat_rappen = round(net_rappen * vat_rate)` to the nearest whole Rappen. Enforced in the pure `computeAmounts` function and covered by a property style test over a range of prices; not a check constraint, because `numeric` rounding in the database and in TypeScript must agree, and one authority is safer than two.
3. Invoice numbers are gapless and strictly increasing. The number is drawn in the same transaction that inserts the `invoices` row, and **that transaction contains only the order status update, its `order_events` row and the invoice insert**. No external call, no enqueue and no Storage write happens inside it, so the only way it rolls back is a genuine constraint violation, which is also the only case where the number should not have been drawn. (Postgres sequences do not roll back, so a transaction that fails for an unrelated reason would burn a number and break gaplessness. Keeping the transaction this small is what makes the invariant enforceable rather than aspirational.)
4. One invoice per order, enforced by `invoices.order_id unique`.
5. One order per Stripe Checkout Session, enforced by `orders.stripe_checkout_session_id unique`.
6. A Stripe event is processed at most once, enforced by `stripe_events.event_id` being the primary key.
7. An issued invoice is immutable except for `pdf_path`, `pdf_rendered_at` and `cancelled_at`. Enforced by a column level grant plus a trigger rejecting any other change.
8. An `order_events` row is never updated or deleted by any app role.
9. `orders.status` only moves along the arrows in the state diagram, enforced by a transition trigger.
10. No amount is ever stored, transported or computed as a floating point number.
11. A `pending` **card** order has no invoice row, and no invoice number has been consumed for it. The bank transfer path is the deliberate exception: it issues the invoice at creation, so its order is `pending` with an invoice, which is simply an unpaid invoice.
12. The `packages` table and `PACKAGES` in `packages.ts` agree on key, price and sort order.
13. `settleOrder` is the only code that writes `status = 'paid'`, issues an invoice on the card path, or enqueues the confirmation work. Nothing else may set `paid_at`.
14. `settleOrder` is **resumable**: it reads the order and its invoice first, performs only the steps not already done, and is safe to call again after a crash at any point. It never relies on having been called exactly once.
15. An order may only enter checkout for a package whose `price_rappen` is not null and whose `is_active` is true, checked in the action before any insert.

### Security model

- **Compliance scope**: Swiss VAT law (MWST) for invoice content and retention, the revised FADP for the billing address as personal data, and PCI DSS which SME24 stays almost entirely outside of by using Stripe's hosted page: no card number ever reaches SME24's servers, logs or database. Invoices must be retained ten years under Swiss bookkeeping rules, which is why an invoice is never deleted, only cancelled.
- **`orders` and `invoices`**: read, insert and update for members of the owning organization by the standard `organization_id = private.jwt_org_id()` predicate; full access for ops. **The `assigned experts read` policy of the tenant table contract is deliberately omitted on both tables**, and the schema file carries a comment saying why: an expert needs to know an assessment is booked, which feature 12 will give them, not what it cost or where to invoice. This is the first deviation from the contract, so it is called out here and repeated in the schema file.
- **Client update rights are narrow**: a client may insert an order and may not update one at all. Every state change comes from the webhook task (service role) or an ops action. Column grants revoke update on `orders` for `authenticated` entirely.
- **`packages`**: read for every signed in user, write for ops only.
- **`stripe_events`**: written by the service role only, read by ops only, never by a client. The stored `payload` is Stripe's event which contains no card data but does contain the buyer's email, so it falls under the FADP retention rules and gets a purge task like `purge-email-deliveries` (a follow up, not this feature).
- **`order_events`**: read by the owning organization and ops, inserted by the service role and ops actions, never updated or deleted.
- **The webhook route** is unauthenticated by necessity and is protected by Stripe's signature verification using the raw request body. It sits under `/api/webhooks/`, outside the locale segment, and the proxy matcher already skips `/api`. It is rate limited at the Vercel Firewall layer, and an unverifiable signature returns 400 without touching the database.
- **Storage**: the invoice bucket is private with RLS on `storage.objects` scoped to the owning organization plus ops. The dashboard never links a raw object path; it mints a short lived signed URL per request.
- **Stripe keys**: a restricted API key (`rk_` prefix) with only the Checkout Session and PaymentIntent permissions this feature needs, not a full secret key, per the `stripe-best-practices` skill. The client instantiates a `StripeClient` instance; the deprecated module level API key pattern is not used.

### Configuration required

- `STRIPE_SECRET_KEY`: the restricted API key (`rk_`) for creating Checkout Sessions. Already reserved in spec 0001.
- `STRIPE_WEBHOOK_SECRET`: verifies the webhook signature. Required whenever `STRIPE_SECRET_KEY` is set; optional otherwise, so previews without Stripe still boot (the lesson of the `RESEND_WEBHOOK_SECRET` regression in feature 7).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: reserved in spec 0001. Not actually needed by hosted Checkout, so it stays unused unless a later feature embeds the Payment Element.
- `SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_UID`, `SELLER_IBAN`: the seller facts printed on every invoice. Guarded by a `SELLER_PLACEHOLDERS` list that a test keeps empty for production, mirroring `SITE_PLACEHOLDERS`.
- `INVOICE_DUE_DAYS`: defaults to 30.
- `VAT_RATE`: not an environment variable. The rate lives in `packages.vat_rate` per row so a future rate change is a data migration with a date, not a redeploy.

The Stripe account itself must exist with the CHF currency enabled and the webhook endpoint registered per environment before the first real payment. That is a runbook checklist item, listed in Follow-up.

### Critical test scenarios

- **Happy path (card)**: a client with a company buys `culture`, completes Stripe Checkout in test mode, the webhook fires, and the dashboard shows a paid order with a downloadable invoice PDF whose gross total is CHF 2'162.00. Verifies **AC-1**, **AC-2**, **AC-3**, **AC-4**.
- **Happy path (bank transfer)**: a client requests an invoice, immediately downloads a QR-bill PDF, the order reads "awaiting payment", ops marks it paid, and the client's confirmation email arrives. Verifies **AC-8**, **AC-9**.
- **Closed browser**: the client completes payment then closes the tab before the redirect. The webhook still creates the paid order and the invoice. Verifies **AC-5**.
- **Duplicate webhook**: the same `checkout.session.completed` event is posted twice. Exactly one paid order, one invoice, one invoice number, one email, one Slack alert. Verifies **AC-7**.
- **Abandoned checkout**: a client opens Checkout and leaves. `checkout.session.expired` arrives, the order becomes `expired`, no invoice exists and no invoice number was consumed. Verifies **AC-6**.
- **Bad signature**: a POST to the webhook with a wrong signature returns 400 and writes nothing. Verifies **AC-5**.
- **Failing PDF render**: the render task throws repeatedly. The order stays `paid`, `pdf_failed_at` is set, an ops alert fires, the confirmation email still arrives without the attachment, and ops can retry the render. Verifies **AC-10**.
- **Crash after the paid transaction**: `settleOrder` is killed immediately after its transaction commits but before it enqueues anything. The retry finds the order already paid and the invoice already issued, draws no second invoice number, and enqueues only the missing follow up work. Verifies **AC-18**.
- **Unbuyable package**: `startCheckout` with `retainer` returns `package_not_purchasable` and inserts nothing, rather than failing on the `net_rappen > 0` constraint. Verifies **AC-19**.
- **Stripe unreachable**: the session creation call fails. The `pending` order exists with a null session id, the client sees an error, and the sweep expires the order an hour later. Verifies **AC-6**.
- **Return before the webhook**: the client lands on the order page while it is still `pending` with a session id set. The page shows "confirming your payment", never "awaiting payment", and never writes. Verifies **AC-5**.
- **Ops settles a bank transfer**: `markOrderPaid` produces the same order state, email and alert as a card payment, with `paid_at` set to now and the ops user recorded on the `order_events` row. Verifies **AC-9**, **AC-13**.
- **UID validation**: a malformed `CHE-` number and one with a wrong check digit are both rejected; a valid one and an empty one are both accepted. Verifies **AC-11**.
- **Rounding**: `computeAmounts` over a range of prices always satisfies `gross = net + vat` and `vat = round(net * rate)`, with no float artefact. Verifies **AC-2**.
- **Auth (cross tenant)**: a client of organization B requests organization A's order id and its invoice route; both return 404, not 403. Verifies **AC-12**.
- **Auth (expert)**: an expert with an active assignment to the organization selects `orders` and `invoices` in pgTAP and gets zero rows on both. Verifies **AC-12**.
- **Auth (client write)**: a client attempting to update `orders.status` directly is rejected by the column grant. Verifies **AC-12**, **AC-13**.
- **Catalogue equality**: the `packages` table matches `PACKAGES` on key, price and sort order. Verifies **AC-14**.
- **Display formatting**: an amount in Rappen renders as `CHF 2'162.00` in both catalogs with the 0.05 display rounding applied, while the stored and charged values stay untouched. Verifies **AC-15**.
- **Pricing page to checkout**: a signed out visitor clicks a pricing button, signs up, and lands on the checkout for the package they originally picked. Verifies **AC-16**.
- **Placeholder guard**: a placeholder seller value fails the test. Verifies **AC-17**.

## Build plan

The project builds by **Tracer Bullet**: a thin thread runs end to end through database, background job, API and UI before anything is thickened. So the first slice buys one package with a card and shows it paid, with no PDF and no bank transfer. That thread proves the riskiest part (webhook confirmation reaching the database reliably) on day one, when it is cheapest to be wrong about.

**Slice 1: one card purchase, end to end**

1. [x] Write `supabase/schemas/40_packages.sql`, `41_orders.sql`, `42_order_events.sql`, `43_invoices.sql` and `44_stripe_events.sql` with tables, RLS, policies, the two sequences and the transition trigger in the same files; run `pnpm db:diff`, `db:reset`, `db:types`. Re add by hand the three things the diff misses (column grants after the table level revoke, the `anon` execute revoke on any new public function, and any view column list). Satisfies **AC-2**, **AC-3**, **AC-12**, **AC-13**.
2. [x] Seed `packages` through a data migration from `PACKAGES`, and add the Vitest equality test. Satisfies **AC-14**.
3. [x] Write the pure money module `src/features/checkout/money.ts` (`computeAmounts`, Rappen helpers) and its tests, plus the display formatter that applies the 0.05 Rappen rounding. Satisfies **AC-2**, **AC-15**.
4. [x] Write the pure validation helpers `isValidSwissUid` (shape plus mod 11 check digit) and the billing address Zod schema in `schema.ts`, with tests over known good and bad UIDs. Satisfies **AC-11**.
5. [x] Write `startCheckout` in `src/features/checkout/actions.ts`: validate, read the package and reject a null price or inactive one with a typed error, freeze the amounts and billing address, insert the `pending` order and its first `order_events` row, **then** create the Stripe Checkout Session (a `StripeClient` instance, `locale` from the order, no `payment_method_types`), **then** store the session id, return the URL. The ordering is load bearing for the sweep. Satisfies **AC-1**, **AC-11**, **AC-19**.
6. [x] Write `settleOrder` in `src/features/checkout/settle.ts`, the single shared core taking `(orderId, paidAt, actor)`: read the order and any existing invoice first and skip whatever is already done, then in one small transaction mark the order `paid`, write the `order_events` row, draw the invoice number and insert the `invoices` row (nothing else in that transaction), then enqueue the render, and on its success the email and the alert. Cover the resume path with tests that call it twice and kill it partway. Satisfies **AC-3**, **AC-10**, **AC-18**.
7. [x] Write `/api/webhooks/stripe`: read the raw body, verify the signature, insert into `stripe_events`, enqueue `confirm-order` under the idempotency key `order/confirm/<eventId>`, return 200. Handle `checkout.session.completed` **and** `checkout.session.async_payment_succeeded` gated on `payment_status`, plus `checkout.session.expired`. The task is a thin wrapper calling `settleOrder` with the event timestamp and `'service'`. Satisfies **AC-5**, **AC-6**, **AC-7**.
8. [x] Build the checkout entry on the opportunity dashboard plus the billing address form, the company setup redirect, and the order detail page doubling as the Stripe return page, including the "confirming your payment" state for a webhook that has not landed. Satisfies **AC-1**, **AC-11**.
9. [x] Build `/app/orders` with pagination and the paid, pending, expired and cancelled states. Satisfies **AC-1**, **AC-6**.
10. [x] Add the `order_confirmed` email template: schema entry, component, registry entry, `email.order_confirmed.*` keys in both catalogs, and a preview. Satisfies **AC-9**.
11. [x] Write the pgTAP file `supabase/tests/orders.sql` covering all three roles, the expert denial and the cross tenant denial on `orders`, `invoices` and `order_events`. Satisfies **AC-12**, **AC-13**.

**Slice 2: the invoice document**

12. [x] Write `src/features/checkout/seller.ts` reading the seller environment variables, with `SELLER_PLACEHOLDERS` and its guard test. Satisfies **AC-17**.
13. [x] Write the pure `scorReference` helper (ISO 11649, mod 97 check digits over the invoice number's digits, per Value sourcing) with tests against known good references. Satisfies **AC-4**.
14. [x] Create the private `invoices` Storage bucket with its RLS policies on `storage.objects`. Satisfies **AC-4**, **AC-12**.
15. [x] Write the `render-invoice` Trigger.dev task using `swissqrbill/pdf`: draw the full invoice (seller with UID, buyer address, number, dates, line item, net, VAT rate and amount, gross) plus the QR-bill, upload to Storage, record `pdf_path`. On exhausting retries set `pdf_failed_at`, raise an ops alert, and let the email go out without the attachment. Satisfies **AC-4**, **AC-10**.
16. [x] Add the invoice download route minting a short lived signed URL, attach the PDF to the confirmation email (enqueued only after a successful render), and add `retryInvoiceRender` as an ops action for a row with `pdf_failed_at` set. Satisfies **AC-4**, **AC-10**.

**Slice 3: bank transfer and ops control**

17. [x] Write `requestInvoice`: same validation and freezing as `startCheckout`, but issue the invoice immediately with its number and due date, and enqueue the render. Satisfies **AC-8**, **AC-19**.
18. [x] Add the payment method choice to the checkout UI and the "awaiting payment" dashboard state with the invoice download. Satisfies **AC-8**.
19. [x] Write `markOrderPaid` and `cancelOrder` as ops actions. `markOrderPaid` calls the same `settleOrder` core with `now()` and the ops actor, and nothing else. Add the minimal ops orders list under `/admin/orders` (the full ops shell is feature 12). Satisfies **AC-9**, **AC-13**.
20. [x] Wire the three pricing page buttons to checkout, carrying the chosen package through sign up for a signed out visitor. Satisfies **AC-16**.
21. [x] Write the `sweep-orders` scheduled task, mirroring `sweep-research-runs`: expire a `pending` card order with a null `stripe_checkout_session_id` older than 1 hour, and reconcile any card order with a session id against Stripe's own status. Satisfies **AC-6**.
22. Write the Playwright specs: the card happy path against Stripe test mode, the bank transfer path through Mailpit, the cross tenant denial, and axe on every new page. Satisfies **AC-1**, **AC-8**, **AC-12**.

## Consequences

**Positive**:

- The database is the single source of truth for every amount and every document. An auditor, ops and the client all read the same numbers, and Stripe going away later costs one adapter, not the order model.
- Integer Rappen makes a whole class of currency bugs impossible rather than merely tested for, and the `gross = net + vat` check constraint means a wrong amount cannot be persisted at all.
- Webhook only confirmation is the one pattern that survives the client closing the browser, which is exactly what the scope row demanded.
- Computing VAT ourselves means the card path and the bank transfer path share one arithmetic function, so the two can never disagree on what a client owes.
- The bank transfer path opens the door to Swiss SMEs who will not put a five figure company purchase on a card, which is a real share of the target market.
- Reserving `refunded` and leaving delivery states to feature 12 keeps this state machine small enough to reason about while staying additive.

**Negative / tradeoffs**:

- Owning invoice numbering, PDF rendering and QR-bill generation is materially more code than letting Stripe email a receipt. It is roughly a third of this feature's build and exists purely because Swiss invoicing demands it.
- Ops manually reconciles bank transfers by watching e-banking and clicking "mark paid". That is fine at low volume and becomes a real burden past a few orders a week, at which point camt.053 import is the answer.
- Computing VAT ourselves means SME24 owns the correctness of the rate. If Switzerland changes the MWST rate, or SME24 ever sells abroad, that is a data migration and possibly a spec, where Stripe Tax would have absorbed it.
- Invoice numbers interleave across the two payment paths, because a bank invoice numbers at issue and a card invoice at payment. The series stays gapless and chronological by issue date, which is what matters, but the numbers do not follow order creation order.
- A bank transfer invoice that is never paid keeps its number once ops cancels it, so the series contains numbers for sales that did not happen. This is correct under Swiss bookkeeping (a cancelled invoice is retained, not deleted, which is the whole reason cancellation exists) but it does mean the invoice count is not a sales count. Anyone reading the series for revenue must filter on `cancelled_at is null`.
- Omitting the expert read policy deviates from the tenant table contract for the first time. Every future reader of these schema files has to notice the comment explaining why.
- `swissqrbill` is a single maintainer library and a real dependency risk for a load bearing document. Its output is a PDF we store, so an unmaintained version keeps working, but a future Swiss standard change would need attention.
- A restricted Stripe key means one more credential to scope correctly per environment, and a too narrow scope fails at runtime rather than at deploy.

**Neutral**:

- Five new tables, two sequences, one Storage bucket, one webhook route, three Trigger.dev tasks and one email template.
- `swissqrbill` and the Stripe Node SDK are the two new dependencies.
- The `payment.received` alert kind already exists in `src/lib/alerts/schema.ts` and finally gets its first caller, so no new alert kind is needed.
- The seller configuration follows the `SITE_PLACEHOLDERS` pattern feature 13 established, so the guard is a known shape.
- Feature 12 inherits an orders model that already has its money states settled and needs only to add delivery states as an additive check constraint change.

## Follow-up

- [ ] Per environment Stripe checklist for the runbook: create the account, enable CHF, create a restricted key with only Checkout Session and PaymentIntent scope, register the webhook endpoint and record its signing secret, and run one real low value payment on staging before production.
- [ ] Supply the real seller facts before launch: legal name, address, the `CHE-...MWST` UID, and the IBAN the QR-bill pays into. Until then `SELLER_PLACEHOLDERS` holds them and the guard test fails a production build. This belongs on the launch gate (scope row 25) beside the provisional benchmark rows.
- [ ] Confirm the 8.1% rate and the invoice content with your accountant before the first real sale, in particular whether SME24 is already MWST registered at the point of launch, since charging VAT without a registration is a real problem.
- [ ] Decide the retention and purge policy for `stripe_events.payload`, which holds the buyer's email. A `purge-stripe-events` task mirroring `purge-email-deliveries` is the obvious shape, but the accounting retention period may argue for keeping them longer than the email deliveries.
- [ ] Payments conventions belong in a nested `src/features/checkout/AGENTS.md` rather than root `AGENTS.md`: the webhook pattern, the Rappen rule, the freezing rule and the invoice immutability rule are only needed when working in that area. Root gets a one line pointer. This is `/sync`'s call to make after the build.
- [ ] The Stripe MCP server is listed as recommended in `AGENTS.md` and is still not connected. Connecting it before the build would help with test mode payments and event inspection, though the Stripe CLI covers the same ground.
- [ ] Client initiated cancel and refund were considered and deliberately left out of Release 1. Refunds are ops only through the Stripe dashboard plus a manual state change until a feature enrolls them properly.
- [ ] `companies.uid` has no format check today (spec 0002 declared it plain `text null`). Once `isValidSwissUid` exists here, applying it to the research path is a small win that stops a malformed UID reaching a billing form as a prefill.
- [ ] If bank transfer volume grows, replace manual reconciliation with camt.053 bank statement import matched on the SCOR reference.
- [ ] A QR-IBAN with a 27 digit QRR reference is what most Swiss accounting software expects. If your bank issues one later, switching from SCOR is a config change plus a swap of the reference generator, and the two cannot be mixed.
