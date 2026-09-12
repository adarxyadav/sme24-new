# src/features/checkout

Moved out of the root `AGENTS.md` so it loads only when this area is touched. The root keeps a one line pointer here.

## Package checkout and Swiss VAT

Every amount is whole Rappen in `bigint` columns, computed only by the pure `computeAmounts` in `src/features/checkout/money.ts`; no float ever carries money and `gross_rappen = net_rappen + vat_rappen` is a check constraint, not app code. Payment confirmation reaches the database only through `/api/webhooks/stripe`, never the browser, and `settleOrder` in `settle.ts` is the single resumable core that writes `paid`, draws the gapless invoice number and enqueues the follow up work. App roles have `UPDATE` on `orders` revoked, so `startCheckout` stores the Stripe session id through the lazy `Actor.service()` client that `requireClient` mints after authorization (the same shape as `requireOps`), and it withholds the payable URL unless that write is confirmed, because the sweep reads a null session id as an order nobody can pay. Any URL handed to Stripe or a buyer interpolates `LOCALE_CODE[locale]` (the short `de` and `en`), never the locale object. A Trigger.dev task that must act once after retries are exhausted uses `onFailure`, never `catchError`, which runs on every attempt.
