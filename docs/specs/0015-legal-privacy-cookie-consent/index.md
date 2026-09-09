# 0015. Legal, privacy and cookie consent

**Date**: 2026-09-09
**Status**: In Progress

## Summary

SME24 gets the four legal pages a Swiss commercial site needs (privacy, terms, imprint, cookies)
in both languages, a cookie bar that keeps PostHog unloaded until someone says yes, a terms
version so a change can be re accepted, and an in app way to ask for your data or its deletion
that ops work like they already work enquiries. The consent gate is the piece feature 15 is
waiting on: analytics cannot ship until something can say no to it. Nothing here stores a new
row about a visitor, because the consent choice lives in a cookie, and a deletion request
anonymises the person while keeping the invoices Swiss commercial law says you must keep for ten
years.

## Requirements

**User stories**:

- As a visitor, I want to refuse analytics in one click, so that reading the site does not mean
  being measured.
- As a visitor, I want to find the privacy policy, the terms and the imprint, so that I know who
  I am dealing with and what happens to my data.
- As a signed in user, I want to ask for a copy of my data or its deletion without writing an
  email, so that exercising the right is not a favour I have to ask for.
- As a signed in user, I want to see what changed when the terms change, so that my acceptance
  means something.
- As ops, I want data requests in a list with a deadline, so that the thirty day legal answer
  window is never missed by accident.

**Acceptance criteria**:

- **AC-1**: No analytics script loads and no PostHog cookie is written before the visitor accepts.
  A fresh browser that never answers the bar produces zero requests to the PostHog host.
- **AC-2**: The cookie bar offers accept and reject as two controls of equal size, weight and
  prominence, side by side, on the first layer, with no pre ticked state. Each of those four
  properties is checked on its own, because "no dark pattern" as a phrase is not machine checkable.
- **AC-3**: The choice survives a reload and a new page: after accepting or rejecting once, the
  bar does not reappear, and the analytics gate reads the same answer on every later page. A cookie
  whose version segment is not the current `CONSENT_VERSION` counts as no answer, so the bar opens
  again.
- **AC-4**: Withdrawing consent stops collection: the choice flips to denied, the PostHog cookies
  and storage keys are cleared, and no further events are sent without a new acceptance.
- **AC-5**: Every marketing page stays statically prerendered. Adding the bar changes no page from
  static to dynamic, and `pnpm budget` still passes on every page. The bar's own default DOM state
  is hidden, so a visitor who already answered never sees it flash before the mount check runs.
- **AC-5b**: The bar and the analytics gate live in the root layout, so they apply in the signed in
  areas as well as on the marketing site. PostHog can load anywhere, so consent governs everywhere.
- **AC-6**: The four legal pages (`/privacy`, `/terms`, `/imprint`, `/cookies`) render in German
  and English with their German slugs, carry `marketingMetadata` and an opengraph image, appear
  in the sitemap with correct alternates, and are indexable.
- **AC-7**: The privacy page names every processor SME24 uses, with its purpose and where it
  stores data, from one typed constant rather than prose, so a stack change is a one line edit.
- **AC-8**: The privacy page states a retention period for every table holding personal data, and
  every period falls in one of three honest buckets: enforced by a purge task, kept for the life of
  the account, or kept indefinitely for audit and service quality with the reason named. The third
  bucket exists because `benchmark_snapshots` and `research_runs` genuinely have no end date, and
  describing them as either of the first two would be false.
- **AC-8b**: The `/cookies` page carries a consent control that re opens the choice whatever the
  current cookie says, so someone who rejected can later accept without clearing their browser.
- **AC-9**: The footer's legal group renders the four pages, and the sign up consent checkbox and
  the enquiry form's privacy note link to the real pages as typed routes that open in a new tab.
- **AC-10**: A user whose accepted terms version is not the current one cannot use any signed in
  page until they accept: the shell shows a dialog they cannot dismiss, and accepting writes the
  new version through the one allowed write path. The comparison is equality, never ordering,
  because the column is `text` and a numeric looking `<` would read `'10'` as older than `'2'`.
- **AC-11**: A signed in user of any role can file an export or a deletion request for themselves,
  sees its kind, status and due date, and cannot file a second one of the same kind while one is
  open. An export is fulfilled by ops by hand: they assemble the data, send it outside the app, and
  record what was sent in `ops_note`. The app's job is the queue and the record, not generating or
  delivering the payload, so nothing here rides the `sendEmail` rail.
- **AC-12**: A data request is visible only to the person who filed it and to ops. No user can
  read another user's request, proven by a pgTAP policy test.
- **AC-13**: Filing a request sends the `data_request.received` alert to the ops Slack channel and
  the row appears on `/admin/data-requests` with a due date thirty days out.
- **AC-14**: Ops can move a request to fulfilled or refused with a note; the first move out of
  `new` records who did it and when, and that write is audited. A refusal requires a non empty
  `ops_note`, so no request is ever refused without a reason on the record.
- **AC-15**: Fulfilling a deletion request anonymises the person in one transaction inside
  `updateDataRequest`, never as a manual side channel, so the audit log proves what happened.
  Anonymisation touches exactly three places and nothing else: `profiles.full_name` set to null;
  `auth.users` email and metadata scrubbed through the Supabase admin API, which also ends the
  ability to sign in; and for an expert, `expert_profiles.email`, `photo_path`, `bio` and the photo
  object itself. Every accounting row (`orders`, `invoices`, `order_events`) is deliberately
  untouched, because it belongs to the organisation rather than the person and Art. 958f OR
  requires it for ten years. The profile row itself survives so no foreign key breaks. The privacy
  page states this exception in plain words. The scrub runs only for the caller that won the
  guarded status write: that write is the claim and comes first, because the scrub cannot be
  undone and a caller that lost the race would otherwise ban and scrub a person whose row it never
  moved. If the scrub then throws, the claim is released back to the status the caller read, so no
  row is ever left claiming a deletion that did not happen and the request stays workable. The
  audit trigger records the claim and the release both, so the trail shows the attempt and its
  reversal (amended 2026-09-09 by `/debug`, after a Major in the fresh model review).
- **AC-16**: The record of processing exists as a document in the repo listing every table, its
  purpose, its legal basis, its retention and its processor, and a pgTAP test in `supabase/tests/`
  keeps its table list equal to the tables that actually exist. It is pgTAP rather than Vitest
  because the check reads `information_schema` and so needs the live stack, unlike the catalogue
  equality tests that compare two in repo constants.

## Decision

**Chosen option**: Option 2: A first party consent cookie with hand written legal pages and an ops
worked request queue.

Build consent as a cookie the app owns and reads, write the legal text as translated message keys
in the catalogues, and model data requests on the `enquiries` table that already works, rather
than buying a consent management platform or storing a consent record per visitor.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`,
`.claude/skills/supabase-postgres-best-practices/`) · `shadcn` (`shadcn/ui`,
`.claude/skills/shadcn/`) · `frontend-design` (`anthropics/skills`,
`.claude/skills/frontend-design/`) · `next-intl-app-router` (`liuchiawei/agent-skills`,
`.claude/skills/next-intl-app-router/`) · `posthog-instrumentation`
(`posthog/posthog-for-claude`, `.claude/skills/posthog-instrumentation/`) · `playwright-skill`
(`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

## Feature design

**Data model sketch**:

One new table and one new column. The consent choice is deliberately not a row.

`public.data_requests` (kind I, infrastructure, no tenant owner, the `enquiries` contract):

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | primary key, `gen_random_uuid()` |
| `kind` | text | no | check in (`export`, `deletion`) |
| `requested_by` | uuid | yes | references `profiles (id)` on delete set null; the subject |
| `organization_id` | uuid | yes | references `organizations (id)` on delete set null; ops view only |
| `status` | text | no | default `new`, check in (`new`, `in_progress`, `fulfilled`, `refused`) |
| `due_at` | timestamptz | no | `created_at + 30 days`, the Art. 25 answer deadline |
| `handled_by` | uuid | yes | references `profiles (id)` on delete set null; written once |
| `handled_at` | timestamptz | yes | set with `handled_by` the first time status leaves `new` |
| `ops_note` | text | yes | check length under 2000; what was done, or why refused |
| `created_at` | timestamptz | no | default `now()` |
| `updated_at` | timestamptz | no | default `now()`, touched by the shared trigger |

`requested_by` is nullable and set null on delete on purpose: the row is the compliance artefact
proving a request was made and answered, so it must outlive the profile it is about, exactly as
`enquiries.submitted_by` does. A cascade would delete the evidence that a deletion was performed,
which is the opposite of what a record is for.

Indexes: `data_requests_status_due_at_idx on (status, due_at)` for the ops queue ordered by
deadline; `data_requests_requested_by_idx on (requested_by, created_at desc)` for the user's own
list; and the guard `data_requests_open_idx unique on (requested_by, kind) where status in
('new', 'in_progress')`, so a double click cannot queue two.

Two routes join `PATHNAMES`, identical in both languages like every other admin route:
`"/admin/data-requests"` and `"/admin/data-requests/[id]"`.

`public.profiles` gains `terms_version text not null default '1'` beside `terms_accepted_at`, with
the same protection: it stays outside the column grant, so only `handle_new_user` and
`accept_terms()` write it. `accept_terms()` changes from writing once to writing the current
version, and its `where terms_accepted_at is null` guard is replaced by a version comparison.

`CURRENT_TERMS_VERSION` ships as `'1'`, matching the column default. Version 1 is the acceptance
that already happened, now given a number for the first time, so nobody becomes stale on the day
this deploys. The first real re consent happens on the next substantive terms change, when the
constant goes to `'2'`. Shipping at `'2'` would block every existing user on deploy, which is the
one way this feature could cause an outage.

The consent choice is the cookie `sme24_consent`, first party, `SameSite=Lax`, `HttpOnly` false so
the bar can read it after mount, `Secure` when `NODE_ENV === "production"` (the check `src/lib/env.ts`
already uses) and omitted locally so `pnpm dev` over plain HTTP works, path `/`, one year. Values
are `granted:<version>` or `denied:<version>`. The gate treats an answer as current only when the
version segment equals `CONSENT_VERSION`; any mismatch, granted or denied, reopens the bar, which
is the entire reason the version is in the value. The existing `ANALYTICS_CONSENT_COOKIE` in
`src/lib/analytics/client.tsx` is replaced by it.

**State transitions**:

A data request: `new` → `in_progress` → `fulfilled`, with `new` → `refused` and `in_progress` →
`refused` as the exits. `fulfilled` and `refused` are terminal; a person who wants more files a
new request. Ops move it by hand, so the transitions live in the action rather than a database
trigger, which is the difference from orders in spec 0014 where money made a trigger worth it.

Because there is no trigger, the adjacency list is the source of truth and must be a literal
constant in `src/features/legal/schema.ts`, not prose a builder re reads:

```
new         → in_progress, refused
in_progress → fulfilled, refused
fulfilled   → (terminal)
refused     → (terminal)
```

No other move is legal. Reopening a terminal request is deliberately impossible; the answer is a
new request, which keeps each row a truthful record of one ask and one response.

The terms: a profile is either current (its `terms_version` equals `CURRENT_TERMS_VERSION`) or
stale. Stale is the only state the shell blocks on, and `accept_terms()` is the only way out.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `setConsent` (action) | POST | `choice: 'granted' \| 'denied'` | `{ ok: true }` | public | 422 invalid choice |
| `requestData` (action) | POST | `kind: 'export' \| 'deletion'` | `{ ok, data: { id } }` | authenticated | `already_open`, 422 |
| `listMyRequests` (query) | read | none | rows for the caller | authenticated | throws |
| `listDataRequests` (query) | read | `status?` (default: the open queue, `new` and `in_progress`), page (default 25) | rows plus counts | ops | throws |
| `updateDataRequest` (action) | POST | `id`, `status`, `note?` (required when refusing) | `{ ok: true }` | ops | `invalid_transition`, 404 |
| `acceptTerms` (action) | POST | none | `{ ok, data: { version } }` | authenticated | throws on rpc failure |

`setConsent` is a server action rather than a route so the cookie is written with the app's own
`cookies()` on a POST, never from client script, which keeps the value out of reach of a third
party script and lets the bar work without JavaScript enabled for the reject path.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `setConsent` | the consent version stamped in the cookie | `CONSENT_VERSION` constant in `src/features/legal/consent.ts` |
| `setConsent` | cookie expiry | one year from the server clock at write time |
| analytics gate | whether to load PostHog | the `sme24_consent` cookie read in the client bar after mount |
| the bar | whether to render at all | absence of the cookie; read client side so pages stay static (AC-5) |
| `requestData` | `due_at` | `created_at + interval '30 days'` in UTC, matching `purge-enquiries`' own arithmetic; only the overdue comparison converts to Zurich |
| `requestData` | `organization_id` | the caller's `profiles.organization_id` at filing time, null when they have none (an expert usually does), which is expected and never guarded against |
| ops list | "overdue" | `due_at <= now()` compared in `Europe/Zurich` via `TIME_ZONE` |
| the user's card | kind, status, due date | the `data_requests` row the caller can already read under RLS |
| `updateDataRequest` | which columns anonymisation clears | the fixed list in AC-15, executed in one transaction, never a per case ops judgement |
| `updateDataRequest` | whether this caller may anonymise at all | winning the guarded status write, which runs first and is the claim; a caller whose write matched zero rows never reaches the scrub |
| `data_request.received` alert | kind, the requester's email, the due date, a link to `/admin/data-requests/[id]` | the inserted row plus `auth.users` email, assembled by the presenter |
| the re consent dialog | what changed in this version | `terms.changelog.${CURRENT_TERMS_VERSION}` in both catalogues, with a Vitest test asserting every version from `'1'` up has a key |
| privacy page | the processor list | `PROCESSORS` constant in `src/features/legal/processors.ts` |
| privacy page | each retention period | `RETENTION` constant, whose values come from the purge tasks' exported day counts |
| imprint page | the company facts | `SITE` in `src/features/marketing/site.ts` |
| terms gate | the current terms version | `CURRENT_TERMS_VERSION` constant, the single source both the trigger and the dialog read |
| re consent dialog | what changed | a `terms.changelog.<version>` message key, written when the version is bumped |
| `updateDataRequest` | `handled_by` | the authorised ops caller's id, never a form field |

**Key invariants**:

- No PostHog request is made while the consent cookie is absent, `denied`, or stamped with a
  version other than the current one. The gate is one function; nothing else may call
  `posthog.init`.
- The bar renders hidden by default and becomes visible only after the mount check finds no current
  answer. A visible default would flash on every load for visitors who already chose, and jsdom
  would not catch it, which is the same shape of bug as the ICU grouping hydration failure.
- A terms version is compared with equality only. The column is `text`, so `<` would order `'10'`
  before `'2'`.
- At most one open (`new` or `in_progress`) request per person per kind, enforced by the partial
  unique index, not by the app.
- `handled_by` and `handled_at` are both null or both set, and once set are never cleared.
- `terms_version` and `terms_accepted_at` move together: a profile never carries a version it did
  not accept, because only `accept_terms()` writes both.
- A fulfilled deletion never removes a row an invoice references. Anonymisation nulls the person's
  identifying columns and scrubs the auth user; the accounting rows keep the organisation. Scrubbing
  `auth.users` is not optional: leaving it means the "deleted" person is still findable by email and
  can still sign in, which would make the fulfilment a lie.
- Every value on the privacy page comes from a constant, so the page cannot drift from the code
  without a test failing.

**Security model**:

Compliance scope: the Swiss revised FADP (revidiertes DSG, in force since 1 September 2023) as
the governing law, and the EU GDPR as the standard applied to the consent bar because SME24
serves EU clients. Both are named explicitly because this feature is the project's compliance
surface.

RLS on `data_requests`: a user inserts a row only with `requested_by = auth.uid()` and reads only
their own rows; ops read every row. `UPDATE` is revoked from every app role, so
`updateDataRequest` authorises the ops caller itself and writes through the service client
`requireOps` mints, the same shape spec 0014 uses, because the proxy never runs for a server
action post. Inserts, and updates of `status` and `ops_note`, are audited through the existing
`audit_log`; this is not negotiable in a compliance feature.

The consent cookie carries no identifier and is not personal data. It is first party and readable
by the app only.

**Configuration required**:

None. No new environment variable, no new credential, no new third party account. The Slack
webhook, PostHog keys and Supabase keys the feature touches are all already configured.

**Critical test scenarios**:

- Happy path: a fresh browser loads the home page, sees the bar, presses accept, and PostHog then
  loads exactly once; a reload shows no bar, verifies **AC-1**, **AC-3**.
- Failure case: a visitor presses reject, then withdraws is not needed, but an accepting visitor
  later withdraws and the PostHog cookies are gone and no further request fires, verifies
  **AC-4**.
- Failure case: two rapid submissions of the same request kind produce one row and a typed
  `already_open` result, not a database error shown to the user, verifies **AC-11**.
- Static guarantee: the build output still marks all eleven marketing pages prerendered and
  `pnpm budget` passes, verifies **AC-5**.
- Auth/permission: a client reading another client's data request through PostgREST gets zero
  rows, and a client calling `updateDataRequest` gets a typed refusal, verifies **AC-12**.
- Terms gate: a profile pinned to version `1` while the constant says `2` cannot reach any signed
  in page until it accepts, and a profile at `10` against a constant of `2` is treated as current
  rather than stale, which is the comparison a `text` column gets wrong, verifies **AC-10**.
- Deletion: fulfilling a deletion request clears the three column groups, leaves the order and
  invoice rows intact and readable, and the person can no longer sign in, verifies **AC-15**.
- Consent versioning: a cookie stamped with an old `CONSENT_VERSION` reopens the bar rather than
  counting as an answer, verifies **AC-3**.

## Build plan

Ordered as a Tracer Bullet: the consent thread runs end to end through cookie, action, gate and UI
first, because it is thin and it unblocks feature 15. The migration is deliberately not task one;
it lands with the milestone that needs it.

**Milestone 1: the consent gate, end to end**

1. Add `src/features/legal/consent.ts`: `CONSENT_VERSION`, the cookie name, the pure read and
   parse functions, satisfies **AC-3**.
2. Add the `setConsent` server action writing the cookie through `cookies()`, satisfies **AC-3**.
3. Build the cookie bar as a client component in the root layout, hidden by default and shown only
   when the mount check finds no current answer: accept and reject side by side, equal weight, a
   link to the cookie page, satisfies **AC-1**, **AC-2**, **AC-5**, **AC-5b**.
4. Rewrite the analytics gate in `src/lib/analytics/client.tsx` to read the new cookie and honour
   the version segment, and add the withdrawal path that clears the PostHog cookies and reloads,
   satisfies **AC-1**, **AC-3**, **AC-4**.
5. Playwright: a fresh context asserts zero PostHog requests before a choice, the reject and
   withdraw paths, the four measurable properties of AC-2, and no flash of the bar on a second load,
   satisfies **AC-1**, **AC-2**, **AC-4**, **AC-5**.

**Milestone 2: the four legal pages**

6. Add `PROCESSORS` and `RETENTION` typed constants, plus the test tying `RETENTION` to the purge
   tasks' exported constants, satisfies **AC-7**, **AC-8**.
7. Add the four routes to `PATHNAMES` and `MARKETING_ROUTES` with German slugs, each with
   `marketingMetadata` and an `opengraph-image.tsx`, satisfies **AC-6**.
8. Write the German and English legal copy as `legal.*` message keys, privacy built from the
   constants, imprint built from `SITE`, the deletion exception stated plainly, satisfies **AC-6**,
   **AC-7**, **AC-15**.
8b. Put the consent control on the `/cookies` page so a past choice can be changed, satisfies
   **AC-8b**.
9. Fill the footer's legal group and point the sign up checkbox and the enquiry privacy note at
   the real routes as typed links opening in a new tab, satisfies **AC-9**.
10. Write `docs/legal/record-of-processing.md` and the test keeping its table list equal to the
    schema's, satisfies **AC-16**.

**Milestone 3: the terms version and re consent**

11. Migration: `profiles.terms_version`, the `handle_new_user` and `accept_terms()` changes, the
    column grant left untouched, plus pgTAP proving the column is not writable directly, satisfies
    **AC-10**.
12. Add `CURRENT_TERMS_VERSION` at `'1'` and the blocking dialog in the signed in shell, comparing
    by equality, reading `terms.changelog.${CURRENT_TERMS_VERSION}`, with the Vitest test that every
    version from `'1'` up has a changelog key in both catalogues, satisfies **AC-10**.

**Milestone 4: data requests and the ops surface**

13. Migration: `data_requests` with its checks, indexes, RLS policies, the revoked `UPDATE`, the
    audit triggers and the `updated_at` trigger, plus its pgTAP file, satisfies **AC-11**,
    **AC-12**, **AC-14**.
14. Add `src/features/legal/` actions and queries: `requestData`, `listMyRequests`,
    `listDataRequests`, `updateDataRequest`, plus the `DATA_REQUEST_TRANSITIONS` literal and the
    refusal note rule, each parsing with `schema.ts` and returning a typed result, satisfies
    **AC-11**, **AC-14**.
15. Add the anonymisation routine invoked inside `updateDataRequest` when a deletion reaches
    `fulfilled`: the three column groups of AC-15 in one transaction, including the `auth.users`
    scrub through the admin API, satisfies **AC-15**.
16. Add the `data_request.received` alert kind and presenter carrying kind, requester email, due
    date and the detail link, fired without ever losing the row, satisfies **AC-13**.
17. Add the two `PATHNAMES` entries and build the client card (kind, status, due date) and the
    `/admin/data-requests` list and detail pages, satisfies **AC-11**, **AC-13**.
18. Write the runbook in `docs/legal.md`: the anonymisation columns, what survives for the ten year
    period, how ops assemble and send an export, and the process note that ops do not fulfil their
    own requests, satisfies **AC-11**, **AC-15**.

## Consequences

**Positive**:

- Feature 15 is unblocked: analytics has something that can say no to it, which is the only reason
  the consent cookie constant was stubbed in spec 0001.
- The four pages close three loose ends left by earlier specs: the sign up consent links (0005),
  the footer legal group and the enquiry privacy link (0009).
- Retention stops being implicit. Writing the periods down forces the gaps into view, and the
  record of processing keeps the list honest as tables are added.
- No new dependency, no new environment variable, no new vendor. The consent bar is roughly two
  hundred lines against a consent platform's script tag and monthly fee.

**Negative / tradeoffs**:

- The legal text is written by an engineer, not a lawyer. It will be accurate to the system and
  plausible as law, and it still needs a Swiss lawyer's pass before the first paying client. That
  review is a follow up, not a build task, so the risk sits with you until it is done.
- Every stack change now has a documentation cost: a new processor means editing `PROCESSORS`, and
  a new table means editing the record of processing. The tests make it a failing build rather
  than a silent omission, which is the point, but it is friction.
- A cookie only consent record means you cannot prove after the fact that a particular person
  consented. For one analytics purpose that is a proportionate trade; it would not be for
  advertising or profiling.
- Rejecting analytics means genuinely less data. Expect PostHog numbers to undercount, and do not
  reconcile them against server side counts, which are unaffected because they never touch the
  browser.
- The blocking terms dialog is an interruption on a version bump. Bump the version rarely and only
  for changes that genuinely alter the deal.

**Neutral**:

- `ANALYTICS_CONSENT_COOKIE` is replaced, so anyone who consented under the old name is asked
  once more. Nobody has, since the banner never existed.
- Two migrations rather than one, because the terms column and the requests table land in
  different milestones. Both are additive and backward compatible, as previews share staging.
- The record of processing is very likely not legally required of SME24 (the Art. 12 exemption
  covers companies under 250 employees with low risk processing). It is written anyway, because it
  is the artefact that keeps the privacy page true, and because the exemption stops applying the
  moment the company grows or starts profiling.

## Follow-up

- [ ] Have a Swiss data protection lawyer review the privacy policy, terms and DPA before the
      first paying client. This is a launch gate item, not a build task; feature 26 is where it
      lands.
- [ ] Write the DPA template as a document ops send on request, not a public page. It is a
      contract to be signed, so it belongs beside the record of processing rather than in the
      route table.
- [ ] `benchmark_snapshots` and `research_runs` have no purge task and no natural end date. AC-8
      now describes them honestly as kept indefinitely for audit and service quality rather than
      pretending a period exists. If a real period is ever agreed, it is a small scheduled task on
      the `purge-enquiries` pattern.
- [ ] Decide whether the Art. 25 access export should ever be generated automatically. Ops
      fulfilling by hand is right at pilot volume and wrong at a hundred requests a year.
- [ ] Confirm no Swiss representative is needed. The research could not settle from a primary
      source whether domicile is read as legal seat only; SME24 is Swiss domiciled so this looks
      moot, and it is worth one question to the lawyer already reviewing the text.
- [ ] Widen the deletion scrub to `auth.identities`, or record why not. `identity_data` keeps a
      copy of the person's email after a fulfilled deletion, and for a Google or Microsoft sign in it
      also keeps `full_name` and `avatar_url`. AC-15 names exactly three places and this is not one
      of them, so `/debug` left it alone on 2026-09-09 rather than widening the scope by hand: it is
      the one remaining copy of the identifying data in `auth`, and it wants a spec decision.
      Found while fixing the AC-15 metadata defect; see verify.md.
- [ ] Three cross check findings were considered and deliberately not acted on, recorded so they
      are not raised again as new. The audit trigger's column list does not need `handled_by` and
      `handled_at` added, because the invariant already forces all three columns to move in one
      statement. Passing `target="_blank"` through next-intl's `Link` is a build detail for
      milestone 9, not a spec decision. Ops filing and fulfilling their own request is a process
      matter for the runbook in milestone 18, not a code guard worth building at pilot scale.

## Rationale

Reasoning, the options weighed and the sources: see [rationale.md](rationale.md).
