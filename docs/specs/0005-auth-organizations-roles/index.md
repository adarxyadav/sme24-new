# 0005. Auth, organizations and roles

**Date**: 2026-09-05
**Status**: In Progress

## Summary

Clients sign up and sign in with Supabase Auth (the sign in service that ships with your database) using a password, a six digit email code, or a Google or Microsoft account, and they must confirm their email before the first sign in. Sign up asks for the company name, and the first confirmed sign in turns it into the client's organization with the person as owner, so every later feature finds a tenant on the session. Experts and ops never sign up in public: a small script invites them with their role fixed, and the existing role claim and proxy gate keep each of the three areas to its own role. Supabase keeps sending the auth emails, but through your Resend domain, with German above English in every template.

## Requirements

**User stories**:
- As a client, I want to create an account for my company in one form so that I reach the benchmark without waiting for anyone.
- As a client, I want to sign in with a password, an emailed code, or my Google or Microsoft account so that I use whatever my company allows.
- As a client who forgot the password, I want to set a new one from an emailed link so that I am never locked out.
- As an expert or an ops user, I want to be invited with my role already set so that I land in my own area on the first sign in.
- As the owner of SME24, I want every route and every row gated by role and organization so that three kinds of people can share one database safely.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A visitor on `/de/sign-up` or `/en/sign-up` enters full name, company name, email and a password of at least 8 characters, ticks the consent box and submits. The page shows a "check your inbox" state, a confirmation email arrives (German above English), and following its link signs the user in, creates an organization named as entered with the user as `owner`, records the consent and lands the user on `/app` with the organization claim on the session.
- **AC-2**: The same sign up form offers "send me a code instead": the password field is not required on that path, the user receives a six digit code, enters it on the code page, and ends signed in with the organization created exactly as in AC-1. The account stays passwordless until the user runs a reset.
- **AC-3**: A confirmed user signs in with email and password and lands on the home of their role (`/app`, `/expert` or `/admin`), or on the `next` path when it is a path inside the current locale prefix.
- **AC-4**: A confirmed user requests a code on the sign in page, enters it, and is signed in as in AC-3. A code request for an unknown email shows the same "check your inbox" state and sends nothing.
- **AC-5**: A user signs in with Google or Microsoft. A first time client lands on `/app/onboarding`, names the company, ticks the consent box and reaches `/app` with an organization. An invited expert or ops user whose provider email matches keeps their role and lands in their area. Verified by hand on staging; the local stack has no providers.
- **AC-6**: Forgot password: entering an email always shows "check your inbox"; the emailed link opens the set password page; saving a new password signs the user in, lands them on their role home, and every other session of that user is revoked.
- **AC-7**: Sign out from the user menu ends the session on this device only and redirects to the marketing home; the next visit to `/app` redirects to sign in.
- **AC-8**: A signed out visitor to any `/app`, `/expert` or `/admin` path is redirected to `/sign-in` with `next` set; a signed in user with the wrong role gets `/forbidden`; a signed in user opening `/sign-in`, `/sign-up`, `/verify-code` or `/forgot-password` is redirected to their role home; a client without an organization claim is redirected from every other `/app` path to `/app/onboarding`, and a client with one is redirected from `/app/onboarding` to `/app`.
- **AC-9**: A session survives a reload, a new tab and the one hour access token expiry: the proxy refreshes it silently and the user is never asked to sign in again unless they sign out.
- **AC-10**: `pnpm user:invite --email <address> --role expert|ops` creates the user with the role on the profile and in `app_metadata`, sends the invite email, and the invitee follows it, sets a password and lands in their area. A public sign up that smuggles a role into its payload still yields a `client`.
- **AC-11**: Every client account has `profiles.terms_accepted_at` set before it reaches `/app`, on every path (password, code, provider), and the user cannot write that column directly.
- **AC-12**: A wrong password shows one generic message; an unconfirmed user gets an explanation and a resend button; a sign up with an existing email shows the same "check your inbox" state and sends nothing to the existing account; an expired or used link lands on `/sign-in` with a `link_expired` state that offers a fresh email of the failed type (an expired invite shows an "ask your administrator" note instead); a rate limited request shows a wait message. None of these reveals whether an address is registered, except the unconfirmed case, which needs the right password.
- **AC-13**: Every new page renders in German and English, every new route is in the typed route map, emailed links carry the locale so the user lands in their language, and axe reports no violations on each new page.

## Decision

**Chosen option**: Option 2: Supabase Auth with password, email code and Google plus Microsoft, confirmation required, organization created at the first confirmed sign in.

Feature 6 builds on the auth stack specs 0001 and 0002 already put in place (cookie sessions through `@supabase/ssr`, the role and organization claims from the access token hook, the proxy area gate, `create_organization`) and adds the flows: sign up with organization creation, three sign in methods, confirmation and reset through a confirm handler, an onboarding page for provider sign ups, an invite script for staff, bilingual auth email templates sent through Resend SMTP, and the proxy rules that route a client without an organization.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `resend` (`resend/resend-skills`, `.claude/skills/resend/`)

## Feature design

**Data model sketch** (the target; everything but one column and two functions exists from spec 0002):

| Entity | Key | Change | Fields this feature touches | Relations |
|---|---|---|---|---|
| `auth.users` (Supabase) | `id` | none | `raw_user_meta_data`: `full_name`, `locale`, `organization_name` (pending, clients only), `terms_accepted_at` (ISO timestamp, set only when the box was ticked); `raw_app_meta_data.role` written only by the invite script | 1:1 `profiles` |
| `profiles` | `id` → `auth.users.id` | add `terms_accepted_at timestamptz null` | `role`, `organization_id` as today; `full_name` now falls back to the provider's `name` metadata; `terms_accepted_at` is not in the `authenticated` update grant | N:1 `organizations` |
| `organizations` | `id` | none | created only through `create_organization(name)` | 1:N `organization_members`, 1:N `profiles` |
| `organization_members` | `id`, unique (`organization_id`, `user_id`) | none | the creator's `owner` row | N:1 both sides |

Functions: `public.handle_new_user` (existing trigger) also copies `terms_accepted_at` from user metadata when it parses as a timestamp, and takes `full_name` from `full_name` or `name`. New `public.accept_terms()` (`security definer`, `set search_path = ''`, `anon` execute revoked) sets the caller's `terms_accepted_at = now()` only when it is null and returns the stored value either way (idempotent, never null on success); it is the only write path for that column besides the trigger. One additive migration, plus a pgTAP file asserting the column grant, the function's null only write and that `anon` cannot execute it.

**State transitions** (an account, derived from `email_confirmed_at` and `profiles.organization_id`, no status column):

`unconfirmed` (public sign up) → `confirmed` (link or code verified) → `onboarded` (client with an organization) · `invited` (staff) → `confirmed` (invite link, password set). Only clients reach `onboarded`; experts and ops stop at `confirmed`.

**API surface** (server actions in `src/features/auth/actions.ts` return `{ ok: true, data } | { ok: false, error }`; two route handlers under `/api` because Supabase redirects there):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `signUp` action | POST | fullName, organizationName, email, password (8+), termsAccepted:true, locale | `{ ok: true }` (always, even for an existing email); sets metadata; `emailRedirectTo` = `confirmRedirectUrl(locale, '/app')`, the absolute destination the template puts into `next` | anon | `weak_password`, `over_email_send_rate_limit` → field or wait message |
| `requestCode` action | POST | email, purpose `sign-up` (with the sign up fields, no password) or `sign-in`, locale | `signInWithOtp` with `shouldCreateUser` true on `sign-up` (metadata as in `signUp`) and false on `sign-in`; `{ ok: true }` then the client navigates to `/verify-code?email=` | anon | `over_email_send_rate_limit`; an unknown email on `sign-in` makes Supabase answer `otp_disabled`, which the action maps to `{ ok: true }` so nothing leaks |
| `verifyCode` action | POST | email, token (6 digits), next | `verifyOtp({ email, token, type: 'email' })`, then `finalizeSignIn` | anon | `otp_expired` → resend offer, wrong code → field message |
| `signIn` action | POST | email, password, next | signed in, then `finalizeSignIn` | anon | `invalid_credentials` → generic, `email_not_confirmed` → resend offer |
| `signInWithProvider` action | POST | provider `google` or `azure`, locale, next | `signInWithOAuth` on the action client, so the PKCE verifier cookie lands on the action response; redirect to the provider with `redirectTo` = `<APP_URL>/api/auth/callback?next=/<locale>/app` | anon | provider unavailable → sign in error state |
| `resendConfirmation` action | POST | email, locale | `auth.resend({ type: 'signup' })` with the same `emailRedirectTo` as `signUp`; `{ ok: true }` always | anon | `over_email_send_rate_limit` |
| `requestPasswordReset` action | POST | email, locale | `{ ok: true }` always; `redirectTo` = `confirmRedirectUrl(locale, '/reset-password')` | anon | `over_email_send_rate_limit` |
| `updatePassword` action | POST | password (8+) | `updateUser({ password })`, then always `signOut({ scope: 'others' })`, redirect to role home | authenticated (from a recovery or invite link) | `same_password`, `weak_password`, no session → `/sign-in?error=link_expired&type=recovery` |
| `completeOnboarding` action | POST | organizationName (prefilled from metadata when present), termsAccepted:true | in this order: `accept_terms()`, profile `locale` set to the page locale, `ensureOrganization(name)`, redirect `/app`; submit disabled while pending | client without organization | `already_member` → `refreshSession` and redirect `/app`, `not_a_client` → `/forbidden` |
| `signOut` action | POST | locale | `scope: 'local'`, redirect `/` | authenticated | none |
| `/api/auth/confirm` | GET | `token_hash`, `type` (`signup`, `magiclink`, `email`, `recovery`, `invite`), `next` (absolute URL from `{{ .RedirectTo }}`) | validates `next` first (same origin as `NEXT_PUBLIC_APP_URL`, path with a locale prefix; otherwise default locale and no `next`), `verifyOtp({ token_hash, type })`, then `finalizeSignIn` for `signup`, `magiclink` and `email`, or redirect to `next` for `recovery` and `invite`. Never returns a 500 after a successful verification: a later failure redirects a client to `/<locale>/app/onboarding` and staff to their role home, and logs to Sentry | anon (the token hash is the credential; works in any browser) | invalid or expired → `/<locale>/sign-in?error=link_expired&type=<type>` |
| `/api/auth/callback` | GET | `code`, `next` | `exchangeCodeForSession` on the action client, then `finalizeSignIn` | anon (PKCE code plus the verifier cookie) | exchange fails or the verifier cookie is missing (link opened in another browser) → `/<locale>/sign-in?error=provider`; unconfirmed provider email → signed out, `?error=email_unverified` |

Two server side helpers in `src/features/auth/session.ts`, used by the actions and both handlers:

- `ensureOrganization(name)` is the only writer: it calls `create_organization(name)`, maps `already_member` to success, then `refreshSession()` so the token carries the organization claim (the access token hook runs on every refresh). The refreshed cookies go through the action client, so a route handler's redirect response carries them.
- `finalizeSignIn(next)`: read the user and claims. A session whose `email_confirmed_at` is null (a provider that did not verify the address) is signed out and sent to `/sign-in?error=email_unverified`. A non client goes to `next` or their role home. A client with an organization claim goes to `next` or `/app`. A client without one whose metadata holds `organization_name` and `terms_accepted_at` runs `ensureOrganization` and goes to `/app`; if that fails, or the metadata is missing, the client goes to `/app/onboarding`, which is prefilled from the metadata. `next` is accepted only when it starts with the locale prefix of the request; the same check lives in the proxy and the confirm handler.
- `confirmRedirectUrl(locale, path)` builds the absolute destination (`NEXT_PUBLIC_APP_URL` plus the locale prefix plus `path`) that `signUp`, `requestCode`, `resendConfirmation` and `requestPasswordReset` pass as `emailRedirectTo`.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `signUp`, `requestCode` | the app role of the new account | never an input: `handle_new_user` defaults to `client` and the hook strips any role a sign up payload carries (spec 0002) |
| `signUp`, `requestCode`, `completeOnboarding` | organization name | form input, held in `raw_user_meta_data.organization_name` until `create_organization` runs; the onboarding form for provider sign ups |
| `signUp`, `requestCode` | full name | form input → metadata `full_name`; provider sign ups: the provider's `full_name` or `name` metadata, copied by `handle_new_user` |
| `signUp`, `requestCode`, `completeOnboarding` | profile locale | the URL locale of the page, as the short code (spec 0004) → metadata `locale`; provider sign ups get `de` from the trigger and `completeOnboarding` overwrites it with the page locale through the existing column grant |
| `signUp`, `requestCode`, `completeOnboarding` | `terms_accepted_at` | the ticked box → metadata ISO timestamp, copied once by `handle_new_user`; provider sign ups → `accept_terms()` from the onboarding action |
| `ensureOrganization` | organization claim after creation | `create_organization` return → `refreshSession()` re runs the access token hook (spec 0002); `already_member` counts as success |
| `completeOnboarding` | the prefilled company name | `raw_user_meta_data.organization_name` when present, else empty |
| `link_expired` state | which resend action to offer | the `type` query: `signup` → `resendConfirmation`, `magiclink` or `email` → `requestCode`, `recovery` → `requestPasswordReset`, `invite` → a static "ask your administrator" note |
| invite script | the invitee's role at profile creation | `admin.createUser` with `app_metadata.role` (the trigger reads it at insert), before `inviteUserByEmail` sends the email; `inviteUserByEmail` itself accepts no `app_metadata` |
| every redirect | landing path | `next` query or hidden field when inside the locale prefix, else `ROLE_HOME[role]` from `src/lib/auth/roles.ts` |
| confirm and callback handlers | the locale of an error redirect | the `next` prefix, else the default locale |
| email templates | the link and the code | every link is built in the template as `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=<fixed per template>&next={{ .RedirectTo }}`, never `{{ .ConfirmationURL }}` (that one issues a PKCE code only the original browser can exchange, so a link opened on a phone would fail); the code is `{{ .Token }}`; `{{ .RedirectTo }}` is the absolute destination from `emailRedirectTo` and carries the locale |
| `verifyCode` | which email the code belongs to | the `email` query on `/verify-code`, written by `requestCode` |
| `updatePassword` | the session the new password applies to | the recovery or invite session set by the confirm handler |
| `signIn`, `verifyCode`, both handlers | error state to show | the Supabase `error.code` mapped in `src/features/auth/errors.ts` to a message key; unknown codes map to a generic key and go to Sentry |
| invite script | role and locale of the invitee | CLI arguments `--role` (required) and `--locale` (default `de`) |
| proxy | whether a client has an organization | `app_metadata.organization_id` through `organizationIdFromClaims` |

**Key invariants**:
- The role never comes from the user: `handle_new_user` defaults to `client`, the hook rewrites `app_metadata.role` from `profiles.role`, and only the invite script (service client) writes another role.
- A client reaches `/app` (any path but `/app/onboarding`) only with an organization claim; a client with one organization can never create a second (`create_organization` refuses `already_member`).
- `terms_accepted_at` is written once, by the trigger or `accept_terms()`, never by a direct update; `completeOnboarding` refuses to run `create_organization` before it is set.
- Every "send an email" action returns success whether or not the address exists.
- `next` redirects stay inside the current locale prefix; anything else falls back to the role home.
- Route handlers under `/api/auth/` never render; they only verify and redirect, and never answer with a 500 once a token was accepted.
- Every emailed link is verified by `/api/auth/confirm` from its token hash, so a link works in any browser or device, not only the one that requested it.
- `/reset-password` is the one auth page a signed in session (a recovery or invite session) may open; the proxy never redirects it to the role home.
- `ensureOrganization` is the only code that calls `create_organization`.

**Security model** (compliance scope: revised Swiss FADP with GDPR readiness; sign up stores name, email, company name and a consent timestamp, all personal data):
- Anonymous: may sign up (client only), request codes and resets, follow links. Rate limited by Supabase per IP (sign ups, token verifications, emails) and by the planned Vercel firewall rules from spec 0001.
- Client: reads and updates their own profile display columns (`full_name`, `locale`); everything else is RLS from spec 0002.
- Expert and ops: unchanged from spec 0002; they may use any sign in method, and Supabase links a provider identity to their account only when the provider verified the email (manual linking stays off).
- Sessions: one hour access tokens, rotated refresh tokens, no inactivity cutoff. Password change revokes the other sessions. Sign out is local.
- Passwords: at least 8 characters, no composition rules, leaked password check (HaveIBeenPwned) on the hosted projects.
- No MFA in this feature; TOTP for ops is a follow up. No captcha; revisit with feature 8's research quota.
- Audit: `profiles` and `organization_members` already carry the append only audit trigger (spec 0002), so every role change and organization creation is logged. Failed sign ins go to the structured log with the error code and no email.
- The service client appears only in `scripts/invite-user.mts`; the app never uses it for sign in.

**Configuration required** (no new app environment variable; settings live in Supabase per environment and must exist before AC-5, AC-6 and the staging emails work):
- `supabase/config.toml`: `enable_confirmations = true`, `minimum_password_length = 8`, `otp_expiry = 900`, `[auth.email.template.*]` pointing at `supabase/templates/{confirmation,magic_link,recovery,invite,email_change}.html` (each link built from `{{ .SiteURL }}`, `{{ .TokenHash }}`, its fixed `type` and `{{ .RedirectTo }}`; `magic_link.html` also prints `{{ .Token }}`), `[auth.external.google]` and `[auth.external.azure]` present but `enabled = false` (secrets from `env()`, so a developer can switch them on locally). The `email_sent` rate limit applies only with custom SMTP, so the local stack is unaffected; tests still use a unique address per run because of `max_frequency`.
- Previews: `{{ .SiteURL }}` is the staging site URL, so a sign up made on a preview host confirms and signs in on staging. Acceptable for previews; the e2e job on a deployment does not test sign up.
- Hosted staging and prod, Auth settings: confirmations on, minimum length 8, leaked password protection on, OTP expiry 900 seconds, the five templates pasted from the files above, redirect URLs already covering the preview wildcard.
- Hosted SMTP: host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key with send only scope, sender `no-reply@<verified domain>`. Prerequisite: the Resend domain is verified (SPF and DKIM), shared with feature 7.
- Google: one OAuth client per Supabase project (staging, prod) in Google Cloud console, redirect `https://<project ref>.supabase.co/auth/v1/callback`; client id and secret in the Supabase dashboard.
- Microsoft: one app registration per Supabase project in Microsoft Entra, multitenant plus personal accounts (Supabase `azure` provider, tenant `common`), same redirect; client id and secret in the dashboard.
- `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_APP_URL` (existing) are what the invite script needs; run it with the staging or prod values pulled through `vercel env pull`.
- Playwright: `E2E_SEED_PASSWORD` (existing); email dependent tests use Mailpit at `http://127.0.0.1:54324` and skip when `PLAYWRIGHT_BASE_URL` is set, since the Vercel deployment has no mail catcher.

**Critical test scenarios** (each maps to an acceptance criterion in `## Requirements`):
- Happy path: sign up with a password on `/de/sign-up`, read the confirmation from Mailpit through the shared `readMail(address)` helper (Mailpit search API on port 54324), open the link in a fresh browser context, assert the landing on `/de/app` (which the proxy only allows with an organization claim), then the organization row, the `owner` membership and `terms_accepted_at` through a service client query, verifies **AC-1**, **AC-11**, **AC-13**
- Happy path: sign up with a code, read the six digits from Mailpit, enter them, same assertions, verifies **AC-2**
- Happy path: password sign in for each seeded role lands on its home; `next=/de/admin` is honored for ops and ignored for a foreign prefix, verifies **AC-3**, **AC-8**
- Happy path: forgot password for the seeded client, follow the link, set a new password, sign in with it; a second browser context that was signed in is now signed out, verifies **AC-6**
- Failure case: sign up again with `client@example.com` shows the inbox state and Mailpit holds no new message for it, verifies **AC-12**
- Failure case: a confirmation link opened twice lands on `/de/sign-in?error=link_expired&type=signup` with a resend button that yields a fresh email, verifies **AC-12**
- Failure case: an unconfirmed user signs in with the right password and sees the resend offer; with a wrong password sees the generic message, verifies **AC-12**
- Auth/permission: a client account created without metadata (pgTAP or the admin API) is bounced from `/de/app` to `/de/app/onboarding`, completes it, and reaches `/de/app`; the expert and ops seeds are never sent there, verifies **AC-5** (local half), **AC-8**
- Auth/permission: a sign up payload with `app_metadata.role = 'ops'` still yields a `client` profile and claim (Vitest against the local stack or pgTAP on the hook), verifies **AC-10**
- Auth/permission: `pnpm user:invite` against the local stack creates an expert, the invite email lands in Mailpit, the link opens the set password page and the user lands on `/de/expert`, verifies **AC-10**
- Session: sign in, reload, open a new tab, then set the access token cookie to an expired one and load `/de/app`; the page renders, the cookie is refreshed, and a second navigation right after still renders (the rotated refresh token was persisted), verifies **AC-9**
- Sign out from the user menu, assert the `sb-*` cookies are gone from the context, then `/de/app` redirects to sign in with `next`, verifies **AC-7**
- Failure case: submit the onboarding form twice quickly; one organization exists and the user lands on `/de/app`, verifies **AC-5** (local half), **AC-8**
- pgTAP: `terms_accepted_at` is not in the `authenticated` update grant; `accept_terms()` writes only when null and is not executable by `anon`, verifies **AC-11**
- Staging by hand (documented in the verify checklist): Google and Microsoft sign in for a new client and for the invited expert, verifies **AC-5**

## Build plan

Tracer Bullet: milestone 1 pushes the thinnest real thread (one column, one sign up path, the confirm handler, organization creation, the proxy rule, one Playwright test through Mailpit) all the way to a deployable state, and each later milestone thickens one flow end to end rather than building all pages first.

1. [x] Migration for the target model: `profiles.terms_accepted_at`, the `handle_new_user` extension (consent copy, `name` fallback), `public.accept_terms()`, hand checked grants in the migration, pgTAP file, regenerated types, seed users gain `terms_accepted_at` metadata, satisfies **AC-11**
2. [x] Route map, messages and the auth error map: add `/sign-up`, `/verify-code`, `/forgot-password`, `/reset-password`, `/app/onboarding` to `PATHNAMES` as identical strings in both languages (like `/sign-in`), the `auth` message namespace in both catalogs, `src/features/auth/errors.ts` mapping Supabase error codes to message keys (including `otp_disabled` → success), satisfies **AC-12**, **AC-13**
3. [x] Session helpers and the confirm handler: `ensureOrganization`, `finalizeSignIn` (unconfirmed provider email check, the `next` prefix rule) and `confirmRedirectUrl` in `src/features/auth/session.ts`; `/api/auth/confirm` validating `next` first, verifying by token hash, never answering 500 after a verified token, satisfies **AC-1**, **AC-3**
4. [x] Proxy restructure: resolve the claims once, then in order: a signed in user on `/sign-in`, `/sign-up`, `/verify-code` or `/forgot-password` → role home (`/reset-password` excluded, a recovery session is signed in on purpose); the existing area gate; a client without an organization claim on any `/app` path but `/app/onboarding` → `/app/onboarding`; a client with one on `/app/onboarding` → `/app`; unit tests in `tests/proxy.test.ts`, satisfies **AC-8**
5. Sign up with a password, end to end: `signUp` action with typed result and the Zod schema, the `/sign-up` page on React Hook Form with the consent box and the inbox state, local config (`enable_confirmations`, length 8, template paths), bilingual `confirmation.html` with the hand built token hash link, the `readMail` Mailpit helper in `e2e/`, the AC-1 Playwright test (link opened in a fresh browser context, rows asserted through a service client), satisfies **AC-1**, **AC-11**, **AC-13**
6. Onboarding page: `/app/onboarding` with the company name (prefilled from metadata) and consent, `completeOnboarding` action in the fixed order (accept terms, locale, `ensureOrganization`), submit disabled while pending, `already_member` mapped to success, the AC-8 onboarding and double submit tests, satisfies **AC-5** (local half), **AC-8**, **AC-11**
7. Sign in rebuilt on the typed pattern: `signIn` moves to `useActionState` with React Hook Form, generic and unconfirmed states with `resendConfirmation` (`auth.resend({ type: 'signup' })`), the `link_expired` state mapping each `type` to its resend action, the seeded role tests updated, satisfies **AC-3**, **AC-12**
8. Email code, end to end: `requestCode` on both forms (`signInWithOtp`, `shouldCreateUser` by purpose, no password on the code path), the `/verify-code` page on the shadcn `input-otp` primitive (plus its `/admin/design` gallery section) with an editable email field, `verifyCode` with `type: 'email'`, bilingual `magic_link.html` with `{{ .Token }}`, `otp_expiry` 900, the AC-2 and AC-4 Playwright tests, satisfies **AC-2**, **AC-4**
9. Password reset, end to end: `/forgot-password` and `/reset-password` pages, `requestPasswordReset` and `updatePassword` (always `signOut({ scope: 'others' })` after the update), bilingual `recovery.html`, the AC-6 test with a second browser context, satisfies **AC-6**
10. Sign out and sessions: `signOut` with `scope: 'local'`, the AC-7 test asserting the cookies are gone and the AC-9 test with the second navigation, satisfies **AC-7**, **AC-9**
11. Invite script: `scripts/invite-user.mts` and the `user:invite` package script (`admin.createUser` with `app_metadata.role`, `email_confirm: false` and the locale metadata, then `inviteUserByEmail` with `redirectTo` = `confirmRedirectUrl(locale, '/reset-password')`), bilingual `invite.html`, README section, the AC-10 tests including the smuggled role, satisfies **AC-10**
12. Google and Microsoft: `signInWithProvider` on the action client, `/api/auth/callback` (missing verifier cookie and unconfirmed email handled), provider buttons on sign in and sign up, `config.toml` provider blocks off by default, the staging setup checklist (Google Cloud, Entra, dashboard secrets, an unverified personal Microsoft account) in `docs/auth.md`, hand verification on staging, satisfies **AC-5**
13. Hosted configuration and templates: Resend domain and SMTP on staging and prod, the five templates pasted, confirmations, password rules and leaked password protection on; `bilingual email_change.html` for completeness; axe over every new page in `e2e/auth.spec.ts`, satisfies **AC-1**, **AC-6**, **AC-13**

## Consequences

**Positive**:
- Real accounts from day one with the tenant on the session, so features 8 and up never special case a user without an organization.
- Three sign in methods with one page, one helper and one error map; adding passkeys later touches the page and the helper only.
- Staff onboarding is a repeatable script, reused by feature 16's invitation UI and safe against role smuggling.
- Consent is recorded on every path before FADP becomes feature 14's problem.
- Audit logs on `profiles` and `organization_members` are not negotiable under FADP and already exist; this feature adds no unlogged access control write.

**Negative / tradeoffs**:
- Google and Microsoft cannot run on the local stack, so AC-5 is verified by hand on staging every time the callback or the helper changes, and two provider consoles must be maintained per environment.
- Auth emails are bilingual in one template, so every recipient reads two languages until feature 7 moves auth mail to the send email hook with per user templates.
- Confirmation before first sign in adds one email round trip to the funnel; deliverability of the Resend domain becomes a sign up blocker, watched through feature 7's failed send visibility.
- The email dependent Playwright tests run only against the local stack, so the deployed e2e job covers password sign in and gating but not sign up, codes or resets until a local stack e2e lane exists in CI.
- Sessions never time out on their own; an ops laptop left signed in stays signed in until feature 12 adds MFA and a session policy.

**Neutral**:
- The scaffold sign in moves from redirect with an error query to the typed result pattern; `e2e/helpers.ts` and `tests/roles.test.ts` adjust.
- A new shadcn primitive (`input-otp`) enters the gallery and `docs/design.md`.
- `docs/auth.md` becomes the place for the per environment auth setup (providers, SMTP, templates, invite script).
- Five new routes in the typed map, identical in both languages like `/sign-in`.

## Follow-up

- [ ] Feature 7 (email): decide whether auth mail moves from Resend SMTP with bilingual templates to the Supabase send email hook with React Email in the user's language; keep the template files as the fallback either way.
- [ ] Feature 12 (ops admin): TOTP enrollment and an `aal2` check in the proxy for `/admin`; an inactivity cutoff for ops sessions.
- [ ] Feature 13 or 15 (launch): switch on the Supabase custom auth domain per project so the Google consent screen and email links show `sme24.ch`.
- [ ] Feature 8 or 15: revisit bot protection (Cloudflare Turnstile through Supabase captcha) once the research quota shows abuse; the Vercel firewall rules from spec 0001 are still to set.
- [ ] Feature 14 (legal): point the consent links at the real terms and privacy pages, add a terms version beside `terms_accepted_at`, and cover re consent when the version changes.
- [ ] Feature 16 (experts): reuse the invite script's path (invite, role, confirm handler) behind an ops UI, and record the expert's own consent at first sign in.
- [ ] A later account feature: name, language and password change, and sign out everywhere (`scope: 'global'`).
- [ ] CI: add an e2e lane against the local stack (the `database` job already starts it) so the Mailpit backed tests run on every push, not only locally.
- [ ] Spec 0002 follow up closed by this feature: sign up passes `full_name` and `locale` as user metadata and calls `create_organization` after the first confirmed sign in, with a Playwright test asserting the organization claim.
- [ ] `/sync`: root `AGENTS.md` gains the `pnpm user:invite` command, the rule that role changes happen only through the invite script or the service client, and a pointer to `docs/auth.md`.

## Rationale

Reasoning, options considered and the decision detail: see [rationale.md](rationale.md).
