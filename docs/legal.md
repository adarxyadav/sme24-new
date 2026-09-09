# Legal, privacy and data requests

_The four public legal pages, the consent cookie, the terms version, and how ops actually work a data subject request. Spec: [0015 Legal, privacy and cookie consent](specs/0015-legal-privacy-cookie-consent/index.md). The record of every table and its purpose is [legal/record-of-processing.md](legal/record-of-processing.md)._

Governing law: the revised Swiss FADP (revidiertes DSG, in force 1 September 2023). The EU GDPR is the standard the consent bar is built to, because SME24 serves EU clients.

> The legal text was written by an engineer, not a lawyer. It is accurate to the system and plausible as law, and it still needs a Swiss data protection lawyer's pass before the first paying client. That review is feature 26's launch gate, not a build task, so the risk sits with the company until it is done.

## The four pages

`/privacy`, `/terms`, `/imprint` and `/cookies`, in German and English with their German slugs, all statically prerendered and indexable. Nothing on those paths reads `searchParams`, `headers()` or `cookies()`, and the two interactive pieces on `/cookies` — the consent control and the data rights card — are client components that ask for their own state after mount, which is what keeps the page static (AC-5).

Every value on the privacy page comes from a constant, never from prose: `PROCESSORS` and `RETENTION` in `src/features/legal/processors.ts`, the company facts from `SITE` in `src/features/marketing/site.ts`, the dates from `dates.ts`. A stack change is a one line edit and a failing test, not a page nobody remembered to update.

## The consent cookie

`sme24_consent`, first party, `SameSite=Lax`, not `HttpOnly` (the bar reads it after mount), `Secure` in production only, path `/`, one year. Values are `granted:<version>` or `denied:<version>`; a version segment that is not the current `CONSENT_VERSION` counts as no answer, so the bar reopens. `setConsent` and `clearConsent` in `src/features/legal/actions.ts` are the only write paths — nothing in the browser ever assigns `document.cookie`.

No PostHog request is made while the cookie is absent, denied, or stamped with an old version. The gate is one function and nothing else may call `posthog.init`.

## The terms version

`CURRENT_TERMS_VERSION` in `src/features/legal/terms.ts` ships at `'1'`, matching the column default, so nobody became stale on the day this deployed.

**Bumping it blocks every signed in user behind a dialog they cannot dismiss until they accept**, so bump it only for a change that genuinely alters the deal. In the same commit: add the `legal.terms.changelog.<version>` key to both catalogues (a Vitest test fails until you do), append the version to `TERMS_VERSIONS`, and move `TERMS_UPDATED` in `dates.ts`.

The comparison is equality, never ordering. The column is `text`, so `'10' < '2'` is true and any "older than" reading would let a stale profile through. `accept_terms(version)` is the only write path; the column sits outside the authenticated column grant.

## Data requests

### How one travels

1. **A person files it.** The card on `/cookies`, signed in, any role. `requestData` inserts the row with `requested_by` from the claims (never a form field) and `due_at` thirty days out. At most one open request per person per kind — the partial unique index is the guard, never an application read, because two rapid submissions both pass a read-then-write. A second one comes back as the typed `already_open` and reads as an ordinary sentence.
2. **Ops are told.** The `data_request.received` alert reaches the ops Slack channel with the right, the subject's email and the answer deadline. It fires only once the row is stored and never fails the caller: a request filed but not announced is a gap ops close from the queue, where an announcement of a row that was never written is the failure nobody can undo.
3. **Ops work it.** `/admin/data-requests`, ordered by deadline rather than by filing date, defaulting to the open queue. An open row past its deadline carries the overdue badge.
4. **Ops answer it.** `new → in_progress → fulfilled`, with `refused` as the exit from either. `fulfilled` and `refused` are terminal; someone who wants more files a new request, which keeps each row a truthful record of one ask and one response. The adjacency list is `DATA_REQUEST_TRANSITIONS` in `src/features/legal/schema.ts` — that constant is the source of truth, because there is no database trigger for this workflow.

### Assembling an export

The app's job is the queue and the record, not generating or delivering the payload. Nothing here rides the `sendEmail` rail.

Assemble by hand from the tables in the [record of processing](legal/record-of-processing.md) that name the person: `profiles`, `organization_members`, `expert_profiles` if they are an expert, `enquiries` matching their address, `orders`/`invoices` for their organization, `notifications` and `email_deliveries` addressed to them, and the `audit_log` rows where they are the actor. Send it outside the app, to the address on their account, and **record what was sent and how in `ops_note`** before marking the request fulfilled. That note is the only evidence the answer happened.

### Fulfilling a deletion

Marking a deletion request fulfilled runs `anonymisePerson` inside `updateDataRequest`, in one action, never as a manual side channel — the audit log is what proves what happened.

It touches exactly these, and nothing else:

| Where | What is cleared |
| --- | --- |
| `profiles` | `full_name` set to null. The row survives, so no foreign key breaks. |
| `auth.users` | email replaced with `deleted+<id>@invalid.sme24.ch`, `user_metadata` emptied, sign in banned permanently. |
| `expert_profiles` (experts only) | `email`, `photo_path` and `bio`, plus the photo object in the private bucket. |

**Deliberately untouched:** `orders`, `invoices`, `order_events` and `stripe_events`. They belong to the organisation rather than to the person, and Art. 958f CO requires them for ten years. The privacy page states this exception in plain words, so nobody is told their deletion was total when it was not.

The anonymisation runs **before** the row records the fulfilment. A failure then leaves the request open and honest; recording first would leave a row claiming a deletion that did not happen. Every step is idempotent, so a partial run is finished by pressing the button again.

`app_metadata` is deliberately left alone: it carries Supabase's own `provider` keys, and the access token hook rewrites `role` and `organization_id` from the profile on every token anyway.

### Refusing one

A refusal requires a non empty `ops_note`. The rule is in the action, not a constraint, because it is about the move rather than about the row. Write what was refused and why — that sentence is what a supervisory authority would read.

### Process notes

- **Ops do not fulfil their own requests.** An ops user can file a request like anyone else, and the app does not stop them working it, because a code guard is not worth building at pilot scale. Hand it to a colleague.
- **The row outlives the person.** `requested_by` is set null when the profile goes, never cascaded: a cascade would delete the evidence that a deletion was performed, which is the opposite of what a record is for. There is no purge task for `data_requests` and no retention period.
- **Nobody reads another person's request.** The select policy is `auth.uid() = requested_by` plus the ops bypass. A colleague in the same organization reads zero rows — the request belongs to the person, not the tenant. Proved by `supabase/tests/data_requests.test.sql`.
- **`UPDATE` is revoked from every app role**, ops included. `updateDataRequest` authorises the caller itself and writes through the service client, because the proxy never runs for a server action post.

## Local development

- `supabase start` applies the migrations; the four role test accounts come from `seed.sql`.
- File a request as any seeded user from `/cookies`, then work it as `ops@example.com` at `/admin/data-requests`.
- Without `TRIGGER_SECRET_KEY` the alert logs `trigger_unavailable` and the action still succeeds, which is the intended shape.
- Tests: `supabase/tests/data_requests.test.sql` and `record_of_processing.test.sql` (pgTAP), the record of processing chain test in Vitest, and `pnpm build && pnpm budget` as the gate that `/cookies` is still prerendered and under its first load budget.

## Per environment checklist

- [ ] The four legal pages read correctly in both languages, and the imprint facts match the register entry.
- [ ] A fresh browser makes zero requests to the PostHog host before the bar is answered.
- [ ] The `data_request.received` alert lands in the ops Slack channel, with the deadline legible.
- [ ] One real export request filed, worked and fulfilled, with the note recorded.
- [ ] One real deletion request fulfilled on a throwaway account: the name is gone, the address is scrubbed, sign in is refused, and the order and invoice rows are still readable.
- [ ] A Swiss data protection lawyer has reviewed the privacy policy, the terms and the DPA. **Launch gate, feature 26.**
