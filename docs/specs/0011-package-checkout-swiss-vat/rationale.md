# 0011. Package checkout with Swiss VAT: rationale

The reasoning behind [index.md](index.md). Not read during a build.

## Context

> ⚠️ Premise note: the scope row asks for "pays online with Swiss VAT applied", which reads like a card checkout. The interview widened it: Swiss SMEs buying a five figure assessment frequently will not put it on a card, and expect an invoice they pay from e-banking. Building card only would have shipped a checkout a meaningful share of the target market cannot use, and retrofitting bank transfer afterwards means retrofitting invoice numbering, PDF generation and the QR-bill, which is most of the work. So the invoice document is treated as core here rather than as a receipt bolted onto a card payment. The visible cost is that this feature is larger than the scope row implies. Client initiated cancel and refund, which the engineer initially also selected, were pushed out to keep it from growing further.

SME24 has a client who can see their benchmark and a CHF opportunity number, and three fixed price packages sitting on a pricing page with buttons that do nothing. This feature is where the product first takes money, so it is also where a mistake first costs real money rather than a bad user experience.

Three forces shape it. **Swiss invoicing is not a receipt.** A Swiss business buyer needs a document showing the seller's UID with its `MWST` suffix, the net amount, the VAT rate and amount, and the gross total, so their bookkeeper can reclaim the 8.1%. Swiss bookkeeping rules keep that document for ten years, which makes an invoice an immutable record rather than a view over current data. Most Swiss B2B invoices also carry a QR-bill, the scannable payment block, and buyers notice its absence.

**Payment confirmation is a distributed systems problem wearing a business suit.** The browser is not a reliable narrator: the client may close the tab during the redirect, the network may drop, the webhook may be delivered twice or out of order. The scope row's "even if they close the browser" and "no half order" are both statements about which component is allowed to be the writer of record. Getting this wrong produces the one class of bug that cannot be shrugged off, a customer charged with no order, or an order with no charge.

**Money arithmetic is unforgiving.** 8.1% of CHF 2'000 is exactly CHF 162.00, but the moment a package price is not a round thousand the rounding rule has to be decided and applied consistently across the invoice, the charge and the display. Floating point arithmetic on currency is a known source of one centime discrepancies that an invoice cannot survive, because net plus VAT must equal gross exactly on a document a tax authority may read.

The surrounding ground is already laid. Spec 0001 named Stripe and sketched the webhook pattern. Spec 0002 reserved `packages`, `orders`, `order_events` and `stripe_events` with their table kinds, and defined the tenant table contract these tables copy. Spec 0004 left an explicit follow up for Rappen rounding and the Stripe locale. Spec 0009 shipped the three pricing buttons waiting for this feature and the `SITE_PLACEHOLDERS` guard pattern this one reuses. The `payment.received` Slack alert kind has been typed since feature 7 with no caller. Not deciding leaves the product unable to earn, with a pricing page advertising prices nobody can pay.

The prerequisites this feature assumes all have specs: auth and roles (0005), the tenancy model (0002), transactional email (0006) and the benchmark dashboard it launches from (0008). Nothing load bearing is undesigned.

## Options considered

### Option 1: Stripe Checkout with Stripe issuing the receipt

Use Stripe Checkout for cards, enable Stripe Tax for the VAT, and let Stripe email its own receipt or invoice. Store a thin order row keyed to the Stripe session.

**Pros**:
- By far the least code. No PDF rendering, no numbering, no QR-bill, no VAT arithmetic.
- Stripe's receipt and tax handling are maintained by Stripe, including future rate changes.
- Fastest path to a first payment.

**Cons**:
- No Swiss QR-bill, which Swiss B2B buyers expect on an invoice.
- Invoice numbering lives in Stripe, so the gapless series a Swiss audit asks about is outside your control and outside your database.
- No bank transfer path at all, so a share of the target market cannot buy.
- Stripe Tax requires an active tax registration; without one it silently collects nothing while appearing to be on, which is the most common Stripe Tax mistake and a genuinely dangerous failure mode for a seller who believes VAT is being charged.
- The order record becomes a shadow of Stripe's data rather than the business record.

### Option 2: Stripe Checkout for cards, invoice first bank transfer, both settled by a webhook, with orders and invoices owned by our database (chosen)

Stripe is the card acquirer only. Amounts are computed in our code as integer Rappen and passed to Stripe already calculated. Invoice numbering comes from a Postgres sequence, the PDF with its QR-bill is rendered in a Trigger.dev task and stored in Supabase Storage, and the webhook is the only writer of the paid state. A bank transfer buyer gets a real invoice at issue and ops marks it paid.

**Pros**:
- One arithmetic function serves both payment paths, so they cannot disagree on what is owed.
- The invoice is an immutable stored artefact with a gapless number, which is what an audit actually wants.
- Bank transfer works from day one, which matters for five figure Swiss B2B purchases.
- The order model is ours, so replacing or adding a payment provider later is an adapter, not a migration of the business record.
- Webhook only confirmation survives a closed browser, satisfying the scope row directly.
- No Stripe Tax registration dependency and no risk of the silent zero tax failure.

**Cons**:
- Materially more code: numbering, PDF rendering, QR-bill generation and the seller configuration are roughly a third of the build and exist purely for Swiss invoicing.
- SME24 owns VAT correctness. A rate change or a first foreign sale is a data migration and possibly a spec.
- Manual bank reconciliation is ops work that scales badly past a few orders a week.
- A single maintainer PDF library sits on a load bearing path.

### Option 3: Payment Element embedded in the app, everything else as Option 2

Same ownership model, but the payment form lives inside SME24's own design system so the client never leaves the site.

**Pros**:
- A more polished, uninterrupted flow, and full control of the payment step's look and copy.
- No redirect, so the closed browser problem is smaller in practice (though the webhook is still required).

**Cons**:
- SME24 owns the payment page: its states, errors, accessibility and localisation, all of which Stripe otherwise handles and keeps current.
- A wider PCI DSS surface than the hosted page, for a product whose differentiator is nowhere near the payment form.
- Meaningfully more front end work for a flow a client uses once or twice a year.

### Option 4: Invoice only, no card payments at all

Skip Stripe entirely in Release 1. Every purchase produces an invoice with a QR-bill and ops reconciles every payment.

**Pros**:
- The simplest possible build: no Stripe SDK, no webhook, no signature verification, no session lifecycle.
- Matches how many Swiss consultancies actually sell, and nothing about it is wrong.

**Cons**:
- Every single sale becomes ops work, from the first one.
- No instant confirmation, so the momentum from seeing a CHF opportunity number to buying is lost to a payment that lands days later.
- The scope row asks for paying online, and the pricing buttons would still not complete a purchase.
- Adding cards later means adding the webhook, the session lifecycle and the reliability work anyway, just later and against a live invoice flow.

## Rationale

Option 2 is chosen because two of the three forces in Context are not negotiable and only it addresses both. Swiss invoicing needs an immutable numbered document with a QR-bill, which Options 1 and 3 either do not produce or produce outside our control. Reliable confirmation needs a webhook only writer, which every option except 4 can do but only 2 combines with a business record we own. Option 4 handles invoicing perfectly and fails the "pays online" requirement the scope row states plainly.

The deciding argument against Option 1, the tempting one because it is so much less code, is the Stripe Tax registration trap flagged by the `stripe-best-practices` skill: without an active registration Stripe collects no tax while the integration appears to be working. For a seller who is charging 8.1% because Swiss law requires it, silently charging nothing is worse than an error. Computing a single flat rate ourselves is a dozen lines of pure, testable arithmetic and removes that failure mode entirely. Verification confirmed `automatic_tax` is optional for exactly this case, a single flat rate to domestic customers.

Option 3 was rejected on the "boring technology" principle rather than on any technical flaw. SME24's differentiator is the research and benchmark, not the payment form. Handing Stripe the hosted page buys maintained localisation, accessibility, 3D Secure handling and a smaller PCI surface, in exchange for a redirect a client sees once or twice a year. That is a good trade. If checkout conversion later proves to be a real problem, moving to the Payment Element is a front end change against an unchanged order model, which is precisely the flexibility owning the model buys.

Two decisions inside Option 2 deserve their own note. **Integer Rappen over `numeric`** was picked because `numeric` is exact in Postgres but crosses into JavaScript as a string or a lossy number, so the safety stops at the boundary; integers are exact on both sides, and Stripe's own minor unit for CHF is the Rappen, so the value passes to Stripe unchanged. **Freezing the price and address onto the order** rather than joining to `packages` and `companies` at read time is deliberate denormalisation, and it is one of the few cases where it is unambiguously right: an invoice must show what was true when it was issued, and a join would let a later price edit rewrite history.

The engineer initially selected client cancel and refund, a QR-bill, gapless numbering and bank transfer all together, which is roughly three features. The cut kept everything load bearing for a correct first sale and pushed refunds to ops, on the reasoning that a refund is rare, high touch and safe to do by hand at this stage, whereas an invoice that cannot be produced blocks every sale.

The engineer's initial pick of a QR-IBAN with a 27 digit QRR reference was corrected during the interview after verification: QRR and QR-IBAN are coupled by the standard and cannot be used with an ordinary IBAN. SCOR (ISO 11649) gives the same structured, checksummed reconciliation with the IBAN SME24 already has, and switching to QRR later is a config change plus a reference generator swap. That correction removed a bank setup dependency that would otherwise have blocked the build.

## Verification notes

Checked on 2026-09-07 while the design was open, so the spec does not rest on stale recall:

- **`swissqrbill` 4.4.1**, released 2026-08-14, actively maintained. Runs server side on Node 22 with no browser, builds on PDFKit, and its `Table` support means it can draw a full invoice rather than only the payment part. Imported as `swissqrbill/pdf`.
- **QR reference pairing rule**: the Swiss standard allows QRR (27 digit numeric), SCOR (ISO 11649, RF prefix) and NON. QRR requires a QR-IBAN, identifiable by digits 5 and 6 being 30 or 31. SCOR and NON require an ordinary IBAN. The pairing is enforced at the bank, so a wrong combination fails in production rather than in code. This is what changed the reference decision.
- **Stripe Node SDK v22.6.1**, API version `2026-08-26.dahlia`. Checkout Session created server side with `stripe.checkout.sessions.create`, webhook verified with `stripe.webhooks.constructEvent` over the raw body plus the `stripe-signature` header, and Checkout accepts a `locale` parameter taking `de` and `en`.
- **Stripe Tax is optional** for a flat domestic rate; passing computed amounts is the simpler correct path, and `automatic_tax` earns its complexity only across multiple regions or rates.
- From the `stripe-best-practices` skill: prefer a restricted key (`rk_`) over a secret key; never pass `payment_method_types`, so dynamic payment methods stay configurable from the dashboard; instantiate a `StripeClient` rather than the deprecated module level key; and handle `checkout.session.async_payment_succeeded` alongside `checkout.session.completed`, gated on `payment_status`, because some payment methods settle asynchronously.

One caveat carried forward: the Stripe `locale` parameter is supported but does not guarantee full German coverage on every Checkout surface. Worth an eye during verification rather than an assumption.

## Cross check

An independent read only critique on a different model (Sonnet) ran against the drafted spec on 2026-09-07 and found two genuine correctness bugs plus nine unnamed value sources. All were applied:

- **"The same confirmation path" was not true.** The spec claimed ops marking a bank transfer paid ran the same path as a card payment, while Value sourcing took `paid_at` from a Stripe event that does not exist on the ops path. Fixed by extracting `settleOrder(orderId, paidAt, actor)` as the single shared core with two thin callers, and naming both callers' inputs separately in Value sourcing. Invariant 13 now says nothing else may write `paid`.
- **Resumption after partial success was uncovered.** A crash after the paid transaction committed but before the follow up work was enqueued would, on retry, hit the `invoices.order_id` unique constraint and error out, leaving a charged client who never hears anything. The idempotency story covered duplicate Stripe events, not this. Fixed by making `settleOrder` resumable (read state first, do only what is missing) with AC-18 and its own test scenario.
- **`retainer` could enter checkout**, where its null price would violate `net_rappen > 0` as an opaque database error instead of a typed one. Fixed with AC-19 and the `package_not_purchasable` error.
- **The sweep could not distinguish** an order whose Stripe call crashed from one waiting on a webhook, because the insert ordering was never stated. Fixed by fixing the order (insert, then session, then store the id) and keying the sweep on a null session id.
- **Six unnamed sources** now named in Value sourcing: the SCOR transform's actual input (the invoice number's digits, not the order reference text), the Swiss UID validation rule (mod 11 check digit), the return page's handling of a webhook that has not landed, the distinction between a still rendering and a permanently failed PDF (a new `pdf_failed_at` column plus an ops retry action), the ordering between the render and the email that attaches its output, and `actor_role` being `'service'` for every non human writer here.

One finding was considered and not applied: the reviewer flagged that a cancelled bank transfer invoice permanently consumes a number for a sale that never happened. That is correct behaviour under Swiss bookkeeping, where a cancelled invoice is retained rather than deleted, so the number should be consumed. It is recorded in Consequences instead, with the note that anyone reading the series for revenue must filter on `cancelled_at is null`.

The reviewer also noted that `invariant 3` (gapless numbering) was in tension with the build step that wrapped the numbering in a larger transaction. The invariant now states the transaction's exact contents and why keeping it minimal is what makes gaplessness enforceable rather than aspirational.

## References

**Project sources** (verifiable, in this repo):

- `AGENTS.md`: the functional style rule, the single error handling pattern, the four client factories, the tenant table contract, and the email and alert rails this feature reuses.
- Spec 0001 (stack architecture): named Stripe, reserved the three Stripe environment variables, and sketched the webhook pattern of verify, record the event id, enqueue, return 200, explicitly deferring checkout mode, VAT handling and order states to this feature.
- Spec 0002 (data model): reserved `packages` (kind G), `orders` and `order_events` (kind T) and `stripe_events` (kind I), and supplies the tenant table contract these tables copy plus the one deviation this spec documents.
- Spec 0004 (localization): the `chf` and `chfWhole` next-intl formats, and the standing follow up for 0.05 Rappen rounding and the Stripe locale.
- Spec 0006 (transactional email and ops alerts): `sendEmail`, the template registry, and the already typed `payment.received` alert kind that finally gets a caller here.
- Spec 0008 (peer benchmark): the opportunity dashboard this checkout launches from, and the launch gate pattern for provisional values.
- Spec 0009 (marketing site): the three fixed price pricing buttons waiting for checkout, `PACKAGES` in `src/features/marketing/packages.ts`, and the `SITE_PLACEHOLDERS` guard pattern the seller configuration copies.
- The `stripe-best-practices` community skill (`.claude/skills/stripe-best-practices/`): the restricted key default, the `payment_method_types` rule, the `StripeClient` instance rule, the fulfilment in a webhook handler rule, and the Stripe Tax registration warning.

**Practices & standards**:

- Idempotency keys and unique constraints for money operations: guard at the database, not with an application read then write.
- Webhook as the sole writer of record for asynchronous payment confirmation; the return page reads only.
- Integer minor units for currency, never floating point.
- Freezing point in time values onto a financial document rather than joining live reference data.
- Append only event trails for financial state changes.
- ISO 11649 creditor reference (SCOR) for structured payment reconciliation.
- Swiss Code of Obligations bookkeeping retention: business records kept ten years, which is why an invoice is cancelled and never deleted.
- Swiss VAT invoice content requirements: seller identity with the UID carrying the `MWST` suffix, buyer identity, date, description, net, rate, tax amount and gross.

**Links** (web verified during the design conversation on 2026-09-07):

- swissqrbill: https://github.com/schoero/swissqrbill
- Stripe Node SDK: https://github.com/stripe/stripe-node
- Stripe payment method integration options: https://docs.stripe.com/payments/payment-methods/integration-options.md
- Stripe go live checklist: https://docs.stripe.com/get-started/checklist/go-live.md
- Stripe Tax, Switzerland: https://docs.stripe.com/tax/supported-countries/europe/switzerland
- Stripe on the Swiss VAT rate: https://stripe.com/resources/more/switzerland-vat-rate
- QR-IBAN versus IBAN, which to use: https://www.snapbill.ch/en/blog/iban-vs-qr-iban-which-number-on-invoice
- QR-bill reference types: https://vidima.ch/en/qr-bill/
