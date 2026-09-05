# 0006. Transactional email and ops alerts

**Date**: 2026-09-05
**Status**: Accepted

## Summary

Every product email SME24 sends goes through one rail: a Trigger.dev task (a background job with retries) renders a React Email template in the recipient's language and hands it to Resend (the email service chosen in spec 0001), or to the local Mailpit inbox during development. Each send leaves a row in an outbox table that ops can read on `/admin/emails`, with the real delivery outcome fed back by Resend's webhook and a retry button for failures. A second, smaller rail posts alerts to your team's Slack channel through an incoming webhook. The first real messages are the welcome email and the "new client signed up" alert, both fired when a client's first confirmed sign in creates the organization; later features add a template or an alert kind, never a new task.

## Requirements

**User stories**:
- As a new client, I want a welcome email in my language right after my company is set up so that I know the account is real and what to do next.
- As an ops team member, I want a Slack message when a client signs up so that I can reach out the same day.
- As an ops team member, I want to see every email SME24 sent, whether it arrived, and retry a failed one so that a lost message never stays invisible.
- As an ops team member, I want to send myself a test email and a test alert so that I can prove a hosted environment is configured without a throwaway sign up.
- As the engineer, I want later features (benchmark ready, receipt, expert assigned, gap report ready, retainer enquiry, run failed) to add one template file or one alert kind and reuse everything else.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: When `ensureOrganization` creates a client's organization (the first confirmed sign in, or the onboarding form), a `welcome` email reaches the user's address within a minute, in the user's stored language, greets them by first name, names the organization, explains the next step (the company lookup) and carries one button to `/<locale>/app`. It is sent from `EMAIL_FROM` with `EMAIL_REPLY_TO` as the reply address. `ensureOrganization` returns `{ ok: true, organizationId, created }` (the uuid `create_organization` gives back; `created` is false on `already_member`) and both sends fire inside it only when `created` is true, so both callers (`finalizeSignIn` and the onboarding action) are covered and an `already_member` result sends nothing. Exactly one welcome email exists per organization even when the trigger fires twice: the idempotency key `welcome/<organizationId>` is created with `idempotencyKeys.create(key, { scope: 'global' })` and a 30 day TTL.
- **AC-2**: The same event posts a `client.signed_up` alert to the Slack channel within a minute, showing the organization name, the person's full name, their language and the time in `Europe/Zurich`, with a button to `/en/admin` (the app default language, amended 2026-09-05). Its idempotency key is `signup/<organizationId>` (global scope), and the task resolves the name and language from the user id. The email address never appears in Slack. When `OPS_ALERT_WEBHOOK_URL` is unset the task logs the alert as skipped and does not fail.
- **AC-3**: Every send creates one `email_deliveries` row before anything is rendered, holding `source_event`, `template`, `locale`, `recipient_email`, `recipient_id`, `organization_id`, `subject`, `data`, `status`, `transport`, `attempts` and `last_run_id`, and later `provider_message_id`, `error`, `sent_at`, `delivered_at`, `failed_at`. A delivery to a known user whose registry entry has `notify: true` (the default; `false` for every `ops.*` source event) also creates one `notifications` row (`kind` = template, `data`, `link` as the bare app path without a locale prefix, `delivery_id`) at the same time, whatever the email outcome. A raw address delivery creates no notification. `attempts` counts task attempts across all runs and is incremented at the start of every attempt.
- **AC-4**: The `send-email` task is a `schemaTask` over a discriminated union: `{ kind: 'new', template, data, recipient, sourceEvent, organizationId?, idempotencyKey }` where `recipient` is `{ userId }` or `{ email, locale }`, or `{ kind: 'retry', deliveryId }`. For a new send it resolves a user's address through the auth admin API and the language through `localeForUser`, validates `data` with the template's Zod schema (an invalid payload marks the row `failed` with the issue and sends nothing), and a second trigger with the same `idempotencyKey` returns the existing row without sending (Trigger.dev key plus the unique column). A retry rerenders from the stored `template`, `locale` and `data`, reuses the stored `recipient_email` and re resolves only when that column is empty. A render failure (a missing message key throws in development and test, spec 0004) marks the row `failed` with `error` = `render_failed`.
- **AC-5**: The task picks the transport from the environment: the Resend SDK when `RESEND_API_KEY` is set (idempotency key `<deliveryId>/<attempt>`, tag `template`, `from` = `EMAIL_FROM`, `reply_to` = `EMAIL_REPLY_TO`), else SMTP through `EMAIL_SMTP_URL` (Mailpit locally), else the row is `skipped` with `error` = `no_transport` and a warning is logged. The `sent` update writes `provider_message_id`, `sent_at` and `attempts` and sets `status` to `sent` only when the row is not already `delivered`, `bounced` or `complained` (the webhook may land first). An SMTP row stops at `sent` with a null `provider_message_id` (nodemailer's message id is not stored). On the local stack the welcome email appears in Mailpit with subject and body in the user's language.
- **AC-6**: When `EMAIL_ALLOWED_RECIPIENTS` is set (comma separated addresses or `@domain` entries), a recipient outside it is marked `skipped` with `error` = `not_allowlisted`, nothing is sent and no alert is raised; the notification row is still written.
- **AC-7**: A provider error with a 4xx status other than 429 marks the row `failed` on the first attempt with the provider message in `error`. A 429, a 5xx or a network error rethrows so Trigger.dev retries (project default, 3 attempts; retries are off in dev, so the classifier is unit tested against a fake transport and the full chain is a staging check); the last failure marks the row `failed`, sets `failed_at` and raises an `email.failed` alert that links to `/en/admin/emails/<id>`.
- **AC-8**: `POST /api/webhooks/resend` verifies the signature with `RESEND_WEBHOOK_SECRET` through `resend.webhooks.verify` (the `resend` package at a version that ships it) and maps `email.delivered` to `delivered` (`delivered_at` = the event's `created_at`), `email.bounced` to `bounced` (`data.bounce.type` and `data.bounce.message` joined into `error`), `email.complained` to `complained`, and logs `email.delivery_delayed` without a change; the row is found by `data.email_id`. A missing secret answers 503 and logs; a bad signature answers 401; an unknown `provider_message_id` answers 200 and logs; a repeated event is a no op; a status never moves backwards (rank `sent` 1, `delivered` 2, `bounced` 2, `complained` 3, apply only when the incoming rank is higher).
- **AC-9**: `/admin/emails` lists deliveries newest first, 50 per page with cursor paging (the cursor is base64url of `created_at|id`, the keyset predicate compares the pair, `nextCursor` is null on the last page), filters by `status` and `template` as query parameters, searches on `recipient_email`, and updates status live through Supabase Realtime (the subscription patches only rows already on the page and keeps the polling fallback of the scaffold page). `/admin/emails/[id]` shows every column, the error, and the email rerendered on the server from the stored `data` inside `<iframe sandbox="" srcDoc>`, with a retry button on `failed` rows. Its strings live in an `emails` namespace with a label for each of the eight statuses, the filter labels, the retry and test button labels, the toasts and the empty and error states. Both pages render in German and English, are in the typed route map and the admin navigation, pass axe, and answer a client or expert with the existing forbidden page.
- **AC-10**: The retry action triggers `send-email` with `{ kind: 'retry', deliveryId }` and no Trigger.dev idempotency key (the unique row is the guard); the row moves from `failed` to `sending` and then to the new outcome. The "send me a test email" button sends the `welcome` template to the signed in ops user (`recipient: { userId }`, literal data `organizationName: 'SME24 Test'`, no notification row) with `source_event` = `ops.test_email`; the "send a test alert" button posts an `ops.test` alert, or returns `webhook_unset` without triggering when `OPS_ALERT_WEBHOOK_URL` is not set on the server. Each click sends (the idempotency key carries a timestamp), the page shows the run id in a toast, and every action checks the ops role itself.
- **AC-11**: The `ops-alert` task takes `{ kind, fields, link?, idempotencyKey }` (a `schemaTask`; the key is created with global scope) against a typed registry with the live kinds `client.signed_up`, `email.failed`, `ops.test` and the reserved kinds `research.run_failed`, `payment.received`, `enquiry.received` (typed fields, no caller yet). It renders Block Kit in English with Swiss formats, posts with `fetch`, retries on a 429 or 5xx like any task, and a final failure reaches Sentry and the log only; it never raises an alert about itself and a failed trigger never fails the caller.
- **AC-12**: A weekly scheduled task `purge-email-deliveries` deletes `email_deliveries` rows older than 90 days, leaves `notifications` untouched and logs the count.
- **AC-13**: `email_deliveries` is readable by the ops role only and has no insert, update or delete grant for `authenticated`; `notifications` lets the recipient read their own rows and update only `read_at` (column grant), with no insert; the service key writes both; `truncate` is revoked on both; pgTAP files cover every rule and `pnpm test:db` passes.
- **AC-14**: Templates are React Email components sharing one layout (brand mark, jet on white, Geist first font stack, one primary button, a footer with the legal line and the reply hint) and take every string from an `email` namespace through the standalone translator (per template `subject`, `preview`, `greeting`, `greetingNeutral`, `intro`, `nextStep`, `button`; shared `layout.footerLegal`, `layout.footerAddress`, `layout.replyHint`), with no hardcoded prose. `pnpm email:dev` opens the React Email preview server with a preview per template and locale, and a Vitest test renders `welcome` in both languages and checks the subject and the button link.
- **AC-15**: When triggering a task at the event site fails (Trigger.dev unreachable, or `TRIGGER_SECRET_KEY` unset locally), the sign in still completes; the failure is logged and, when deployed, sent to Sentry with the organization id.

## Decision

**Chosen option**: Option 2: an outbox table plus one generic `send-email` task with a typed template registry and two transports, delivery status through the Resend webhook, and a separate `ops-alert` task posting to a Slack incoming webhook.

Every product email and every team alert leaves through a Trigger.dev task, is recorded in Postgres, and is visible to ops in the admin; the caller only names the template or the alert kind and the data.

**Implementation skills**: `resend` (`resend/resend-skills`, `.claude/skills/resend/`) · `react-email` (`resend/resend-skills`, `.claude/skills/react-email/`, its i18n reference shows the next-intl pattern the templates use) · `nodemailer` (`aidotnet/moyucode`, `.claude/skills/nodemailer/`, the local SMTP transport) · `email-testing` (`petrkindlmann/qa-skills`, `.claude/skills/email-testing/`, Mailpit polling in Playwright) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `ask-sonner` (`emilkowalski/skills`, `.claude/skills/ask-sonner/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

## Feature design

**Data model sketch** (the target; both tables are new, both were reserved in spec 0002's target map):

| Table | Kind | Columns | Keys and indexes |
|---|---|---|---|
| `email_deliveries` | I (infrastructure, no tenant owner, ops read only) | `id uuid pk`, `idempotency_key text not null unique`, `source_event text not null`, `template text not null`, `locale text not null check (locale in ('de','en'))`, `recipient_email text not null`, `recipient_id uuid null references profiles(id) on delete set null`, `organization_id uuid null references organizations(id) on delete set null`, `subject text null` (set after render), `data jsonb not null default '{}' check (jsonb_typeof(data) = 'object')`, `status text not null default 'queued' check (status in ('queued','sending','sent','delivered','bounced','complained','failed','skipped'))`, `transport text null check (transport in ('resend','smtp'))`, `provider_message_id text null`, `error text null`, `attempts integer not null default 0`, `last_run_id text null`, `created_at`, `sent_at timestamptz null`, `delivered_at timestamptz null`, `failed_at timestamptz null`, `updated_at` | indexes `(status, created_at desc)`, `(recipient_id)`, `(organization_id)`, `(created_at desc, id desc)` (keyset paging and the purge); unique partial `(provider_message_id) where provider_message_id is not null` |
| `notifications` | U (owner `recipient_id`) | `id uuid pk`, `recipient_id uuid not null references profiles(id) on delete cascade`, `organization_id uuid null references organizations(id) on delete set null`, `kind text not null`, `data jsonb not null default '{}' check (jsonb_typeof(data) = 'object')`, `link text null`, `delivery_id uuid null references email_deliveries(id) on delete set null`, `read_at timestamptz null`, `created_at` | index `(recipient_id, read_at, created_at desc)` |

Both tables: `enable row level security`, `set_updated_at` trigger where `updated_at` exists, `revoke truncate` from the three app roles, and `email_deliveries` joins the Realtime publication in `90_realtime.sql`. Neither gets the audit trigger (a log table would triple its own rows; the ops trace is the structured log plus `last_run_id`). Slack alerts have no table.

**State transitions** (`email_deliveries.status`, written only by the task and the webhook):

`queued` → `sending` (task attempt starts) → `sent` (provider accepted) → `delivered` | `bounced` | `complained` (webhook, forward only by rank). `sending` → `failed` (`invalid_data`, `render_failed`, a provider 4xx, or the last retry; the reason or the provider message sits in `error`). `queued` | `sending` → `skipped` (`no_transport`, `not_allowlisted`, `recipient_missing`). `failed` → `sending` (ops retry only). `skipped` is final except through a fresh send with a new idempotency key. The task's `sent` write never overwrites a state the webhook already applied.

**API surface** (tasks in `src/trigger/`, helpers in `src/lib/email/` and `src/lib/alerts/`, the ops feature in `src/features/emails/`; actions return `{ ok: true, data } | { ok: false, error }`):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `send-email` task (`src/trigger/send-email.ts`) | trigger | `{ kind: 'new', template, data, recipient, sourceEvent, organizationId?, idempotencyKey }` (`recipient` `{ userId }` or `{ email, locale }`; the key also becomes the global Trigger.dev key) or `{ kind: 'retry', deliveryId }` (no Trigger.dev key) | `{ deliveryId, status }` | service client, explicit ids | invalid data or render failure → `failed`, no throw; recipient missing → `skipped`; provider 4xx → `failed`; 429, 5xx, network → throw (retry) |
| `ops-alert` task (`src/trigger/ops-alert.ts`) | trigger | `kind` (registry key), `fields` (typed per kind), `link?` (app path), `idempotencyKey` | `{ posted: boolean }` | service client not needed | webhook URL unset → `posted: false`, log; 429, 5xx → throw (retry); final failure → Sentry through the global hook |
| `purge-email-deliveries` task | schedule, weekly (`0 3 * * 1`, Zurich) | none | `{ deleted: number }` | service client | database error → throw |
| `sendEmail(payload)` and `retryEmail(deliveryId)` (`src/lib/email/send.ts`) | server function | the `new` payload (the helper builds the global key), or a delivery id | `{ ok: true, runId } \| { ok: false, error: 'trigger_unavailable' \| 'trigger_failed' }` | server only (needs `TRIGGER_SECRET_KEY`) | never throws; logs and captures to Sentry when deployed |
| `sendOpsAlert(alert)` (`src/lib/alerts/send.ts`) | server function or task | the alert payload | same result shape | server only | never throws |
| `POST /api/webhooks/resend` | POST | raw body, `svix-id`, `svix-timestamp`, `svix-signature` | 200 `{ received: true }` | signature with `RESEND_WEBHOOK_SECRET` | 503 secret missing, 401 bad signature, 200 unknown id or unhandled type |
| `listDeliveries({ status?, template?, search?, cursor? })` (`queries.ts`) | server component | filters, cursor = base64url `created_at|id` | 50 rows plus `nextCursor` (null on the last page) | ops (RLS) | throws on database error |
| `getDelivery(id)` (`queries.ts`) | server component | id | the row | ops (RLS) | not found → `notFound()` |
| `renderDeliveryPreview(row)` (`src/lib/email/render.ts`) | server component | template, locale, data | `{ subject, html }` | server only | unknown template → an error state on the page |
| `retryDelivery` action | POST | `deliveryId` | `{ runId }` | ops (checked in the action) | row not `failed` → `not_retryable`; trigger failure → `trigger_failed` |
| `sendTestEmail` action | POST | none (the actor's id) | `{ runId }` | ops | `trigger_failed` |
| `sendTestAlert` action | POST | none | `{ runId }` | ops | `webhook_unset` (checked server side), `trigger_failed` |
| `/admin/emails`, `/admin/emails/[id]` | GET | query filters, id | the pages | ops (proxy area gate plus RLS) | forbidden page for other roles |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `ensureOrganization` welcome trigger | organization id, created flag | `ensureOrganization` now returns `{ ok: true, organizationId, created }` from the uuid `create_organization` returns (spec 0002); `created` is false on `already_member` and nothing is sent |
| same | organization name | the `name` argument of `ensureOrganization` |
| same | user id, source event | the session user id; the constant `auth.organization_created` |
| same | the alert's full name and language | resolved inside the `ops-alert` task from `userId` through the service client (`profiles.full_name`, `localeForUser`); time is `now()` formatted with `dateTime` in `en-CH` |
| `send-email` | recipient address | `auth.admin.getUserById(userId).email` through the service client; or the `email` in a raw recipient |
| same | locale | `localeForUser(service, userId)` (spec 0004); or the raw recipient's `locale` |
| same | first name in the greeting | the first whitespace separated token of `profiles.full_name`; empty → the neutral greeting key `email.welcome.greetingNeutral` |
| same | subject | the template's subject key rendered with the data, stored in `subject` |
| same | button link | `NEXT_PUBLIC_APP_URL` plus `/<locale>` plus the template's `link` |
| same | from, reply to | `EMAIL_FROM`, `EMAIL_REPLY_TO` (task env) |
| same | transport | `RESEND_API_KEY` set → `resend`; else `EMAIL_SMTP_URL` set → `smtp`; else `skipped` |
| same | allowlist verdict | `EMAIL_ALLOWED_RECIPIENTS`, case insensitive match on the address or its `@domain` |
| same | provider idempotency key | `<deliveryId>/<attempts>`, where `attempts` is the column incremented at the start of the attempt |
| same (retry) | recipient address and language | the stored `recipient_email` and `locale`; the address is re resolved only when the column is empty |
| same | `sent_at`, `failed_at` | `now()` in the task at the moment of the outcome |
| same | notification `link` and `notify` | the template registry entry's `link` (bare path, prefixed at render time by feature 23) and its `notify` flag |
| `ops-alert` | message title, fields, button | the registry entry for `kind`, the payload `fields`, `NEXT_PUBLIC_APP_URL` plus `link` |
| webhook | the row to update, `delivered_at`, `error` | `provider_message_id` = `data.email_id`; `delivered_at` = the event's `created_at`; `error` = `data.bounce.type` plus `data.bounce.message` on a bounce |
| `/admin/emails` | list, filters, paging | `email_deliveries` through RLS; query params `status`, `template`, `q`, `cursor` |
| `/admin/emails/[id]` | preview | `renderDeliveryPreview` from `template`, `locale`, `data` |
| `sendTestEmail` | recipient, template data | `recipient: { userId }` from the session claims; `organizationName` is the literal `SME24 Test`, the name comes from the task's usual resolution |
| `sendTestAlert` | configured or not | `OPS_ALERT_WEBHOOK_URL` in `serverEnv` (mirrored on Vercel for this check only) |
| `purge-email-deliveries` | cutoff | `now() - interval '90 days'` on `created_at` |

**Key invariants**:
- One `email_deliveries` row per intended email: `idempotency_key` is unique, and a retry reuses the row.
- `attempts` counts task attempts across every run of the row; the provider idempotency key changes with it, so a retry is never deduplicated by Resend against an earlier failed attempt.
- The task's `sent` write never overwrites `delivered`, `bounced` or `complained`.
- The row exists before any render or send; the notification row is written in the same task step, before the transport call.
- A status only moves forward through the webhook (rank rule in AC-8); only the ops retry moves `failed` back to `sending`.
- The task never sends without a stored `subject` and `data` that pass the template's schema.
- Only the service key writes either table; no user session can insert or update a delivery.
- Every string in a template or an alert resolves through a message key (templates) or the English alert registry (alerts); no hardcoded prose.
- The email address of a recipient never reaches Slack.
- Auth emails (confirmation, code, reset, invite) stay on Supabase's SMTP path from spec 0005 and never pass through this rail.

**Security model** (compliance scope: revised Swiss FADP with GDPR readiness; a delivery row holds an email address, a name inside `data` and a subject, all personal data; a Slack alert holds a person's name and company, sent to a US hosted vendor):
- Client and expert: no access to `email_deliveries`; a client reads their own `notifications` and may set `read_at` only.
- Ops: reads all deliveries (RLS select policy on `private.is_ops()`), triggers retries and test sends through actions that check the role themselves; ops never read other users' notifications.
- Tasks: the service client with explicit ids (`deliveryId`, `userId`); never a broad query.
- Webhook: signature required; the handler updates by `provider_message_id` only, touches status columns only, and rate limiting comes from the Vercel firewall rules of spec 0001.
- Retention: deliveries purged after 90 days; notifications kept until feature 23 decides; the erasure path of feature 14 must also redact `recipient_email` and `data` in still living rows.
- Vendors: Resend (already listed in spec 0001) and Slack (new) need a data processing agreement and a line in the privacy policy (feature 14).

**Configuration required**:
- `RESEND_API_KEY` (Trigger.dev, hosted only): a send only key per environment; unset locally so the SMTP transport is used.
- `EMAIL_FROM` (Trigger.dev, `requiredWhen(deployedTask)`): the sender, `SME24 <no-reply@<verified domain>>`; on staging before the domain exists, `SME24 <onboarding@resend.dev>` with the allowlist set. Locally, a missing value together with a set `EMAIL_SMTP_URL` falls back to `SME24 <no-reply@sme24.local>`.
- `EMAIL_REPLY_TO` (Trigger.dev, optional): the ops mailbox replies go to.
- `EMAIL_SMTP_URL` (Trigger.dev local only): `smtp://127.0.0.1:54325`, the Mailpit SMTP port; needs `smtp_port = 54325` uncommented under `[inbucket]` in `supabase/config.toml` (then `supabase stop && supabase start`).
- `EMAIL_ALLOWED_RECIPIENTS` (Trigger.dev, optional): comma separated addresses or `@domain` entries, parsed in `taskEnv` by a Zod transform into a lowercased `readonly string[]`; set on staging, unset on production once the domain is verified.
- `OPS_ALERT_WEBHOOK_URL` (Trigger.dev, optional; also optional in `serverEnv` on Vercel, only so the test alert button can report `webhook_unset`): the Slack incoming webhook for the environment's channel; unset locally unless you want real posts.
- `RESEND_WEBHOOK_SECRET` (Vercel, optional; the webhook answers 503 until it is set, and a startup requirement would take every route down on a deployment without a Resend webhook; a test value locally for the signed test): the signing secret of the Resend webhook endpoint `https://<host>/api/webhooks/resend` subscribed to `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`.
- `TRIGGER_DEV_RUNNING` (local shell, optional): set to `1` when `pnpm trigger:dev` is running so the Playwright welcome test asserts on the delivery row and the Mailpit message instead of skipping.
- Existing: `NEXT_PUBLIC_APP_URL`, `SUPABASE_SECRET_KEY`, `TRIGGER_SECRET_KEY`. `taskEnv` gains the new task variables (only `EMAIL_FROM` becomes required, when deployed); `serverEnv` gains `RESEND_WEBHOOK_SECRET` and `OPS_ALERT_WEBHOOK_URL` as optional; `.env.example` documents all of them. Packages: `resend` (a version with `webhooks.verify`), `@react-email/components`, `@react-email/render`, `nodemailer` with its types, and `react-email` as a dev dependency.
- Per environment prerequisites (the checklist in `docs/email.md`): a Resend domain verified with SPF and DKIM in the EU region (deferred, no DNS access yet), a Resend webhook endpoint with its secret, a Slack incoming webhook per channel, the Trigger.dev and Vercel variables above.

**Critical test scenarios** (each maps to an acceptance criterion in `## Requirements`):
- Happy path: sign up, confirm, land on `/de/app`; a `welcome` delivery row moves to `sent`, a notification row exists, and Mailpit holds a German email with the organization name and a button to `/de/app`, verifies **AC-1**, **AC-3**, **AC-5**, **AC-14** (Playwright, local stack with the worker running).
- Happy path: the same sign up posts a `client.signed_up` Block Kit payload without the email address (Vitest on the builder; a real post by hand on staging), verifies **AC-2**, **AC-11**.
- Idempotency: triggering `send-email` twice with `welcome/<orgId>` yields one row and one message, verifies **AC-1**, **AC-4**.
- Failure case: the Resend transport answers 422 for an unverified domain, the row is `failed` after one attempt and an `email.failed` alert is triggered; a 500 rethrows and the third failure marks `failed`, verifies **AC-7**.
- Failure case: the allowlist excludes the address, the row is `skipped` with `not_allowlisted`, no transport call, notification written, verifies **AC-6**.
- Webhook: a signed `email.delivered` moves `sent` to `delivered`; a later `email.bounced` for the same row is ignored; an unsigned request gets 401; a missing secret gets 503; an unknown id gets 200, verifies **AC-8**.
- Ops page: filters and the search narrow the list, the detail page shows the rerendered preview, retry on a `failed` row triggers a run and the row shows `sending` live; axe is clean on both pages in both languages, verifies **AC-9**, **AC-10**.
- Auth/permission: a client session selecting `email_deliveries` gets zero rows; inserting a notification for another user fails; updating `kind` on their own notification fails while `read_at` succeeds (pgTAP); a client opening `/de/admin/emails` sees the forbidden page, verifies **AC-13**, **AC-9**.
- Purge: rows older than 90 days go, newer ones and all notifications stay, verifies **AC-12**.
- Event site failure: `tasks.trigger` rejected, the sign in still lands on `/de/app` and the warning is logged, verifies **AC-15**.

## Build plan

Tracer Bullet: the first task runs one real email from the sign in event through the outbox, the task, the template and the local inbox before anything hosted, then the rail thickens layer by layer.

1. [x] Thin thread, welcome email to Mailpit: the migration for `email_deliveries` and `notifications` from `supabase/schemas/30_email_deliveries.sql` and `31_notifications.sql` (policies, grants, `revoke truncate`, Realtime for deliveries, hand checked grants, regenerated types) with their pgTAP files; the template registry in `src/lib/email/registry.ts` with the shared layout and the `welcome` template on the standalone translator and the new `email` namespace; the `send-email` task with the SMTP transport, the delivery and notification rows, recipient and locale resolution and the schema check; `ensureOrganization` returning `{ ok, organizationId, created }` and calling `sendEmail` on `created` with the trigger failure swallowed; the payload union and the `email` schemas in `src/lib/email/schema.ts`; `taskEnv` and `.env.example` entries and the `smtp_port` line in `config.toml`, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-5** (SMTP half), **AC-13**, **AC-14** (templates), **AC-15**
2. [x] Hosted transport and delivery status: the Resend transport with idempotency key, tags, from and reply to; the allowlist; the error classification and retry behaviour; the conditional `sent` write; the webhook route with signature verification, the rank rule and the status update; `serverEnv` gains the secret, satisfies **AC-5** (Resend half), **AC-6**, **AC-7** (statuses), **AC-8**
3. [x] Alert rail: the alert registry with the live and reserved kinds, the Block Kit builder in English with Swiss formats, the `ops-alert` task and `sendOpsAlert`; `client.signed_up` fired next to the welcome email in `ensureOrganization`; `email.failed` fired from the task's final failure, satisfies **AC-2**, **AC-7** (alert), **AC-11**
4. [x] Ops surface: `src/features/emails/` with `queries.ts` (keyset paging on the base64url cursor, filters, search), `actions.ts` (`retryDelivery`, `sendTestEmail`, `sendTestAlert` with the ops check), the list page with the status badge, filters and Realtime, the detail page with the sandboxed preview and the retry button, the two test buttons with toasts; route map entries, admin navigation item, `emails` message namespace in both catalogs, `force-dynamic`, axe in Playwright, satisfies **AC-9**, **AC-10**
5. [x] Retention, previews, tests and the checklist: the `purge-email-deliveries` schedule; `pnpm email:dev` with a preview per template and locale under `src/lib/email/previews/`; Vitest for the registry, both renders, transport choice, error classes, the Block Kit builder and the webhook handler; the Playwright welcome flow reading Mailpit behind `TRIGGER_DEV_RUNNING`; `docs/email.md` with the per environment checklist (domain, webhook, Slack, variables) and the go live steps, satisfies **AC-12**, **AC-14** (preview server and tests), plus the scenarios for **AC-1** to **AC-11**

## Consequences

**Positive**:
- Later features send an email by adding one template file and one call; an alert by adding one registry entry. No new task, table or page per feature.
- Every send is durable and visible: a row before the send, retries from Trigger.dev, the real outcome from Resend, a retry button for ops.
- Local development and the Playwright suite see real emails in Mailpit next to the auth emails, with no Resend key on any developer machine.
- Staging cannot email a real person by accident: the allowlist skips instead of sending.
- The in app notification feed (feature 23) is fed from day one.

**Negative / tradeoffs**:
- Two transports mean two code paths to keep honest; the Resend path is only proven on a hosted environment, and only fully once a domain exists.
- Nothing hosted can deliver to a real client until the `sme24.ch` DNS records exist; until then staging sends reach only the allowlist.
- A rerendered preview is what the template renders today, not a byte copy of what was sent; a changed template changes old previews.
- Slack receives names and company names, a new US vendor for personal data that the privacy work in feature 14 must cover.
- One more service to configure per environment (the Slack webhook) and two more secrets to rotate.
- The webhook route drops events for unknown ids, so a delivery confirmation lost in the tiny race between the API reply and the row update stays at `sent`.

**Neutral**:
- Auth emails keep their own path (Supabase SMTP through Resend, spec 0005); this rail carries product emails only.
- `nodemailer` is a task side dependency only; it is never bundled into the app.
- The `notifications` table lands here with no reader; feature 23 builds the feed.
- Alerts are English by decision; a German team channel later is one registry change.

## Follow-up

- [ ] Verify the sending domain in Resend (EU region, SPF and DKIM at the DNS provider), set `EMAIL_FROM` to the real sender, remove `EMAIL_ALLOWED_RECIPIENTS` on production, and finish the custom SMTP boxes in `docs/auth.md`; blocked on DNS access to `sme24.ch`.
- [ ] Create the Resend webhook endpoint and the Slack incoming webhook per environment and set the variables (the `docs/email.md` checklist).
- [ ] Decide the legal footer text and postal address for emails (message key `email.footer.address` ships with a placeholder).
- [ ] Feature 14 (legal and privacy): add Slack to the vendor list and the privacy policy; make the erasure function redact `recipient_email` and `data` in `email_deliveries`.
- [ ] Feature 8 wires `research.run_failed`, feature 11 `payment.received` and the receipt template, feature 13 `enquiry.received`, feature 9 the benchmark ready template, feature 18 the gap report template, feature 19 the expert assigned template, feature 22 the invitation email, feature 23 the notification feed.
- [ ] `/sync`: add `nodemailer` and `email-testing` to `## Agent skills` in root `AGENTS.md`, record `vercel-labs/slack-agent-skill` (about Slack bots on Vercel's agent framework, not webhooks; installed and removed) and `vm0-ai/vm0-skills@slack-webhook` (not found in the repository) under `Declined:`, and note the Resend MCP server (`resend/resend-mcp`) and the Slack MCP server (`slackapi/slack-skills-plugin`) as chosen but not yet connected.
- [ ] Connect the two MCP servers in your MCP settings (`claude mcp add …`); they help with the go live checklist and test posts.
- [ ] Consider the Resend batch API and per send attachments (a receipt PDF) when feature 11 arrives; the `data` column and the registry leave room for both.

## Amendment 2026-09-05: admin links follow the English default

Spec 0001 was amended the same day to make English the default language. The Slack button links (AC-2, AC-7) open `/en/admin…`; the prefix is now derived from `DEFAULT_LOCALE` in `src/lib/alerts/blocks.ts` instead of being hardcoded. Emails are unaffected: they always render in the recipient's stored language.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
