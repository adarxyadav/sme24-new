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

The invite lands in Mailpit; the link opens `/de/reset-password`, and after saving a password the user lands on `/de/expert`.

## Hosted projects (staging and prod), one checklist each

Authentication settings in the Supabase dashboard:

- [ ] Sign in / Providers, Email: **Confirm email** on, **Minimum password length** 8, no character requirements, **Prevent use of leaked passwords** on, **Email OTP expiration** 900 seconds, **Email OTP length** 6.
- [ ] URL configuration: **Site URL** is the environment's app URL (`https://staging.sme24.ch`, `https://sme24.ch`); the redirect allow list already covers the preview wildcard (`https://*-sme24.vercel.app/**`) and the app URL with `/**`.
- [ ] Email templates: paste each file from `supabase/templates/` into the matching template (Confirm signup ← `confirmation.html`, Magic link ← `magic_link.html`, Reset password ← `recovery.html`, Invite user ← `invite.html`, Change email ← `email_change.html`) with the subjects from `config.toml`. Never use `{{ .ConfirmationURL }}`: it issues a PKCE code only the requesting browser can exchange.
- [ ] Hooks: the custom access token hook `public.custom_access_token_hook` is enabled (spec 0002).

SMTP through Resend (shared with feature 7):

> **Deferred on 5 Sep 2026: no sending domain yet.** Access to the `sme24.ch` DNS is not available and no other domain is at hand, so the three Resend boxes wait. Until then the hosted projects use Supabase's built in email service, which only delivers to members of the Supabase organization (invite every tester there) and sends at most 2 emails per hour. Pick this up in feature 7 once a domain is verified.

- [ ] The sending domain is verified in Resend (SPF and DKIM records at the DNS provider).
- [ ] A Resend API key with **sending access** only, one per environment.
- [ ] Supabase, Authentication, SMTP settings: **Enable custom SMTP**, host `smtp.resend.com`, port `465`, username `resend`, password = the API key, sender `no-reply@<verified domain>`, sender name `SME24`. Raise the emails per hour rate limit from the default 30 to what the funnel needs.

Google (one OAuth client per Supabase project):

- [ ] Google Cloud console, APIs and services, Credentials: an **OAuth client ID** of type Web application. Authorised redirect URI `https://<project ref>.supabase.co/auth/v1/callback`. The consent screen lists the app name, support email and the privacy and terms URLs.
- [ ] Supabase, Sign in / Providers, Google: enabled, client ID and client secret pasted. Leave "Skip nonce check" off.

Microsoft (one app registration per Supabase project):

- [ ] Microsoft Entra admin center, App registrations, New registration: supported account types **Accounts in any organizational directory and personal Microsoft accounts** (the `common` tenant), redirect URI (Web) `https://<project ref>.supabase.co/auth/v1/callback`. Under Certificates and secrets create a client secret and note its expiry; under API permissions keep `email`, `openid`, `profile`, `User.Read`.
- [ ] Supabase, Sign in / Providers, Azure: enabled, Application (client) ID and the secret pasted, Azure tenant URL `https://login.microsoftonline.com/common`.
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
