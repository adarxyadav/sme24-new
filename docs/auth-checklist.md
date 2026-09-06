# Auth smoke checklist (staging and production)

_Run by hand after every deploy that touches `src/features/auth/`, `src/proxy.ts`, `src/app/api/auth/` or the Supabase auth settings, and once on every new environment. Setup lives in [auth.md](auth.md); this file only proves the flows work. Tick one copy per environment._

**Environment:** ☐ staging ☐ production · **App URL:** `__________` · **Supabase project:** `__________` · **Date / by:** `__________`

## 0. Before you start

- [ ] The Supabase dashboard checklist in [auth.md](auth.md#hosted-projects-staging-and-prod-one-checklist-each) is complete (confirm email on, OTP 900 s / 6 digits, Site URL and redirect list, five templates pasted, access token hook on, SMTP through Resend, Google and Microsoft enabled).
- [ ] You have three inboxes you control: a fresh address per run (plus addressing works, e.g. `you+YYYYMMDD-a@…`), a Google account, and a Microsoft account. Without custom SMTP, Supabase's built in mailer only delivers to members of the Supabase organization and sends 2 emails per hour.
- [ ] Supabase allows one email per address per minute: use a new plus address for every email dependent step.
- [ ] Use a private window for each "open the link" step so the session cookie state is known.

## 1. Sign up with a password (AC-1, AC-11, AC-13)

- [ ] Open `/en/sign-up`, fill name, company, a fresh email, an 8+ character password, tick consent, submit → "check your inbox" state.
- [ ] The email arrives from `no-reply@<verified domain>` with the SME24 sender name, German above English, and its link starts with `<app URL>/api/auth/confirm?token_hash=` and carries `type=signup` and an absolute `next`.
- [ ] Open the link in a private window → lands on `/en/app`.
- [ ] Supabase Studio: the profile has `role = client`, `terms_accepted_at` set, one organization with the entered name, one `owner` membership.
- [ ] Repeat once on `/de/sign-up` → the email and the landing page are German.

## 2. Sign up with a code (AC-2)

- [ ] On `/en/sign-up` press "Email me a code instead" → the password field disappears; submit with a fresh email → `/en/verify-code?email=…`.
- [ ] The confirmation email prints a six digit code; enter it → `/en/app` with the organization created as in step 1.
- [ ] A wrong code shows "the code is wrong or expired" and the page stays.

## 3. Sign in (AC-3, AC-4)

- [ ] Email and password for the user from step 1 → `/en/app`.
- [ ] `/en/sign-in?next=%2Fen%2Fapp%2Fonboarding` as that user → the `next` path is honoured (then bounced to `/en/app` because the organization exists).
- [ ] "Email me a code instead" on the sign in page with the same address → magic link email with a code → `/en/app`.
- [ ] The same request for an unknown address → same "check your inbox" page, no email arrives.
- [ ] Wrong password → one generic message, no hint whether the address exists.

## 4. Google and Microsoft (AC-5)

- [ ] Google, new account → consent screen shows the SME24 name and policy links → `/en/app/onboarding`; name the company, tick consent → `/en/app`; Studio shows the organization and `terms_accepted_at`.
- [ ] Microsoft work account, new → same path as Google.
- [ ] Microsoft personal account with an unverified email → signed out again with the "email unverified" message (known edge, no fix needed).
- [ ] Existing user from step 1 signs in with a Google account of the same address → lands on `/en/app`, no second organization.

## 5. Forgot and reset password (AC-6)

- [ ] `/en/forgot-password` with the step 1 address → "check your inbox"; with an unknown address → same page, no email.
- [ ] Follow the link → `/en/reset-password`; save a new password → `/en/app`.
- [ ] A second browser that was signed in as that user is signed out on its next request; the old password no longer works.

## 6. Invite staff (AC-10)

- [ ] `vercel env pull .env.local --environment=<preview|production>` then `pnpm user:invite --email <fresh> --role expert --locale de` → prints "invited … as expert".
- [ ] The invite email arrives; its link opens `/de/reset-password`; after saving a password the user lands on `/de/expert`.
- [ ] Studio: profile role and `app_metadata.role` are `expert`.
- [ ] Repeat with `--role ops` → lands on `/de/admin`.
- [ ] The invited expert signs in with a Google account of the same address → still `/de/expert`, role unchanged.
- [ ] Open the used invite link again → `/de/sign-in?error=link_expired&type=invite` with the "ask your administrator" note and no resend button.

## 7. Sign out, gating and sessions (AC-7, AC-8, AC-9)

- [ ] User menu → sign out → marketing home, no `sb-*` cookies; `/en/app` → `/en/sign-in?next=%2Fen%2Fapp`.
- [ ] Signed out: `/en/expert` and `/en/admin` → sign in with `next`.
- [ ] Signed in as client: `/en/admin` → `/en/forbidden`; `/en/sign-in`, `/en/sign-up`, `/en/verify-code`, `/en/forgot-password` → `/en/app`.
- [ ] Signed in as expert: `/en/app` → `/en/forbidden`; as ops: `/en/admin/design` renders.
- [ ] Stay signed in for more than one hour (or reopen the tab the next day) → `/en/app` still renders without a sign in prompt, and a second navigation right after also renders.

## 8. Expired and used links, rate limits (AC-12)

- [ ] Open the step 1 confirmation link a second time → `/en/sign-in?error=link_expired&type=signup` with a resend button.
- [ ] Sign up a fresh address, leave its link unopened, open the link with a changed `token_hash` → same expired state; enter the email, press resend → a fresh confirmation arrives.
- [ ] Sign in as an unconfirmed account with the right password → "email not confirmed" with a resend button.
- [ ] Sign up again with an already confirmed address → "check your inbox" state and no email to the existing account.
- [ ] Request a code twice within a minute → the wait message, no error page.

## 9. Delivery and monitoring

- [ ] Resend, Emails: every auth email of this run shows `delivered`, none `bounced` or in spam at the test inbox.
- [ ] Supabase, Authentication, Logs: no `5xx` on `/auth/v1/verify`, `/auth/v1/otp` or `/auth/v1/callback` during the run.
- [ ] Sentry: no new auth event from this run (the confirm handler never answers 500 after a verified token).
- [ ] Every page above passes in both `/en` and `/de` and `html lang` matches the prefix.

## 10. Clean up

- [ ] Delete the test users in Supabase, Authentication, Users (their organizations, memberships and profiles cascade); keep the invited staff only if they are real accounts.
- [ ] Revoke any client secret or API key created only for this run.

**Result:** ☐ all green ☐ failures noted below

Failures (step, expected, observed, link to the issue):
