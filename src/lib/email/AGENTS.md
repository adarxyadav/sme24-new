# src/lib/email

Moved out of the root `AGENTS.md` so it loads only when this area is touched. The root keeps a one line pointer here.

## Product email and ops alerts

Every product email goes through `sendEmail` in `src/lib/email/send.ts`, which triggers the `send-email` task: one `email_deliveries` row per send, a React Email template from the registry rendered in the recipient's stored language, Resend when `RESEND_API_KEY` is set, else SMTP through `EMAIL_SMTP_URL` (Mailpit locally), else `skipped`; never call a transport directly. Team alerts go through `sendOpsAlert` in `src/lib/alerts/` and the `ops-alert` task to the Slack webhook. A new template is a schema entry, a component, a registry entry, `email.<name>` keys in both catalogs and a preview; a new alert kind is a schema plus a presenter. Auth emails stay on the Supabase path in `docs/auth.md`. Ops watch deliveries on `/admin/emails`; the per environment checklist (domain, keys, webhook, allowlist, Slack) lives in the runbook.
