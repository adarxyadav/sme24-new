# 0018. Contact directory: rationale

The decision record for [index.md](index.md). `/develop` skips this file.

## Context

SME24 bought a global account list on 2 September 2026: a cleaned export of 79,916 contacts at 40,625 companies, every row with an email, most with a phone or mobile, twelve columns of company, person, title, email, phones and postal address. Three fifths of the rows are in the United States, then Mexico, Brazil, Canada, Australia and a long tail; Switzerland is 112 rows, about 12,000 rows carry no country at all. A third of the titled rows say safety, EHS or HSE. A prototype page shows the intended product: type a name, see masked emails and phones per company, pay per unlock. The prototype embeds the whole list in clear text, so it is a flow reference and nothing more.

The material and the product it implies have forces pulling in different directions:

- **The data is personal and the repository is public.** Every row is a natural person at work. Nothing from the list may enter git, a migration, a seed, a fixture, an artifact or a screenshot, and the database must be the only place a raw value lives. The whole design has to work with a database that is loaded from outside the repo.
- **The buyers already exist.** The owner decided on 12 September 2026 that the buyers are the expert accounts of spec 0013, invited by ops, gated by their profile status. There is no consultant signup, no new role, no new area. The directory is a page inside `/expert`.
- **The money must ride the existing rail.** The owner also decided that payment is credit packs on the spec 0011 order rail: whole Rappen, Stripe Checkout or an invoice with a QR bill, the webhook, `settleOrder`, the gapless invoice number. But that rail is tenant shaped: `orders.organization_id` and `company_id` are `not null`, the insert policy requires a company of the buyer's organization, and an expert belongs to no organization (spec 0002, spec 0017's "an expert belongs to none"). Something has to give, and it has to give additively because previews share staging.
- **The legal answer is pending.** Whether the supplier's licence allows resale and which countries may be loaded is a question to the lawyer this week. The owner framed it as a launch gate for the feature, not a build blocker, so the build must be able to finish, run locally on the real file, and be impossible to run against a hosted database until the answer is folded in.
- **The people on the list never signed up.** They are data subjects who can object, and an objection must outlive the next import. The privacy page, the record of processing and the terms all speak about them today as if they did not exist.
- **Retries and races cost money here.** A double granted pack is lost revenue, a double debited credit is a complaint, a reveal that returns the row without the debit is a leak. Every mutation must be safe to run twice.

Not deciding leaves the list in a Downloads folder, the prototype on someone's laptop with 80,000 people in a script tag, and the Loose Ends row open.

## Options considered

### Option 1: A standalone credit shop beside the order rail

A `directory_credit_orders` table with its own Stripe session, its own webhook branch, its own settlement and its own receipt, leaving `orders` untouched. Credits and unlocks as in Option 2.

**Pros**:
- `orders`, `invoices` and every consumer of `organization_id` stay exactly as they are; no nullable widening, no branches in six tasks.
- The credit shop can be simpler than an assessment sale (no delivery states, no scheduling).

**Cons**:
- A second money path: a second place that must be idempotent under a duplicated webhook, a second invoice document or none at all, a second thing ops mark paid, a second sweep, a second alert, and revenue that does not appear on `/admin/orders`.
- Contradicts the owner's decision that credit packs ride the spec 0011 rail with QR bill invoices; the invoice number sequence is gapless by contract and lives on `invoices`, so a separate shop either burns numbers or issues none.

### Option 2: An expert buyer on the existing rail, a ledger granted by `settle_order`, reads only through definer functions (chosen)

`orders` and `invoices` gain a second buyer shape (`buyer_expert_id`, with `organization_id` and `company_id` nullable and a check that exactly one shape holds), `packages` gains a kind and a credit count, `settle_order` grants the credits in the `paid` transaction, credits are an append only ledger, one definer function checks, debits and reveals atomically, and the directory tables have no read policy for any app role.

**Pros**:
- One money path, already tested end to end and already known to ops; the credit pack is a row on `/admin/orders` with an invoice like every other sale.
- The grant sits in the same transaction as `paid` and is keyed on the order, so it is exactly once by construction, whatever the retries.
- The read boundary is a database property that pgTAP proves; the app never holds a raw value it did not pay for.

**Cons**:
- Three `not null` constraints become nullable and the generated types widen, so every consumer of `orders.organization_id` needs a branch or an assertion. Six tasks and actions and one ops list are touched.
- `settle_order` grows a package kind branch; the shared core becomes slightly less single purpose.

### Option 3: A personal organization per expert

Give every expert an `organizations` row of their own at invite time, so the rail's tenant shape holds unchanged and an expert buys like a client.

**Pros**:
- Zero schema change on the rail; the client checkout action could almost be reused verbatim.

**Cons**:
- An expert with an organization claim satisfies `organization_id = jwt_org_id()` on every tenant table, the proxy's client onboarding logic, `is_assigned_expert` semantics and spec 0017's rule that expert events carry no organization. It would quietly turn experts into clients of themselves across the whole schema, the "org isolation as afterthought" failure in reverse.
- `orders.company_id` would still need a company row per expert, a fiction with a UID, a canton and a research run nobody wants.

### Option 4: Masking in the app on top of a readable table

Let experts select `directory_contacts` under RLS and mask in the server component, with the reveal as an action that inserts an unlock and returns the row.

**Pros**:
- Plain PostgREST reads with the usual keyset helpers, no SQL functions to write.

**Cons**:
- The raw email is in every page render's memory and one forgotten mask or one `select('*')` in a future query leaks the whole list. The boundary would be a convention, not a property, and pgTAP could not prove it.
- The debit and the reveal would be two statements in the app, so a crash between them either gives the row away or charges for nothing.

## Rationale

The owner's decisions settle who buys and where the money flows; the open question was how a rail built for tenants carries a buyer who has none. Option 2 answers it with the smallest additive change that keeps one money path: a nullable pair, a new column, a check constraint that makes the two buyer shapes mutually exclusive, and the same `settle_order` that ops and the webhook already share. The nullable widening is real work in six places, but each place already handles the order row and only needs a branch; the alternative, a second money path, is the kind of thing that pages someone at 3am when the two disagree on an invoice number. Option 3 was rejected because a claim is not a label: an organization on an expert's token changes what every policy in the schema means.

The read boundary follows the same logic as the money. The list's only defence is that no role can read it, and a defence that lives in a function body the database enforces is one that survives the next engineer's `select('*')`. A definer function that masks and one that debits and reveals in a single transaction under a per user lock turn the two invariants that matter (no unpaid raw value, no negative balance) into database facts. That is why the tables carry no read policy at all rather than a filtered one.

The import is a script rather than a task for the same reason the list is not in the repo: the file sits on an operator's machine, and a task would need it uploaded somewhere first. The policy file with its `awaiting_lawyer` status makes the launch gate mechanical: the script refuses a hosted database until the commit that carries the lawyer's answer, so the build can finish and be verified locally on the real file while the legal question is still open, which is exactly the owner's framing.

## What the spec deliberately does not decide

Six points are questions for the owner in `## Follow-up` of `index.md`, not assumptions baked in: whether CHF 1.99 is net or gross, the pack ladder, the rows without a country, the retention period for a purchased contact, the VAT position of a buyer outside Switzerland, and ops grants and refunds. Each has a build assumption stated beside it so `/develop` is never blocked, and each is cheap to change afterwards (a seed row, a flag, a constant, an action).

## References

**Project sources**:
- `AGENTS.md`: the four client factories, the service client rule, the typed action result, the proxy and server action rule, the `requireOps` and `requireClient` shape, the analytics ids only rule, the personal data rule.
- Spec 0002: the table kinds and the tenant table contract; spec 0011: orders in Rappen, `settleOrder`, the webhook only confirmation, the Stripe session id write; spec 0013: expert accounts, `requireExpert`, the shell gate; spec 0014: the ops service client shape; spec 0015: the terms version bump procedure, the record of processing test; spec 0017: the event catalogue and the no organization group.
- `scripts/benchmarks-recompute.mts` and `scripts/build-register.mts`: the hand run script shape, the environment swap, and the precedent for stripping contact details before anything is committed.
- The prototype `docs/raw/SME24_Contact_Directory.html` (local only): the masking rule and the unlock flow, nothing else.

**Practices & standards**:
- Idempotency keys and unique constraints for every money operation; the grant keyed on the order, the debit on the unlock.
- Advisory transaction locks for per user check then write sequences.
- `security definer` functions with an empty `search_path` and an explicit role check as the only read path to restricted data.
- Suppression lists keyed on a hash so an objection outlives the data.
- RFC 4180 CSV with formula injection guarding for spreadsheet exports.
