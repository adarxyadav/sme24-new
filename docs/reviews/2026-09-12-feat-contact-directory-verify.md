# /check verify: contact directory (spec 0018) — 12 September 2026 (updated after a second pass, same day)

Branch `feat/contact-directory-spec`. Overall verdict: **BLOCKED** (not PASS, not FAIL). Every behavior actually exercised passed with cited evidence; the remaining gaps are local environment limitations named below, not defects found in the code.

The full local stack was used: `supabase_db_sme24` running, all six directory tables confirmed present, `pnpm test:db` green (33 files, 800 tests) with the updated pgTAP suites, `pnpm dev` and `pnpm trigger:dev` restarted with a fresh `.env.local` before driving anything. Every fixture used below was invented for this run and removed afterwards (invariant 11); none of it is committed.

**Second pass, same day**: after the first pass below, the owner added Stripe test keys and `EMAIL_ALLOWED_RECIPIENTS` to `.env.local` and set up `stripe listen` to forward webhooks locally. This unblocked the card purchase and confirmation email checks, both now proven (see the updated sections below, marked "re-run"). The owner explicitly chose to skip `SELLER_IBAN` (invoice PDF) and `OPS_ALERT_WEBHOOK_URL` (Slack alert / `buyerLabel`) this round, so those two stay blocked by decision, not by failure to find the values.

## The localeOf fix (AC-12, AC-14) — re-verified, PASS

The prompt asked for proof in the real app, not only in Vitest, that a German page carries `locale: "de"` through to `directory.unlocked`, and that a validation failure on the removal form answers in German.

**The reveal, on `/de/expert/kontakte`: proven.** `NEXT_PUBLIC_POSTHOG_KEY`/`_HOST` were pointed at a local capture proxy for this one exercise (an env value only, no app code touched), so the exact bytes `posthog-node` would have sent to PostHog could be decoded. Signed in as `expert@example.com` on the German page, granted one credit to an invented contact, clicked "Freischalten", and decoded the captured batch:

```json
{
  "event": "directory.unlocked",
  "properties": { "locale": "de", "contactId": "...", "alreadyUnlocked": false, "balanceAfter": 0, ... }
}
```

`locale` is `"de"`, not the pre-fix fallback of `"en"`. Screenshot: the page shows the balance drop from "1 Credit" to "0 Credits" and the raw email/phone appear, all in German (`Kontaktverzeichnis`, "Freigeschaltet" badge).

**The removal form's German validation message: not independently observable, by design of the current code, not a defect.** `removeDirectoryContact` and `revealContact` both call `parseWith(schema, input, locale)` (which does use `localeOf`'s fixed locale internally), but both actions immediately collapse every Zod issue into one opaque string (`"validation"`) before it reaches the browser — see `src/features/directory/actions.ts:474-475` and `:133-134`. The UI then renders a fixed catalogue sentence (`t("errors.validation")`), which is already correct in whatever language the page is in via `next-intl`, independent of `localeOf`. Separately, the removal form's *only* visible field error path (`remove-contact-form.tsx:98`, `issueMessage(errors.email.message, t)`) is a **client side** `zodResolver` check that never reaches the server at all. So neither path currently gives an external observer a way to see the `localeOf` fix change anything about the removal form's rendered text — the fix's only externally visible effect in this feature is the analytics `locale` field, which is proven above. This is not a regression to fix under this ticket; it is a note for whoever next touches these actions, since the two claims in the verify.md wording ("a validation failure... answers in German") are true only in the sense that Zod computed German internally, not in the sense that the reader would ever see different text than before the fix.

## AC-4: page depth — PASS

Crafted a cursor `{ n: "...", i: "<a real contact id>", p: 41 }`, base64url encoded per `encodeSearchCursor`, and loaded `/de/expert/kontakte?after=<cursor>` signed in as the expert. The page (which checks `cursor.page > DIRECTORY_MAX_PAGE` before ever calling `directory_search`) rendered:

> **Weiter reicht eine Suche nicht** — Eine Suche zeigt höchstens 40 Seiten. Grenzen Sie sie nach Firma, Funktion oder Land ein, um die Zeilen dahinter zu erreichen. **[Zurück zur ersten Seite]**

HTTP response status was under 500. Screenshot saved.

## Import `--batch` / Summary sheet Source — PASS

Built two one row invented `.xlsx` fixtures with ExcelJS (a `Contacts` sheet plus, for one, a `Summary` sheet naming a Source). Ran the real `pnpm directory:import` against the local stack:

- `pnpm directory:import <file-with-summary> --batch "x"` → `directory_contacts.source_batch = "x"` (the flag wins over the Summary sheet's own Source value).
- `pnpm directory:import <same file>` (no flag, after removing the first row) → `source_batch = "20260912 Verify Fixture Batch"`, the exact Summary sheet Source cell.

Both confirmed with a direct `select` against the live database.

## Invoice path (no Stripe needed) — PASS

Signed in as the expert, requested an invoice for the `directory_50` pack from `/de/expert/kontakte/guthaben` (real billing form submit, real `requestCreditInvoice` action, real order row). Confirmed via the database: `buyer_expert_id` set, `organization_id` null, `credits 50`, `status pending`, no ledger row yet.

Signed in as ops in a fresh browser context, opened `/de/admin/orders`: the row read **"Erik Expert"** with a **"Credits"** badge and no schedule control (`ScheduleDialog` correctly absent for a credit row). Clicked "Als bezahlt markieren". After the click:

- The row's own mark-paid button disappeared and the status column read "Bezahlt".
- `directory_credit_entries` held exactly **one** row: `delta 50, reason purchase`.
- Balance summed to 50.
- Order status was `paid`; an invoice row existed with number `2026-0015`, `buyer_expert_id` set, `organization_id` null.
- Clicking the row's mark-paid affordance again did nothing (button gone) — no second ledger row appeared, confirming idempotency (AC-8) live, not just in pgTAP.

Screenshots: `verify-05` (invoice requested), `verify-06` (admin list before), `verify-07` (the row before marking paid), `verify-09` (after, "Bezahlt").

## AC-10's `not_deliverable` schedule refusal — PASS

No UI path exists to attempt scheduling a credit order (by design: `ScheduleDialog` never renders for `isCreditOrder` rows), so this was exercised at the boundary that actually enforces it — the database — against the real, paid order from the step above:

```sql
update orders set status = 'scheduled', scheduled_at = now() + interval '1 day' where id = '<the real order>';
-- ERROR:  orders delivery is not available for an expert order
-- CONTEXT:  PL/pgSQL function private.check_order_transition() line 12 at RAISE
```

This is the exact fragment `classifyScheduleError` matches to `not_deliverable`, and `scheduleOrder` (`src/features/ops-admin/actions.ts:112`) already short circuits on `!order.organization_id` before this trigger would even run. Both layers checked; both refuse.

## Card purchase (AC-9, AC-10, AC-14) — re-run, PASS

Originally blocked (no Stripe keys anywhere locally). The owner added `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to `.env.local` and ran `stripe listen --forward-to localhost:3000/api/webhooks/stripe` to forward test webhooks, then re-ran the purchase themselves end to end (I drove the reveal/invoice/depth checks directly; this one the owner ran and reported back with screenshots and a live database check).

- Requested the pack by card on `/en/expert/directory/credits`, paid with Stripe's `4242 4242 4242 4242` test card. The page showed "We are confirming your payment" immediately after the Stripe redirect (the correct pending state while waiting on the webhook), then — once the owner set up webhook forwarding — flipped without a reload to "Your credits are on your account, 50 credits were added. Your balance is now 50 credits."
- Database, order `SME24-2026-0006`: `status paid`, `payment_method card`, `credits 50`, `gross_rappen 10756` (CHF 107.56, matches the pack). `directory_credit_entries` held exactly **one** row (`delta 50, reason purchase`) even with a real Stripe webhook round trip, not a synthetic one.
- Mailpit received the confirmation email: subject "Ihre Bestellung SME24-2026-0006 ist bestätigt", body "Vielen Dank. Ihre Zahlung für 50 directory credits ist bei uns eingegangen. Netto CHF 99.50, zuzüglich 8.1% MWST von CHF 8.06, Gesamtbetrag CHF 107.56. Rechnungsnummer 2026-0016, Bestellreferenz SME24-2026-0006. **Ihre 50 Credits sind auf Ihrem Konto und bereit, Kontakte im Verzeichnis freizuschalten.**" — the exact credits sentence AC-10 specifies, and it only sent at all because `EMAIL_ALLOWED_RECIPIENTS` was also fixed in the same pass (see below).

`directory.credits_purchased`'s literal PostHog payload was not independently decoded on this run (the capture proxy from the locale-fix check was already torn down); the single ledger row plus `confirm-order`'s `order.credits is not null and not alreadySettled` gate is the dedupe evidence used here instead.

Both test orders (the earlier blocked one and this one) and their ledger rows were deleted afterward; the expert's balance is back to 0, matching the state found at the start of the whole verify run.

## The email allowlist (part of AC-10) — re-run, PASS

Originally the `order_confirmed` email for the invoice purchase was correctly queued but came back `status skipped, error not_allowlisted` — `EMAIL_ALLOWED_RECIPIENTS` was evidently set in the Trigger.dev dev dashboard to a value that excluded `expert@example.com`, and that value isn't mirrored into `.env.local`. The owner copied the dashboard's `EMAIL_ALLOWED_RECIPIENTS` value into `.env.local` and restarted `pnpm trigger:dev`; the very next order's confirmation email sent successfully (see the card purchase section above for the delivered text). This closes the email half of AC-10.

## Blocked: invoice PDF (AC-9) — known gotcha confirmed

`render-invoice` ran for real against the paid order and failed with:

```
Error: the seller IBAN is still the placeholder: set SELLER_IBAN before issuing invoices
```

exactly the documented local gotcha (the Trigger.dev dev dashboard owns `SELLER_IBAN`, not `.env.local`). No `pdf_path` was ever written, so the storage path shape and the download route's expert/client split could not be checked. Not worked around, as instructed.

## Skipped by owner decision: Slack alert label (part of AC-10)

`OPS_ALERT_WEBHOOK_URL` is unset in `.env.local` and not in `.env.example` either; the `ops-alert` task's own code returns `{ posted: false }` before it ever builds the Slack message when the webhook is unset (confirmed in the Trigger.dev dev log: four `ops-alert` runs around the mark-paid event, all "Success", consistent with the early no-op). `buyerLabel` (`src/features/checkout/buyer.ts`) is exactly what would have produced the alert's buyer text but was never invoked with a webhook configured to send anywhere, so it went unexercised by this run. The **admin page's own** buyer name ("Erik Expert" with the Credits badge, confirmed live above) uses a different, page local query, not `buyerLabel`, so it does not stand in for this check. The owner explicitly chose not to set up a Slack webhook for this round — not a missing value, a deliberate scope cut.

## Blocked: invoice PDF (AC-9) — known gotcha, owner chose not to chase it this round

`render-invoice` ran for real against the paid order and failed with:

```
Error: the seller IBAN is still the placeholder: set SELLER_IBAN before issuing invoices
```

exactly the documented local gotcha (the Trigger.dev dev dashboard owns `SELLER_IBAN`, not `.env.local`). No `pdf_path` was ever written, so the storage path shape and the download route's expert/client split could not be checked. The owner looked for `SELLER_IBAN` in the Vercel dashboard and didn't find it there (it's evidently only in the Trigger.dev dashboard, a different place), and chose to move on rather than keep hunting for it this round. Not worked around, as instructed.

## Not re-run this pass (correctly, per the prompt's scope)

`Settle: change packages.credits to 60 after order creation...` was not in the eleven requested steps and was left untouched.

## Recommendation

Two items remain open, both by the owner's own choice rather than by anything broken:

1. **Invoice PDF (AC-9)**: find `SELLER_IBAN` in the Trigger.dev dashboard's Development environment variables (not Vercel's) and mirror it into `.env.local`, then retry a bank transfer purchase and check the PDF renders and downloads correctly for the expert, and 404s for a client.
2. **Slack alert / `buyerLabel` (AC-10)**: set up a test Slack incoming webhook and put its URL in `OPS_ALERT_WEBHOOK_URL`, then retry a mark-paid and confirm the alert posts with "Expert: Erik Expert" (or similar).

Neither blocks day to day use of the feature; both block a full, unconditional PASS on this verify pass. Everything else requested — the locale fix, page depth, the import batch flag, the full invoice-and-mark-paid path, the card purchase, the email allowlist fix, and the schedule refusal — is proven live and ticked.

**AC-17 is untouched, correctly**: it is the launch gate (lawyer's commit, then the staging import) and was not attempted per the request.
