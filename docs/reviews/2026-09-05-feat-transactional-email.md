# Review, feat/transactional-email, 2026-09-05

**Reviewed by**: Claude Opus 5 (author on a different model)
**Scope**: 102 files, branch vs main (merge base `6ba5e62`, committed plus uncommitted plus untracked)
**Verdict**: Approve with nits

## Summary

This adds the whole transactional email rail in one slice: two new tables with RLS and hand checked grants, a generic `send-email` task with two transports and an idempotent outbox, the Resend delivery webhook, a Slack alert rail with a typed registry, an ops outbox at `/admin/emails` with live status and retry, a weekly purge schedule and a runbook. The build quality is high. The state machine is written down in the spec and then actually enforced in code, the forward only rank rule is a genuinely correct piece of design, the pgTAP files prove every grant rather than assuming it, and the test suite (527 green, 165 new) covers the branching paths rather than the happy path only. `pnpm typecheck`, `pnpm lint` and `pnpm test` are all clean on my run.

I found no blockers and nothing I would call major. The findings below are edge cases and small consistency gaps: a behaviour change in `ensureOrganization` that can now refuse a sign in it previously let through, a notification row that can be lost on one narrow crash path, a webhook log line that can claim a write that did not land, and two new `@ts-expect-error` suppressions on shared components whose reason (dynamic routes) is not exercised by any test.

## Minor

### 🟡 `already_member` can now fail a sign in that used to succeed, `src/features/auth/session.ts:63`

**Problem**: `ensureOrganization` used to return `{ ok: true }` for `already_member` without reading any claim. It now reads the organization id out of the refreshed claims and returns `{ ok: false, error: "failed" }` when it is absent. The claim is written by the access token hook, so it should be there after `refreshSession()`, but this turns a previously unconditional success into one that depends on the hook having run and on the refreshed token actually carrying `app_metadata.organization_id`.

**Why it matters**: The user affected is one who already has an organization. In `finalizeSignIn` they land on `/app/onboarding` instead of `/app`; in the onboarding action they get the generic error. Both are worse than the old behaviour, and both happen at the moment of sign in, so it is the first thing a returning client would see. The test at `tests/features/auth/session.test.ts:127` locks this in as intended, so it is a deliberate choice, but the failure mode is harsher than it needs to be.

**Suggested fix**: Consider treating a missing organization id on the `already_member` branch as a warning rather than a failure, and returning `{ ok: true, created: false }` with whatever id you have. The `created: false` path sends nothing anyway, so the id is only used by the caller for logging. Alternatively keep the strictness but log loudly enough that you would notice it in Sentry rather than only in the structured log.

### 🟡 The notification row is skipped when a run resumes an existing unprocessed row, `src/trigger/send-email.ts:110`

**Problem**: The notification insert lives inside the "row was just created" branch of `prepareNewDelivery`. If a run inserts the delivery row and then dies before the notification insert, or the notification insert itself throws (line 155 rethrows), the next run with the same key hits `if (existing) return { kind: "row", row: existing }` at line 110 and goes straight to `processDelivery`, which never writes a notification.

**Why it matters**: AC-3 says a delivery to a known user with `notify: true` also creates a notification row, whatever the email outcome. In this narrow window the email is sent but the feed entry that feature 23 will read is silently missing, with nothing pointing at the gap. It is a rare path, but it is exactly the kind of thing that surfaces as "some users never saw the notification" a year from now.

**Suggested fix**: Consider moving the notification write into a small idempotent helper called on both the create and the resume path, guarded by a lookup on `delivery_id` (or a unique index on `(delivery_id)` so a duplicate insert is a no op you can swallow). Alternatively insert the notification before the delivery is marked `sending` in `processDelivery` rather than in `prepareNewDelivery`.

### 🟡 The webhook logs "applied" even when the guarded update touched no row, `src/lib/email/webhook.ts:125`

**Problem**: The status update is guarded with `.eq("status", row.status)`, which is the right optimistic lock. But the result is only checked for `updateError`; the affected row count is not read. When the row's status changed between the `select` and the `update` (the task's own `sent` write, or a second webhook delivery of the same event racing), the update matches nothing and the handler still logs `resend webhook applied` with a `from` and `to` that never happened.

**Why it matters**: When you are debugging why a delivery is stuck at `sent`, the log will tell you the delivered event was applied. That is the one place you would look, and it lies. The row itself is correct (the guard did its job), so this is a diagnostics problem rather than a data problem.

**Suggested fix**: Consider selecting the updated row back (or using `count: "exact"`) and logging `applied` only when a row changed, with a distinct `raced` log line otherwise. That also gives you a signal you could count if races ever become common.

### 🟡 Two new `@ts-expect-error` suppressions on shared navigation components with no test on the case that motivated them, `src/components/locale-switcher.tsx:55` and `src/components/shell/locale-menu-items.tsx:60`

**Problem**: The locale switcher and the shell locale menu now always pass `params` from `useParams()` into the next-intl `Link` and `router.replace`, with a `@ts-expect-error` because TypeScript cannot prove the pathname and params belong together. The change exists so language switching works on the new dynamic route `/admin/emails/[id]`. The only unit test, `tests/shell/locale-switchers.test.tsx`, mocks `useParams` as `{ locale: "de-CH" }` and a static pathname, so it exercises the old case only. No e2e test switches language on a detail page either.

**Why it matters**: These two components appear on every page in the app. A suppressed type error means the compiler will no longer catch a shape mismatch here, and the behaviour that justified the suppression is the one thing nothing checks. If next-intl's href shape changes, or if `useParams` returns something the route map does not expect, the failure shows up as a broken language switch on a live page rather than as a red build.

**Suggested fix**: Consider adding one case to the existing unit test with `pathname: "/de/admin/emails/[id]"` and `useParams: () => ({ locale: "de-CH", id: "..." })`, asserting the resulting href. One assertion covers both components and makes the suppression safe to keep.

### 🟡 The keyset cursor timestamp is interpolated into a PostgREST `or` filter after only a `Date.parse` check, `src/features/emails/queries.ts:57`

**Problem**: `decodeCursor` validates the id against a uuid pattern but validates the timestamp with `Number.isNaN(Date.parse(createdAt))` only. The value is then interpolated into `query.or(...)` as a raw filter string. `Date.parse` is lenient: `"Dec 25, 1995"` parses and carries a comma, which is PostgREST's filter separator.

**Why it matters**: I tried to build an actual injection out of this and could not: the only comma carrying form that survives `Date.parse` is the legacy `Mon DD, YYYY` shape, and appending anything after it breaks the parse. So the practical impact today is a malformed filter and a query error, not a data leak, and the reader is ops who can already see every row anyway. But the pattern is fragile: it depends on a JavaScript date parsing quirk rather than on an explicit contract, and a future change to what goes into the cursor would inherit the weakness.

**Suggested fix**: Consider validating the timestamp against a strict ISO 8601 regexp, or round tripping it (`new Date(createdAt).toISOString() === createdAt`) and rejecting anything that does not match. That makes the string provably free of PostgREST metacharacters instead of accidentally so.

### 🟡 The email footer ships a placeholder postal address, `messages/de-CH.json` (`email.layout.footerAddress`)

**Problem**: The footer renders `SME24 · Musterstrasse 1 · 8000 Zürich` in both catalogs. The spec's follow up list records that the real address is undecided, so this is known, but nothing in the code or the go live checklist stops a real welcome email going out with it.

**Why it matters**: A commercial email to a Swiss or EU recipient carries imprint expectations, and a visibly fake street address in a first contact message reads badly to exactly the regulated companies this product targets. It is also the kind of placeholder that survives launch because nobody owns it.

**Suggested fix**: Consider adding it as an explicit unchecked box in the "Go live" section of `docs/email.md` next to the domain and webhook items, so it cannot be missed on the way to production.

## Nits

- ⚪ `src/trigger/send-email.ts:177`, `loadRetry` accepts a row in `sending`, not only `failed`. The retry action guards on `failed`, so nothing reaches it today, but a direct trigger of `{ kind: "retry" }` on an in flight row would double send. Worth a comment saying why `sending` is allowed, or dropping it.
- ⚪ `src/lib/email/webhook.ts:150`, a fresh `new Resend("re_webhook_verify_only")` is constructed per request purely to reach `webhooks.verify`. It never touches the network, so this is only allocation, but a module level constant would read more honestly given the "module level values are constants" rule.
- ⚪ `src/lib/email/webhook.ts:61`, `email.failed` and `email.suppressed` are real Resend event types that fall into the `default: return null` "unhandled" bucket and answer 200. The endpoint is configured to four types so they never arrive, but a future subscription change would silently drop them. A one line comment naming the subscribed set would make the omission deliberate rather than incidental.
- ⚪ `.env.example:49`, `EMAIL_SMTP_URL` carries a live default (`smtp://127.0.0.1:54325`) while every other variable is blank. Handy locally, but it means a copied example file quietly selects the SMTP transport. Consider commenting it out with the value in the trailing comment.
- ⚪ Six untracked vendor skill folders under `.claude/skills/trigger-*` are in the tree but not in `skills-lock.json`, and two of them (`trigger-authoring-tasks`, `trigger-realtime-and-frontend`) duplicate the already recorded `trigger-tasks` and `trigger-realtime`. Worth either recording or removing before merge so the skill set stays single sourced.
- ⚪ `src/lib/alerts/blocks.ts:56`, `escapeMrkdwn` handles `&`, `<` and `>`, which is what Slack documents, but a company name containing `*` or `_` will still pick up bold or italic in the field values. Cosmetic only.

## Strengths

- The forward only status rank rule is the best idea in the change. Giving `delivered` and `bounced` the same rank so whichever lands first wins, and letting the task's `sent` write be conditional on the row not already being past it, removes a whole class of race without any locking. It is stated in the spec, implemented as a pure function, and tested from both directions (`tests/email/webhook.test.ts:119` and `:126`).
- The pgTAP files are the strongest part of the database work. They prove the grants rather than asserting the policies: `has_table_privilege` checks for truncate and for insert/update/delete, the column grant on `read_at` proved by three separate refused columns, and the `notifications` update on someone else's row proved to touch zero rows rather than merely to be refused. The hand moved `GRANT UPDATE ("read_at")` in the migration is correctly placed after the table level `REVOKE ALL`, with a comment saying why.
- `supabase/tests/contract.test.sql` forces the decision for new tables instead of defaulting it: a table that is on neither the Realtime publication list nor the deliberately excluded list fails the suite. Both new tables were added to the right list with a reason. That is a test that gets better as the schema grows.
- The task's error taxonomy is clean and matches the retry story: `classifyHttpFailure` is a pure function with the 429 and 5xx carve out, SMTP's inverted classes are handled separately and commented, and the permanent path fails the row and alerts inline while the transient path throws so Trigger.dev owns the retry. The `email.failed` alert key carries the attempt number so a retry that fails again alerts again.
- `docs/email.md` is a real runbook, not a restatement of the spec: how a message travels, what to add for a new template or alert kind, the local Mailpit setup, a per environment checklist and a go live order. The "Prove it" section gives ops something to actually do.

## Test coverage

Strong, and the strongest part of the change after the schema. 527 Vitest tests pass, of which about 165 are new, plus the pgTAP files and three Playwright specs.

What is covered well: the send task against fakes for every outcome (Resend success with the idempotency key and tag, 4xx failed with the alert, 5xx throw plus `onFailure`, allowlist skip with the notification still written, `no_transport`, invalid data, second trigger with the same key, retry from the stored address); the webhook for all five documented answers plus the rank rule in both directions; the alert task for an unset webhook, the Block Kit shape, the person resolution, a missing profile and a lookup error; the ops actions for the forbidden path, `not_retryable`, `webhook_unset` and a fresh key per click; the cursor round trip and tamper cases; the purge cutoff, the cron pattern, a null count and a database error; the render in both languages; and both admin pages with axe in both languages. `tests/trigger/send-email.local.test.ts` and `e2e/welcome-email.spec.ts` additionally prove the thin thread against the real stack and Mailpit when it is running.

Gaps I would close: the language switch on a dynamic route (see the `@ts-expect-error` finding above), which is the one behaviour the shared component change exists for and the one nothing exercises; and the resume path in `prepareNewDelivery` where an existing unprocessed row skips its notification. Neither is a blocker.

The signals I ran: `pnpm typecheck` clean, `pnpm lint` clean (258 files, no fixes), `pnpm test` 49 files and 527 tests green. I did not start the Supabase stack, so pgTAP and Playwright were read rather than run.
