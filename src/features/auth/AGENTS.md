# src/features/auth

Moved out of the root `AGENTS.md` so it loads only when this area is touched. The root keeps a one line pointer here.

## Auth flows

Every emailed link goes through `/api/auth/confirm` and is verified from its token hash (never `{{ .ConfirmationURL }}` in a template); `profiles.terms_accepted_at` is written only by the profiles trigger or `accept_terms()`; the role never comes from user input (the profiles trigger defaults to `client`, only `pnpm user:invite` sets `expert` or `ops`). Auth email templates live in `supabase/templates/` (German above English) and the hosted settings (Resend SMTP, templates, Google and Microsoft) are a per environment checklist in `docs/auth.md`.
