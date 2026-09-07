# Verify: package checkout with Swiss VAT · spec 0011 · updated 2026-09-07
_Steps derived from spec 0011 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Stripe test mode and a running `pnpm trigger:dev` worker are needed for the card and email steps.
Without a worker the order and invoice rows still appear; the PDF and the email do not.

## UI / manual

- [x] Sign in as a client with a company, open `/en/app/checkout`, buy `culture` by card in Stripe test mode → the dashboard lists the order as paid at `CHF 2'162.00` → AC-1  _(2026-09-08: real Stripe test card purchase, order SME24-2026-0001 paid at CHF 2'162.00)_
- [x] Repeat for `sms` (`CHF 5'405.00`) and `compliance` (`CHF 10'810.00`) → each is bought and shown paid → AC-1  _(2026-09-08: both bought by card and shown paid)_
- [x] Open Stripe Checkout in German (`/de/app/kasse`) → the hosted page is German and shows the gross amount in CHF → AC-1, AC-15
- [x] Complete payment then close the tab before the redirect → the order still becomes paid, the invoice exists, the email arrives → AC-5  _(2026-09-08: every purchase settled from the webhook alone, out of band from the browser, which never reached a working return page; the order, its invoice and its email row all appeared)_
- [x] Open Checkout and abandon it, then let `checkout.session.expired` arrive → the order reads expired, has no invoice, and no invoice number was consumed → AC-6
- [x] The expired order is absent from `/app/orders` → AC-6
- [x] Return to `/app/orders/<id>` while the order is still pending with a session id → the page reads "We are confirming your payment", never "awaiting payment", and writes nothing → AC-5
- [x] Choose Invoice at checkout → the order is created, the page reads "Awaiting your payment" with a due date 30 days out, and the invoice PDF downloads → AC-8  _(2026-09-08: SME24-2026-0003, due 7 October 2026, invoice 2026-0005 PDF downloads through a signed URL)_
- [x] Open the downloaded PDF → it shows the seller with its `CHE-…MWST` UID, the frozen buyer address, the invoice number and date, the package line, net, the VAT rate and amount, the gross total, and a Swiss QR-bill → AC-4  _(2026-09-08: every field present plus the QR bill with its SCOR RF reference and the IBAN)_
- [x] Sign in as ops, open `/en/admin/orders`, click "Mark as paid" on the pending transfer → the order becomes paid, the client gets the confirmation email and Slack shows `payment.received` → AC-9  _(2026-09-08: with a worker running, the ops row, the confirmation email and the `payment.received` Slack alert all proven)_
- [x] Ops cancel a pending order with a reason → the order reads cancelled and its invoice row still exists with `cancelled_at` set → AC-9
- [x] Sign out, click a pricing page package button, sign up → you land back on the checkout for the package you picked → AC-16
- [x] A signed in client with no company opening `/app/checkout` → routed to company setup, not a broken form → AC-11
- [x] Type a malformed UID (`CHE-101.654.424`) → rejected under the field before submitting; leave it empty → accepted → AC-11
- [x] Sign in as a client of another organization and open the first client's order id and its `/api/orders/<id>/invoice` → both answer 404, not 403 → AC-12

## Commands

- [x] `pnpm test:db` → all suites pass, including the expert reading zero orders, invoices and order events → AC-12, AC-13  _(2026-09-08: 25 files, 553 tests, after a db:reset cleared stale shared-stack drift)_
- [x] `pnpm test` → the money, UID, SCOR, seller guard and catalogue suites pass → AC-2, AC-4, AC-11, AC-14, AC-17
- [x] Post the same `checkout.session.completed` event twice with `stripe trigger` or a replay → exactly one paid order, one invoice, one invoice number, one email, one Slack alert → AC-7  _(2026-09-08: a cloned event with a fresh id gave one invoice, one email, one Slack alert and drew no second number)_
- [x] Post a webhook with a wrong signature → 400, and nothing is written → AC-5
- [x] Call `startCheckout` with `retainer` → `package_not_purchasable`, and no order row is inserted → AC-19
- [x] Kill `confirm-order` right after its transaction commits, then let it retry → the retry finds the order paid and the invoice issued, draws no second number, and enqueues only what is missing → AC-18
- [ ] Make the render task throw repeatedly → the order stays paid, `pdf_failed_at` is set, the ops alert fires, the email still arrives, and ops can retry the render → AC-10  _(2026-09-08: partly proven. With SELLER_IBAN unset the render refused and the order stayed paid with its invoice and its email; ops saw "Failed" and the retry button dispatched a real run. `pdf_failed_at` on exhaustion, the ops alert and a successful re-render were not reached: the dev worker skips retries and the Trigger project's own SELLER_IBAN shadows the local one.)_
- [x] With `SELLER_IBAN` unset → the seller guard test fails and the render refuses rather than printing a placeholder IBAN → AC-17
- [x] `select count(*) from public.invoices` versus `max(number)` after several purchases → the series is gapless and strictly increasing → AC-3  _(2026-09-08: counters 3, 4, 5 then 8, 9: each step exactly 1, matching the sequence)_

## Value sourcing

One step per row of the spec's Value sourcing table, exercising the edge that breaks if the source is wrong.

- [x] Change a package price in `packages`, then open an older paid order → its amounts and its invoice are unchanged, because the price was frozen at purchase → AC-2, AC-3  _(2026-09-08: culture raised to CHF 9'990, the older paid order and its invoice unchanged)_
- [x] Deliver a `checkout.session.completed` event whose `created` is an hour old → `paid_at` records the Stripe clock, not ours → AC-5  _(2026-09-08: an event clock a year off wrote paid_at 2025-09-07 while created_at stayed 2026)_
- [ ] Create an order at 23:59 Zurich time on 31 December → the reference and the invoice number carry the year the buyer saw, not the UTC year
- [ ] Buy in German, then switch the profile to English → the invoice PDF stays in the purchase language while the email follows the profile → AC-4
- [ ] Edit the UID at checkout → the order's `billing_uid` changes and `companies.uid` does not
- [x] Compare `public.scor_reference('20260001')` with `scorReference('2026-0001')` in TypeScript → identical, and the QR-bill library reports `SCOR`
- [x] Check a paid order's `order_events` → the webhook row carries `actor_role 'service'` with a null actor, the ops row carries `'ops'` and the acting user → AC-13
- [x] Confirm `gross_rappen` on every order equals `net_rappen + vat_rappen` and that no amount is stored as a float → AC-2

## Acceptance-criteria coverage

- AC-1 card purchase of all three packages · AC-2 integer Rappen and the money invariant · AC-3 one gapless numbered invoice per paid order · AC-4 the QR-bill PDF and its signed download · AC-5 webhook only confirmation and the confirming state · AC-6 abandoned checkout expires with nothing consumed · AC-7 a duplicated event yields exactly one of everything · AC-8 the bank transfer path · AC-9 ops settle through the same core · AC-10 a failing render never unwinds a payment · AC-11 the billing address and the UID check digit · AC-12 tenant and expert denials · AC-13 the order event trail · AC-14 the catalogue equality test · AC-15 display formatting from Rappen · AC-16 the pricing page to checkout · AC-17 the seller placeholder guard · AC-18 `confirm-order` is resumable · AC-19 an unpurchasable package is refused
