# Record of processing activities

**Controller**: IC Hotz GmbH, Obermühle 5, 6340 Baar, Switzerland · service@sme24.ch
**Last reviewed**: 2026-09-12
**Scope**: every table in the `public` schema of the SME24 production database.

This is the Art. 12 revDSG record. SME24 is very likely exempt from keeping one (the exemption
covers companies under 250 employees whose processing is low risk), and it is kept anyway,
because it is the artefact that keeps [the privacy page](../../src/app/%5Blocale%5D/%28marketing%29/privacy/page.tsx)
true and because the exemption stops applying the moment the company grows or starts profiling.

Every table below exists in the schema, and every table in the schema appears below: the pgTAP
test `supabase/tests/record_of_processing.test.sql` reads `information_schema` and fails when the
two lists differ. A new table is therefore a row here in the same pull request.

## Legal bases

| Code | Basis |
|---|---|
| contract | Performance of the contract, or steps taken at the data subject's request before it (Art. 31 para. 2 lit. a revDSG; Art. 6(1)(b) GDPR). |
| legal | Compliance with a legal obligation, in practice Art. 958f CO's ten year retention of accounting records (Art. 31 para. 1 revDSG; Art. 6(1)(c) GDPR). |
| interest | Overriding legitimate interest in a service that works and is not abused (Art. 31 para. 1 revDSG; Art. 6(1)(f) GDPR). |
| consent | The data subject's consent, freely given and withdrawable (Art. 6 para. 6 revDSG; Art. 6(1)(a) GDPR). |
| none | No personal data. The row is listed so the record is complete and so nobody has to re-derive that it is out of scope. |

## Retention codes

| Code | Meaning |
|---|---|
| account | Kept while the account exists; removed or anonymised when a deletion request is fulfilled. |
| purged \<n\>d | A scheduled task deletes or nulls it after n days. The number lives in `src/features/legal/retention-periods.ts`, which the task imports, so the record and the code cannot disagree. |
| ten years | Kept for ten years from the end of the financial year, because Art. 958f CO requires it. |
| indefinite | Kept without an end date, for the reason in the notes column. |
| n/a | No personal data to retain. |

## The tables

| Table | Personal data | Purpose | Basis | Retention | Processor | Notes |
|---|---|---|---|---|---|---|
| `profiles` | Name, language, role, terms acceptance | Identify the signed in person and route them to their area | contract | account | Supabase | Anonymised on a fulfilled deletion: `full_name` set to null. |
| `organizations` | Company name and details | The tenant a client belongs to | contract | account | Supabase | A company is not a natural person; the row is listed because it identifies one indirectly through its members. |
| `organization_members` | Membership and role | Who may see a company's data | contract | account | Supabase | Written only through `add_organization_member`, never directly. |
| `expert_assignments` | Expert to organisation link | Grant an expert access to the client they were assigned | contract | account | Supabase | Closed rather than deleted when an expert is deactivated. |
| `expert_profiles` | Name, email, biography, qualifications, photo path | Present an expert to clients and ops | contract | account | Supabase | Anonymised on a fulfilled deletion: email, `photo_path`, `bio`, and the photo object in the `expert-photos` bucket. |
| `expert_ops_notes` | Ops notes about an expert | Internal record of expert management | interest | account | Supabase | Ops only; never visible to the expert. |
| `companies` | Company facts a client entered or research found | The subject of a benchmark | contract | account | Supabase | Company data, personal only through the person who entered it. |
| `company_kpis` | Safety figures, with their source and creator | Compute the benchmark | contract | account | Supabase | Client entered rows carry `created_by`. |
| `research_runs` | The run, its inputs, its result and any error | Produce the company facts a benchmark needs | contract | indefinite | Supabase, Parallel, Anthropic (via the Vercel AI Gateway) | No end date by design: comparing runs over time is how the research stays accurate. Named in the privacy page's third bucket. |
| `benchmark_snapshots` | An immutable computed benchmark | Show a client where they stand, and be able to explain it later | contract | indefinite | Supabase | Immutable by design, so a figure a client was shown can always be reproduced. Named in the privacy page's third bucket. |
| `benchmarks` | Peer values, no person | Peer comparison data | none | n/a | Supabase | Seeded from `supabase/seed-data/`. |
| `benchmark_assumptions` | Model assumptions, no person | Peer comparison data | none | n/a | Supabase | Seeded from `supabase/seed-data/`. |
| `kpi_definitions` | Catalogue, no person | Define what a KPI means | none | n/a | Supabase | Seed data. |
| `questionnaire_versions` | Checklist outline, no person | The versioned content an assessment is rated against | none | n/a | Supabase | Seeded from `src/features/assessments/content/` through `pnpm questionnaires:migration`. |
| `questionnaire_items` | Checklist items and texts, no person | The versioned content an assessment is rated against | none | n/a | Supabase | As `questionnaire_versions`. |
| `orders` | Buyer, amounts, schedule, assigned expert | The purchase and its delivery | contract, legal | ten years | Supabase, Stripe | Deliberately untouched by anonymisation: it belongs to the organisation and Art. 958f CO requires it. |
| `order_events` | What happened to an order and when | Audit of the order lifecycle | contract, legal | ten years | Supabase | As `orders`. |
| `invoices` | Invoice number, amounts, buyer address | The invoice itself | legal | ten years | Supabase | As `orders`. The PDF lives in a private bucket. |
| `packages` | Catalogue and prices, no person | What can be bought | none | n/a | Supabase | — |
| `stripe_events` | Webhook payloads carrying a buyer reference | Idempotent payment confirmation | contract, legal | ten years | Supabase, Stripe | Kept with the accounting record it proves. |
| `email_deliveries` | Recipient address, template, status | Prove an email was sent, and diagnose one that was not | contract | purged 90d | Supabase, Resend | `purge-email-deliveries`, Mondays 03:00 Europe/Zurich. |
| `notifications` | In app messages to one person | Tell a user what happened | contract | account | Supabase | A purged delivery leaves `delivery_id` null. |
| `enquiries` | Name, email, message, hashed IP | Answer a contact form enquiry | contract, interest | purged: hashed IP 30d, closed rows 365d | Supabase | `purge-enquiries`, Mondays 03:00 Europe/Zurich. The IP is stored as a SHA 256 hash, a flood guard only, never the address. |
| `data_requests` | The subject's id, their organization, the kind of request, the ops note | Record that a data subject right was exercised and answered within the Art. 25 window | legal | indefinite | Supabase | Deliberately kept: the row is the evidence that a request was made and answered, so it outlives the profile it is about (`requested_by` is set null, never cascaded). It holds no request text, only the kind and what ops did. |
| `directory_companies` | Company name and location from the purchased contact list | The company a directory contact works at | interest | indefinite | Supabase | Spec 0018. Unreadable to every app role but ops; experts see it only through `directory_search`. Retention is in the lawyer's brief with the licence question; `indefinite` until it is answered. |
| `directory_contacts` | Name, title, email, phones and address of a person on the purchased list | Sold to expert accounts, one credit per revealed row | interest | indefinite | Supabase | Spec 0018. The person never signed up to SME24; the basis is legitimate interest under the supplier's licence, confirmed by the lawyer as the launch gate. Removed within 30 days of an objection through `directory_remove_contact`. |
| `directory_suppressions` | A SHA 256 hash of an objector's email, never the address | Keep a removed person out of every later import | interest | indefinite | Supabase | Spec 0018. Kept by design: the hash is the objection, and dropping it would let the next import bring the person back. |
| `directory_unlocks` | Which expert revealed which contact, and when | The record of what was sold | contract, legal | indefinite | Supabase | Spec 0018. Never `account`: `anonymisePerson` touches `profiles` and `expert_profiles` only and a profile is never deleted, so nothing would implement it. Cascades away when the contact is removed. |
| `directory_credit_entries` | The expert's credit ledger: purchases, unlocks, grants, refunds | The balance and the record of what was paid for | contract, legal | indefinite | Supabase | Spec 0018. Append only, like `order_events`; a purchase row points at its order. |
| `directory_imports` | Counts per outcome and per country of one import run, no person | The audit of every bulk write to the directory | none | indefinite | Supabase | Spec 0018. The four restricted directory tables carry no audit trigger; this row is their audit. |
| `audit_log` | Who changed which row, and when | Make every sensitive write verifiable | legal, interest | indefinite | Supabase | Deliberately kept: an audit log a subject could erase would not be an audit log. It records ids and column names, not the data itself. |
| `scaffold_checks` | Build time check rows, no person | Prove the stack is wired end to end | none | n/a | Supabase | Development artefact. |

## Data outside Postgres

| Where | Personal data | Retention | Notes |
|---|---|---|---|
| `expert-photos` bucket (Supabase Storage, Zurich) | An expert's photograph | account | Private bucket; every read is a ten minute signed URL. Deleted on a fulfilled deletion. |
| `invoices` bucket (Supabase Storage, Zurich) | The rendered invoice PDF | ten years | Private bucket; the accounting record. |
| `auth.users` (Supabase Auth, Zurich) | Email, provider identity, sign in metadata | account | Scrubbed through the admin API on a fulfilled deletion, which also ends the ability to sign in. |
| Sentry (Frankfurt) | Error reports, which may contain a user id | 90 days, Sentry's own retention | No message body, no personal data in breadcrumbs by policy. |
| PostHog (Frankfurt) | Product analytics events: ids and codes, never a name, an email address or free text | PostHog's own retention | Two paths, two bases (spec 0017, `docs/analytics.md`). Nine server side events record SME24's own work on an account (a lookup started, a research run finished, a payment completed) and are captured whether or not the visitor accepted analytics, on `interest`: they need no browser storage and carry opaque ids, so no identifier is set on the device and no profile is built. One browser event, `benchmark.viewed`, needs the `ph_*` cookie and therefore fires on `consent` only, after acceptance. A person who rejects analytics is still counted in the server side funnel and is not identifiable from it. |
| Trigger.dev (EU) | Task payloads, which carry ids rather than personal data | Trigger.dev's own run retention | Tasks take explicit ids and read the rows themselves. |

## International transfers

Two processors are in the United States: Anthropic (reached through the Vercel AI Gateway) and
Parallel. Both receive company research text and prompts, never account data, and both are covered
by the standard contractual clauses. Everything else stays in Switzerland or the EU.

## Review

Review this record whenever a table is added, a processor changes, or a retention period moves,
and at least once a year. The pgTAP test catches a missing table; nothing catches a stale purpose,
which is what the annual read is for.
