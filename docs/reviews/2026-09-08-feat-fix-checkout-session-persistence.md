# Review, feat/fix-checkout-session-persistence, 2026-09-08

**Reviewed by**: claude-opus-5 (author on an unnamed model; the branch commits are the /debug and /test passes)
**Scope**: 8 files, branch vs `main` (merge base `1a2409e`), package checkout / Swiss VAT slice only. The unrelated feature 12 expert-accounts change on the same branch was excluded.
**Verdict**: Changes requested

## Summary

Two small, well-reasoned production fixes and a large, genuinely good regression suite. `startCheckout` now writes the Stripe session id through the service client (app roles have `UPDATE` revoked on `orders`, so the old buyer-client write silently failed) and refuses to hand out a payable URL until that write is confirmed; the Stripe return URLs now interpolate the short locale code so buyers no longer land on a 404. Both are correct, minimal and match the root causes recorded in `debug.md`. The new `tests/features/checkout/actions.test.tsx`, `order-actions.test.tsx` and the opt-in `persistence.local.test.ts` are unusually high quality — they exercise the real action, the real schema and the real form, and the local one drives the real UI and the real sweep against local Supabase and Stripe test mode.

The headline problem is not in the fixes but in the third commit. `tests/trigger/render-invoice.test.ts` asserts, as correct, a `catchError` hook that the Trigger.dev v4 SDK calls on **every failed attempt**, not once after retries are exhausted — and `verify.md` ticks AC-10 on the strength of that test. The test's own doc comment states the false premise explicitly. Every other task in `src/trigger/` uses `onFailure` for this, which is the hook that actually has the "retries exhausted" semantics. Secondary: the fix quietly falsifies an invariant that `41_orders.sql` and `sweep-orders.ts` both document in prose, and it orphans a message key in both catalogs.

## Major

### 🟠 The exhausted-render test blesses a per-attempt hook as an exhausted-retries hook, and AC-10 is ticked on it, `tests/trigger/render-invoice.test.ts:1-214` (source at `src/trigger/render-invoice.ts:45`)

**Problem**: `renderInvoiceTask` uses `catchError` to stamp `pdf_failed_at` and raise the `invoice.render_failed` ops alert. The bundled SDK docs are explicit that this is the wrong hook for that job:

- `node_modules/@trigger.dev/sdk/docs/errors-retrying.mdx:185` — "We provide a `catchError` callback … This gets called when an uncaught error is thrown in your task."
- `node_modules/@trigger.dev/sdk/docs/tasks/overview.mdx:209` — an error "will propagate through to `catchError()` function and then will fail the attempt (either causing a **retry** or failing the run)."
- `node_modules/@trigger.dev/sdk/docs/tasks/overview.mdx:445` — "`onFailure` … will only be executed once the task run has exhausted all its retries."

With `retry: { maxAttempts: 3 }`, the very first transient failure (a Storage timeout, a `pdfkit` hiccup) stamps `pdf_failed_at` and fires the ops alert before attempts 2 and 3 have run. Every other task in this repo already gets this right: `benchmark-company.ts:180`, `research-company.ts:250` and `send-email.ts:68` all use `onFailure`. `render-invoice.ts` is the only outlier.

The new test does not catch this — it *encodes* it. Its header comment asserts the false premise in so many words ("The hook is tested directly because it only runs after the retries are gone"), and it passes `ctx.attempt.number = 3` to dress the illusion up, but the hook never reads `ctx`, so the suite would pass identically with attempt 1. `verify.md` then ticks the AC-10 command row explicitly "proven by unit test instead", closing a verification item that is not in fact satisfied.

The source line is pre-existing (unchanged since PR #27, `b58f1ac`), so the *bug* did not arrive on this branch. What arrived on this branch is a test that certifies it and a verify tick that closes it. That is what makes this a finding against this diff rather than a note about main.

**Why it matters**: In production, a single retryable render failure gives ops a false `invoice.render_failed` Slack alert and shows the client's order and the ops list a "Failed" invoice while attempts 2 and 3 are still queued. Ops can then press "Create the invoice again" (`retryInvoiceRender` gates only on `pdf_path`, not on whether a run is in flight) and start a concurrent render. It is self-healing — a later successful attempt nulls `pdf_failed_at` — so this is noise and a wrong ops signal rather than data loss, which is why it is Major and not a Blocker. But AC-10's whole claim is "an ops alert fires **after exhausting retries**", and that is currently untrue and now recorded as verified.

**Suggested fix**: Move the body of `catchError` to an `onFailure` hook on `renderInvoiceTask`, matching the three sibling tasks. Then retarget the test at `onFailure` and drop the `ctx.attempt` prop that implies a semantic the hook does not read. Until that is done, un-tick the AC-10 command row in `verify.md` or reword the parenthetical so it does not claim the exhausted path is proven — the honest statement today is that the *body* of the failure handler is proven, not that it runs only when retries are gone. The "Owed on staging" list already carries "a real render failing all 3 attempts so the hook fires in production", which is exactly the gap this would have caught.

## Minor

### 🟡 The fix falsifies a documented invariant that two other files still assert, `src/features/checkout/actions.ts:261-283`

**Problem**: Withholding the URL on a failed session write leaves an order `pending` with `stripe_checkout_session_id` null **while a real, open Stripe session exists for it**. Three places still state the opposite as fact:

- `supabase/schemas/41_orders.sql:86` — "a pending card order with a null session id **never reached Stripe** and is expired outright after an hour"
- `src/trigger/sweep-orders.ts:15-17` — the same claim, in the task doc comment
- `src/features/checkout/actions.ts:159-163` — the `startCheckout` doc comment, which still describes only the Stripe-failure case

The sweep will expire such an order after an hour even though its Stripe session is open for 24. The practical risk is small: the buyer never received the URL, so they cannot pay it, and if they somehow did, `orderIdFromEvent` resolves the order from `client_reference_id` (set before the failed write), so `confirm-order` would still find it — though `settleOrder` would then answer `order_not_pending` on an already-swept order and the payment would need manual repair.

**Why it matters**: The next person reading `sweep-orders.ts` will reason from a comment that is no longer true. The window is narrow and the recovery path exists, but the documented invariant is now load-bearing for a case it no longer covers.

**Suggested fix**: Amend the three comments to say a null session id means "no session the buyer can reach" rather than "never reached Stripe", and consider expiring the Stripe session in the failure branch (`stripe.checkout.sessions.expire(session.id)`, best-effort, inside its own try) so the orphan cannot outlive the order. `debug.md` already notes existing orders are not backfilled, which is the right call; this is about the comments and the new orphan, not a backfill.

### 🟡 `adminOrders.markPaidConfirm` is now dead in both catalogs, `messages/en-CH.json:1900`, `messages/de-CH.json:1900`

**Problem**: The one-line fix in `order-actions.tsx:92` swapped the cancel dialog off `markPaidConfirm` onto the new `cancelDescription`. `markPaidConfirm` is now referenced nowhere in `src/` or `tests/` — I grepped the whole tree. The change is right (the old string was plainly the wrong copy), but it leaves an orphan in both catalogs.

**Why it matters**: Dead catalog keys are cheap individually and expensive in aggregate — a translator maintains them and a reader assumes they are live. It also hides a real gap: the string exists because "Mark as paid" was evidently meant to confirm, and today `markOrderPaid` fires straight from the button (`order-actions.tsx:72-80`) with no dialog, while the strictly less destructive cancel does confirm.

**Suggested fix**: Either delete `markPaidConfirm` from both catalogs, or wire the "Mark as paid" button to a confirmation dialog using it, which is what the key's presence implies was intended. The former is in scope for this branch; the latter is a follow-up worth raising, since marking an order paid sends the client a confirmation email and fires a Slack alert.

### 🟡 The service client is constructed inline rather than through the pattern `ops-actions.ts` already uses, `src/features/checkout/actions.ts:264-265`

**Problem**: `ops-actions.ts:45-55` wraps `serverEnv()` + `createServiceClient(...)` inside `requireOps()`, so the privileged client is only ever minted after authorization and only in one place. `startCheckout` now inlines the same two lines. It is correctly placed (after `requireClient()`, after the RLS insert) and the tests prove no forbidden path reaches it, but it is a second construction site for the RLS-bypassing client in the same feature folder.

**Why it matters**: The service client is the sharpest tool in this codebase. One construction helper per feature keeps "was this authorized first?" a single question rather than one per call site.

**Suggested fix**: Extract a small `serviceClient()` helper in the checkout feature (or widen the `Actor` returned by `requireClient` to carry one lazily) so both actions mint it the same way.

## Nits

- ⚪ `src/features/checkout/actions.ts:273`, `if (updateError) throw updateError;` inside a `try` purely to reach the shared `catch` is a slightly indirect control flow; a small `handleFailure(error)` closure called from both the error branch and the catch would read more directly. Entirely author's discretion — the current shape is compact and the comment explains it.
- ⚪ `src/features/checkout/actions.ts:225`, `process.env.NEXT_PUBLIC_APP_URL ?? ""` predates this change, but with the locale fix landing on the adjacent lines it is worth noting an empty `appUrl` yields a relative `success_url` that Stripe rejects at session creation, surfacing as `stripe_unavailable` rather than a config error. `serverEnv()` is now imported in this file and validates `NEXT_PUBLIC_APP_URL` as a URL, so reading it from there would fail loudly and correctly.
- ⚪ `tests/trigger/render-invoice.test.ts:216-237`, asserting task ordering by reading `confirm-order.ts` as a string and comparing `indexOf` positions is brittle — a refactor that extracts `sendConfirmation` above the trigger call breaks it without changing behavior. The test is honest about being a structural proxy and says so, which is why this is a nit and not a finding.
- ⚪ `tests/features/checkout/persistence.local.test.ts:194`, the control order is inserted by spreading the real `order`, which carries its `created_at` across. That is deliberate and load-bearing for the cutoff, but a one-line comment saying so would save the next reader the trace.

## Strengths

- The root-cause analysis in `debug.md` is exemplary: it names the exact grant (`41_orders.sql` revoking `UPDATE` from the app roles), explains why the service client is permitted here against the AGENTS.md rule and the Biome override, and enumerates why the privileged write cannot be steered by the caller. I verified each claim against `biome.json:71` and `41_orders.sql:171` and they hold.
- `.select("id").single()` on the privileged update is the right instinct — it turns a zero-row update into a failure rather than a silent success, which is precisely the shape of the original defect one level up.
- `actions.test.tsx:178-218` is the standout test: it passes a payload salted with `orderId`, `organization_id`, `stripe_checkout_session_id`, `status` and `gross_rappen` overrides and then asserts the recorded write is exactly `{stripe_checkout_session_id}` filtered on `[id, organization_id]`. That is an authorization boundary tested as a boundary, not as a happy path.
- `actions.test.tsx:157-176` proves the ordering constraint properly, with a deferred promise showing the action has not resolved while the write is outstanding. Most suites would have asserted call order and called it done.
- `persistence.local.test.ts` is the right answer to the handoff item's own warning that "mocking every Supabase call as successful would miss the original defect". Intercepting only Stripe's document request to freeze the browser at the handoff, then asserting the stored session id against Stripe's live `client_reference_id`, is a clean way to test a redirect boundary. It cleans up after itself and it is documented as having been proven to fail against the pre-fix code.
- The seven refused claim shapes in `actions.test.tsx:233-256` include forged `user_metadata` and a top-level `role` claim, which is the exact AGENTS.md rule ("the app role lives in `app_metadata.role`, never a top level `role` claim") tested rather than assumed.
- The Swiss VAT and CHF handling is untouched and remains correct: integer Rappen throughout, 8.1% sourced per-row from `packages.vat_rate` rather than a constant, `automatic_tax` deliberately off with the reason in a comment, and `unit_amount` passed as Rappen — which is right, since CHF's Stripe minor unit is the centime.

## Test coverage

Strong, and materially better than the code it covers. `pnpm exec vitest run tests/features/checkout tests/trigger/render-invoice.test.ts` gives 14 files, 130 passed, 1 skipped (the opt-in local file) on this branch.

Covered well: all three persistence failure branches (database error, zero matched rows, rejected promise) at both the action and the rendered-form level in both catalogs; the write-before-URL ordering; the authorization boundary from seven angles plus a denied RLS insert and a Stripe rejection; the return-URL prefix in both locales, which is a true regression test that fails on the old code; the cancel dialog's accessible description, its reference interpolation, the absence of payment wording, and the reason-required behavior, in both catalogs.

Gaps:

- The AC-10 hook is covered as a function but not as a *lifecycle* — nothing asserts which hook it is attached to or when the runtime calls it, which is exactly how the Major above slipped through. A test that fails if `renderInvoiceTask` exposes `catchError` rather than `onFailure` would be one line and would pin the semantic.
- The `requestInvoice` path was not touched and has no equivalent privileged-write concern, so no gap there.
- `persistence.local.test.ts` is opt-in behind `CHECKOUT_LOCAL_REGRESSION=1` and so does not run in CI. That is the correct trade for a test needing a dev server, local Supabase and a Stripe test key, and `debug.md` documents the exact invocation. Worth knowing it is a manual net, not a standing one.
