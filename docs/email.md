# Email and ops alerts

_How SME24 sends product email and team alerts, and what each environment needs before the first real message goes out. Spec: [0006 Transactional email and ops alerts](specs/0006-transactional-email-ops-alerts/index.md). Auth emails (confirmation, code, reset, invite) are a separate path, see [auth.md](auth.md)._

## How a message travels

1. An event site calls `sendEmail(...)` from `src/lib/email/send.ts` with a template name, the data, the recipient (`{ userId }` or `{ email, locale }`), a source event and its own idempotency key. The first caller is `ensureOrganization` in `src/features/auth/session.ts`, which sends the `welcome` email and the `client.signed_up` alert when a client's organization is created.
2. The `send-email` task (`src/trigger/send-email.ts`) creates one row in `email_deliveries` before anything is rendered, writes a `notifications` row for a known recipient (never for `ops.*` events), validates the data against the template's Zod schema, renders the React Email template in the recipient's stored language and hands it to the transport.
3. The transport is Resend when `RESEND_API_KEY` is set, else SMTP through `EMAIL_SMTP_URL` (Mailpit on the local stack), else the row is `skipped`. A provider 4xx other than 429 marks the row `failed` at once; a 429, 5xx or network error is retried by Trigger.dev, and the last failure marks the row `failed` and posts an `email.failed` alert.
4. Resend reports the outcome to `POST /api/webhooks/resend`; the handler verifies the signature and moves the status forward (`sent` to `delivered`, `bounced` or `complained`), never backwards.
5. Ops watch it all on `/admin/emails`: filters, search, live status, a preview per row and a retry button on failed rows. Rows older than 90 days are purged weekly by `purge-email-deliveries`.

Alerts take a smaller rail: `sendOpsAlert(...)` from `src/lib/alerts/send.ts` (or `raiseAlertFromTask` inside a task) triggers `ops-alert`, which renders Block Kit in English with Swiss formats and posts it to the Slack incoming webhook. Live kinds: `client.signed_up`, `email.failed`, `ops.test`. Reserved for later features: `research.run_failed`, `payment.received`, `enquiry.received`. A recipient's email address never reaches Slack.

## Adding a template or an alert kind

- **Template**: add its data schema to `src/lib/email/schema.ts` (and its name to `EMAIL_TEMPLATE_NAMES`), the component to `src/lib/email/templates/`, one entry to `EMAIL_TEMPLATES` in `src/lib/email/registry.ts`, its keys under `email.<name>` in both catalogs (`subject`, `preview`, `greeting`, `greetingNeutral`, `intro`, `nextStep`, `button` as the welcome template uses them) and a preview file per language in `src/lib/email/previews/`. Nothing else changes.
- **Alert kind**: add its fields in `src/lib/alerts/schema.ts` and its presenter in `src/lib/alerts/registry.ts`.

## Local development

- `supabase/config.toml` exposes Mailpit's SMTP port (`smtp_port = 54325`); after changing it run `supabase stop && supabase start`.
- `.env.local` needs `EMAIL_SMTP_URL=smtp://127.0.0.1:54325`. `EMAIL_FROM` may stay empty locally: with SMTP the sender falls back to `SME24 <no-reply@sme24.local>`.
- `pnpm trigger:dev` runs the tasks locally (the `trigger.dev` CLI is a dev dependency pinned to the SDK version; its binary is called `trigger`). The app needs `TRIGGER_SECRET_KEY` (the dev environment key) to trigger runs; without it the event site logs `trigger_unavailable` and the sign in still completes.
- `pnpm email:dev` opens the React Email preview server on port 3200 with one preview per template and language.
- Read the emails at http://127.0.0.1:54324 (Mailpit).
- Tests: `tests/email/` (render, transport, webhook), `tests/alerts/` (Block Kit), `tests/trigger/send-email.test.ts` (the task against fakes), `tests/trigger/send-email.local.test.ts` (the task against the running local stack and Mailpit; skips without them), `e2e/emails.spec.ts` (the ops pages with axe) and `e2e/welcome-email.spec.ts` (the sign in to Mailpit flow, asserted only with `TRIGGER_DEV_RUNNING=1` while the worker runs).

## Per environment checklist

Do these once per hosted environment (staging, production). The variables live in Trigger.dev for the tasks and in Vercel for the app.

### Resend

- [ ] Verify the sending domain in the EU region (SPF and DKIM records at the DNS provider). Blocked until there is DNS access to `sme24.ch`; until then staging may send from `SME24 <onboarding@resend.dev>` to the allowlist only.
- [ ] Create a send only API key per environment and set `RESEND_API_KEY` in Trigger.dev.
- [ ] Set `EMAIL_FROM` (`SME24 <no-reply@<verified domain>>`) and, optionally, `EMAIL_REPLY_TO` (the ops mailbox) in Trigger.dev.
- [ ] Create the webhook endpoint `https://<host>/api/webhooks/resend` subscribed to `email.delivered`, `email.bounced`, `email.complained` and `email.delivery_delayed`; store its signing secret as `RESEND_WEBHOOK_SECRET` in Vercel (optional in the env schema; the webhook answers 503 until it is set).
- [ ] On staging set `EMAIL_ALLOWED_RECIPIENTS` (comma separated addresses or `@domain` entries) so nobody outside the team is mailed; remove it on production once the domain is verified.

### Slack

- [ ] Create an incoming webhook for the environment's channel and set `OPS_ALERT_WEBHOOK_URL` in Trigger.dev (the tasks post) and in Vercel (only so the "send a test alert" button can say `webhook_unset` without a run).
- [ ] Slack receives names and company names: add Slack to the vendor list and the privacy policy (feature 14).

### Trigger.dev and Vercel

- [ ] `TRIGGER_SECRET_KEY` for the environment in Vercel (the app triggers runs).
- [ ] Deploy the tasks (`deploy.yml`, or `pnpm trigger:deploy:staging` and `trigger:deploy:prod`); the `purge-email-deliveries` schedule registers itself on deploy.
- [ ] `NEXT_PUBLIC_APP_URL` is the absolute host the button links use.

### Prove it

- [ ] On `/admin/emails` press "send me a test email" and "send a test alert"; both show a run id, the email row moves to `sent` and then `delivered` through the webhook, and the alert reaches the channel.
- [ ] Retry a failed row and watch it move to `sending` live.

## Go live

1. Replace the placeholder postal address in the email footer (`email.layout.footerAddress` in `messages/de-CH.json` and `messages/en-CH.json`, currently `Musterstrasse 1`) with the real imprint address. Commercial email to Swiss and EU recipients is expected to carry it, and nothing in the code stops a real welcome email going out with the placeholder.
2. Domain verified, `EMAIL_FROM` on the real sender, `EMAIL_ALLOWED_RECIPIENTS` removed on production.
3. Webhook endpoint and secret set on production, one test email delivered end to end.
4. Slack webhook set on production, one test alert posted.
5. Switch Supabase's auth emails to the same domain (the custom SMTP boxes in [auth.md](auth.md)).

## Data and retention

- `email_deliveries` holds an address, a subject and the template data (a name inside). Ops read it; only the service key writes. Purged after 90 days.
- `notifications` is the in app feed (feature 23 reads it); the recipient reads their own rows and may set `read_at`.
- The erasure path of feature 14 must also redact `recipient_email` and `data` in rows younger than 90 days.
