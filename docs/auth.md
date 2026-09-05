# Auth setup

_How sign in is configured per environment (spec [0005](specs/0005-auth-organizations-roles/index.md)). The code lives in `src/features/auth/`, the proxy rules in `src/proxy.ts`, the two handlers in `src/app/api/auth/`. This file is the per environment checklist: what must exist in Supabase, Resend, Google and Microsoft before the flows work on staging and prod._

## How it fits together

- Clients sign up on `/sign-up` (password or six digit code, Google, Microsoft) and must confirm their email. The first confirmed sign in creates the organization from the sign up form (`ensureOrganization` in `src/features/auth/session.ts`), so every later feature finds the organization claim on the session. A provider sign up has no company name yet and lands on `/app/onboarding`.
- Experts and ops never sign up in public. `pnpm user:invite` creates them with the role fixed (in `app_metadata` and on the profile: the admin API writes `app_metadata` only after the insert, so the profiles trigger alone would leave `client`) and sends the invite email; the link opens `/reset-password`.
- The six digit code lives in two templates: a code request for a new address makes Supabase send the **confirmation** template (the user is being created), an existing address gets the **magic link** template. Both print `{{ .Token }}` next to the link.
- Every emailed link points at `/api/auth/confirm?token_hash=…&type=…&next=…` and is verified from its token hash, so it works in any browser or on a phone. `next` is the absolute destination the action passed as `emailRedirectTo` and carries the locale.
- Consent is recorded once in `profiles.terms_accepted_at`: from the sign up metadata by the profiles trigger, or by `accept_terms()` from the onboarding form. Nothing else may write the column.
- The role never comes from the user: the profiles trigger defaults to `client`, the access token hook rewrites `app_metadata.role` from the profile, only the invite script writes another role.

## Local stack

`supabase/config.toml` already carries everything: confirmations on, minimum password length 8, code expiry 900 seconds, the five templates in `supabase/templates/`, Google and Microsoft present but off. Emails land in Mailpit at http://127.0.0.1:54324. A config change needs `supabase stop && supabase start`.

To try a provider locally, register a client whose redirect URL is `http://127.0.0.1:54321/auth/v1/callback`, then set `enabled = true` under `[auth.external.google]` or `[auth.external.azure]` and export the two variables the block names (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, or the `AZURE` pair) before `supabase start`.

Invite a staff user against the local stack:

```sh
pnpm user:invite --email erika@example.com --role expert --locale de --name "Erika Expert"
```

The invite lands in Mailpit; the link opens `/en/reset-password` (the invite defaults to English, `--locale de` for German), and after saving a password the user lands on `/en/expert`.

## Hosted projects (staging and prod)

### Automated: `supabase config push` on every deploy

The migrate job in `.github/workflows/deploy.yml` runs `supabase config push --project-ref <ref>` right after `supabase db push`. It applies the `[auth]` sections of `supabase/config.toml` plus the `[remotes.<name>]` block whose `project_id` is the branch's project (`remotes.staging` for `main`; add `remotes.production` with the prod ref when that project exists). Everything below is therefore set by a deploy and must never be edited in the dashboard, because the next push overwrites it:

- Email: confirm email on, minimum password length 8, no character requirements, email OTP expiry 900 seconds, email OTP length 6.
- URL configuration: site URL `https://sme24.vercel.app` (the `main` deployment; every emailed link is built from it, so change the block the day `main` gets a custom domain) and the redirect allow list `https://sme24.vercel.app/**` plus the team preview wildcard `https://*-adarxyzs-projects.vercel.app/**`.
- Everything else under `[auth]` as written, including `skip_nonce_check = false` for Google (the base block sets it to true for local sign in only), TOTP MFA off until feature 12 switches it on in the file, and no SMS, Apple, web3 or third party providers.
- The five email templates from `supabase/templates/` with the subjects from `config.toml`. Never use `{{ .ConfirmationURL }}`: it issues a PKCE code only the requesting browser can exchange.
- The custom access token hook `public.custom_access_token_hook` (spec 0002).
- Custom SMTP through Resend: host `smtp.resend.com`, port `465`, user `resend`, sender `no-reply@send.akaiv.in` (the staging sending domain from [email.md](email.md)), sender name `SME24`, 30 auth emails per hour. The password is `env(SUPABASE_AUTH_EMAIL_SMTP_PASS)`, never a literal in the file.

The step skips with a notice (it never pushes half a config) until the GitHub environment carries two secrets:

- [ ] `SUPABASE_ACCESS_TOKEN`: a personal access token from the Supabase account page (Account, Access tokens). The CLI needs it for the management API; the database URL does not open that door.
- [ ] `SUPABASE_AUTH_EMAIL_SMTP_PASS`: the environment's Resend API key (below). The CLI sends the enabled SMTP block with whatever the variable resolves to, so without it the push would blank the SMTP password; the step refuses to run instead.

To apply the file from a machine instead of waiting for a deploy: `supabase login`, export `SUPABASE_AUTH_EMAIL_SMTP_PASS`, then `supabase config push --project-ref fxmdkvhououxakmyddwn` and confirm the printed diff.

> **Symptom of a project that was never pushed (staging, 5 Sep 2026):** the confirmation email carries an **8 digit** code while `/verify-code` has six boxes, so every code fails with "The code is wrong or has expired". Supabase's default OTP length is 8 and only the config push sets 6. Nothing is wrong in the app; run the push (or check the deploy log for the "Auth config push skipped" notice).

### Manual, once per environment

Resend (shared with feature 7):

> **Deferred on 5 Sep 2026: no product sending domain yet.** Staging sends from `send.akaiv.in` (verified 6 Sep 2026); `sme24.ch` waits for DNS access. When the product domain lands, change `admin_email` in the `[remotes.<name>.auth.email.smtp]` block and redeploy.

- [ ] The sending domain is verified in Resend (SPF and DKIM records at the DNS provider).
- [ ] A Resend API key with **sending access** only, one per environment, stored as the `SUPABASE_AUTH_EMAIL_SMTP_PASS` secret above (and as `RESEND_API_KEY` for product email, [email.md](email.md)).

Supabase dashboard (no `config.toml` key exists for these):

- [ ] Sign in / Providers, Email: **Prevent use of leaked passwords** on (Pro plan).

Google (one OAuth client per Supabase project):

- [ ] Google Cloud console, APIs and services, Credentials: an **OAuth client ID** of type Web application. Authorised redirect URI `https://<project ref>.supabase.co/auth/v1/callback`. The consent screen lists the app name, support email and the privacy and terms URLs.
- [ ] Store the client ID and secret as the GitHub secrets `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, export them in the `supabase config push` step and uncomment `[remotes.<name>.auth.external.google]` in `config.toml` with `enabled = true` and `skip_nonce_check = false`. Enabling Google in the dashboard instead is undone by the next deploy, because the base block says `enabled = false`.

Microsoft (one app registration per Supabase project):

- [ ] Microsoft Entra admin center, App registrations, New registration: supported account types **Accounts in any organizational directory and personal Microsoft accounts** (the `common` tenant), redirect URI (Web) `https://<project ref>.supabase.co/auth/v1/callback`. Under Certificates and secrets create a client secret and note its expiry; under API permissions keep `email`, `openid`, `profile`, `User.Read`.
- [ ] Same pattern as Google: `SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_AZURE_SECRET` as GitHub secrets, exported in the push step, `[remotes.<name>.auth.external.azure]` uncommented with `enabled = true` and the tenant URL `https://login.microsoftonline.com/common`.
- [ ] Known edge: a personal Microsoft account whose email Microsoft has not verified arrives without `email_confirmed_at`; the app signs it out again and shows the `email_unverified` message. Nothing to configure, but worth knowing when testing with a fresh outlook.com address.

Invite staff on a hosted project:

```sh
vercel env pull .env.local --environment=preview    # staging keys (production for prod)
pnpm user:invite --email name@sme24.ch --role ops --locale de
```

Verify by hand after every change to the callback handler or `finalizeSignIn` (AC-5): a new Google account lands on `/app/onboarding` and reaches `/app` after naming the company; a Microsoft work account does the same; the invited expert signing in with the matching Google address keeps the expert role and lands on `/expert`.

## Sessions

Access tokens live one hour, refresh tokens rotate, there is no inactivity cutoff. The proxy refreshes the cookies on every request, also on the redirects it issues itself. Sign out is local to the device; a password change revokes every other session. MFA for ops and a session policy are follow ups (spec 0005, follow up list).

## Tests

- `pnpm test` covers the proxy rules, the redirect helpers and the error map.
- `pnpm test:db` covers `terms_accepted_at`, `accept_terms()` and the grants (`supabase/tests/accept_terms.test.sql`).
- `pnpm test:e2e` runs `e2e/auth.spec.ts`: the email dependent flows read Mailpit and assert rows through the secret key, so they run against the local stack (`PLAYWRIGHT_BASE_URL` unset or pointing at localhost) and skip on a deployment. Every run uses a fresh address because Supabase allows one email per address per minute.
