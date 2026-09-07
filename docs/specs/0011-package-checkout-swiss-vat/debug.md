# Debug: checkout session persistence and cancel wording

2026-09-08 · Fixes from the spec 0011 verify run. Durable regression tests are handed to `/test` below.

## Root causes and fixes

**Session persistence (AC-6, AC-7).** `startCheckout` attempted an UPDATE through the buyer's RLS-bound client even though `41_orders.sql` revokes UPDATE from every authenticated app role. The action then returned the payable URL despite the failed write. The null session id made that order eligible for the unstarted-checkout sweep after an hour.

Chosen fix: use `createServiceClient` for this one write. `actions.ts` has `"use server"`; AGENTS.md allows service clients in server-only code, and the Biome restricted-import messages explicitly allow feature server actions. The caller is authenticated and authorized before the order is inserted through the buyer's RLS-bound client. The privileged update filters by that newly inserted order id and the actor's organization id; neither the target order id nor the Stripe session id comes from the submitted form. No grants or policies change.

The update selects its id with `.single()`, so zero affected rows fail too. A database error or thrown failure is captured in Sentry and logged with the order and session ids, and the action returns `{ ok: false, error: "unexpected" }` without a checkout URL. Only a confirmed write permits the payment handoff.

**Cancel description (AC-9).** The cancel dialog referenced `adminOrders.markPaidConfirm`. It now uses `adminOrders.cancelDescription`, with cancellation wording and the order reference in both catalogs. The cancellation action is unchanged.

No changes to the schema, sweep, `settle_order`, `settleOrder`, or `confirm-order`. Existing orders with missing session ids are not backfilled by this fix.

## Verification performed

- Targeted Biome check and `pnpm typecheck`: pass.
- `pnpm exec vitest run tests/features/checkout tests/messages.test.ts`: 12 files, 102 tests pass.
- Real Next.js app on port 3111 against local Supabase, driven through Playwright with Stripe test mode: `culture` checkout `SME24-2026-0006` reached the hosted payment page; its stored session id matched Stripe's open session and `client_reference_id`; total was 216200 Rappen.
- The sweep's exact selection predicates, scoped to this order and using a simulated clock two hours ahead (cutoff one hour ahead), returned no row. Its `created_at` was before the cutoff, proving exclusion came from the non-null session id. No shared order timestamps were changed and the sweep was not run across existing rows.
- A direct UPDATE of that order through `client@example.com` still returned HTTP 403.
- Ops opened the cancel dialog for that order in English and German. Playwright verified the full accessible description, interpolated reference, and visible reason field in each locale.
- The probe expired only its new Stripe test session after checking it; no payment was submitted. The local order remains pending until expiry reconciliation runs.

The available runtime was Node 25.1.0, rather than the project's Node 22 target. No full database suite or worker-dependent PDF/email/Slack flow was rerun; the verify run's known blockers remain as recorded. The new persistence-failure branches were not fault-injected in this live probe.

## Regression handoff to `/test`

- [ ] **Real persistence and sweep exclusion:** authenticate a seeded client with an owned company, submit the actual checkout UI against local Supabase and Stripe test mode, and assert the order stores the returned Stripe session id before the browser reaches payment. Match Stripe's `client_reference_id` to the order. Advance the sweep clock beyond an hour while the session remains open and assert the order stays pending and is excluded. Preserve direct authenticated UPDATE denial. This must exercise actual grants; mocking every Supabase call as successful would miss the original defect.
- [ ] **Persistence failure:** let session creation succeed, then make the service UPDATE return a database error. Assert the action returns `unexpected`, exposes no payment URL, and reports the order/session context. Repeat for zero matched rows and a rejected update promise. Verify the UI stays on checkout with its localized error. The previous implementation returned success for a database error.
- [ ] **Authorization boundary:** forbidden callers and failed RLS inserts never reach the privileged write. An allowed call targets only the order created by that call within its authenticated organization and writes only the Stripe session id.
- [ ] **Cancel wording:** render/open the pending-order cancel dialog with each real catalog; assert its accessible description requests cancellation, includes the reference, and contains no payment-received wording. Retain the reason field and disabled confirmation while the reason is blank.

Reuse local Supabase credentials from `supabase status`; shell overrides must replace the staging URL/keys and `VERCEL_ENV` from `.env.local`. Keep Stripe keys in test mode. The existing settlement concurrency, resumability and invoice-number tests remain the baseline; these fixes do not require changing that implementation.
