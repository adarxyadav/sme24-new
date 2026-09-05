# Verify: Auth, organizations and roles · spec 0005 · updated 2026-09-05
_Steps derived from spec 0005 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones. Local stack: `supabase start`, `pnpm dev`, emails in Mailpit at http://127.0.0.1:54324. Use a fresh address per run (one email per address per minute)._

## UI / manual
- [ ] Open `/de/sign-up`, fill name, company, email, an 8+ character password, tick the consent box, submit → "Prüfen Sie Ihren Posteingang"; Mailpit holds one email, German above English → AC-1, AC-13
- [ ] Open the confirmation link in another browser (or a private window) → lands on `/de/app`; in Studio the profile has `role = client`, `terms_accepted_at` set, one organization with the entered name, one `owner` membership → AC-1, AC-11
- [ ] Open the same link again → `/de/sign-in?error=link_expired&type=signup` with the expired notice and a "Neue E-Mail senden" button; type the email and press it → a fresh confirmation arrives → AC-12
- [ ] On `/de/sign-up` press "Stattdessen einen Code per E-Mail erhalten" → the password field disappears; fill the rest and submit → `/de/verify-code?email=…`; the confirmation email prints a six digit code; enter it → `/de/app`, organization created as above, no password on the account (a password sign in fails) → AC-2
- [ ] Sign in as `client@example.com`, `expert@example.com`, `ops@example.com` with the seed password → `/de/app`, `/de/expert`, `/de/admin`; sign in as ops from `/de/sign-in?next=%2Fde%2Fadmin%2Fdesign` → lands on the design gallery; from `/de/sign-in?next=%2Fen%2Fadmin` → lands on `/de/admin` (a foreign prefix is ignored) → AC-3
- [ ] On `/en/sign-in` enter `client2@example.com` and press "Email me a code instead" → `/en/verify-code`; the magic link email prints the code; enter it → `/en/app`. Repeat with an unknown address → the same code page, Mailpit holds nothing new → AC-4, AC-12
- [ ] Staging by hand: sign in with a new Google account → `/app/onboarding`, name the company, tick consent → `/app` with an organization; a Microsoft work account does the same; the invited expert with the matching Google address lands on `/expert` → AC-5
- [ ] `/de/forgot-password` for a confirmed client → inbox state (also for an unknown address, which gets no email); follow the link → `/de/reset-password`; save a new 8+ password → `/de/app`; a second browser that was signed in as that user is signed out on its next request; the old password no longer works → AC-6
- [ ] User menu → "Abmelden" → marketing home, no `sb-*` cookies left; open `/de/app` → `/de/sign-in?next=%2Fde%2Fapp` → AC-7
- [ ] Signed out: `/de/app`, `/en/expert/x`, `/de/admin` → sign in with `next`; signed in as client: `/de/admin` → `/de/forbidden`; `/de/sign-in`, `/de/sign-up`, `/de/verify-code`, `/de/forgot-password` → `/de/app`; a client without an organization (create one through Studio or the admin API without metadata): `/de/app` and `/de/app/anything` → `/de/app/onboarding`; after onboarding `/de/app/onboarding` → `/de/app` → AC-8
- [ ] Sign in, reload, open a new tab, wait past the access token expiry (or rewrite `expires_at` in the `sb-*-auth-token` cookie to the past) → `/de/app` still renders and the cookie value changed; a second navigation right after still renders → AC-9
- [ ] Submit the onboarding form twice quickly → one organization, landing on `/app` → AC-5, AC-8
- [ ] Sign in with a wrong password → one generic message; sign in as an unconfirmed account with the right password → "E-Mail noch nicht bestätigt" and a resend button; a sign up with `client@example.com` → inbox state and no email → AC-12
- [ ] Every new page in `/de` and `/en` reads in that language, `html lang` matches, and axe reports no violations (the e2e suite does this) → AC-13

## Commands
- [ ] `pnpm test:db` → 250 pgTAP tests pass, including `accept_terms.test.sql` (column grant, null only write, anon refused) → AC-11
- [ ] `pnpm test` → the proxy suite passes: auth page bounce, onboarding rule, refreshed cookies kept on redirects → AC-8
- [ ] `PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e` (with `pnpm dev` running and `.env.local` holding the local keys) → `e2e/auth.spec.ts` green: 24 tests over AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13
- [ ] `pnpm user:invite --email <fresh> --role expert` → prints "invited … as expert"; the profile role and `app_metadata.role` are `expert`; the invite email's link opens `/de/reset-password`; after saving a password the user lands on `/de/expert`; the used link shows the "ask your administrator" note without a resend button → AC-10
- [ ] `curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H 'content-type: application/json' -d '{"email":"<fresh>","password":"12345678","data":{"role":"ops"},"app_metadata":{"role":"ops"}}'` → the profile role is `client` → AC-10

## Value sourcing checks
- [ ] Role of a new account: the smuggled role step above still yields `client`; the invite step yields `expert` → "the app role of the new account"
- [ ] Organization name and full name: the row matches the sign up form; a provider style account (created without metadata, `name` only) gets `full_name` from `name` and the onboarding form's company name → "organization name", "full name"
- [ ] Profile locale: sign up on `/en/sign-up` → `profiles.locale = en`; onboarding completed on `/de/…` for a metadata free account → `de` → "profile locale"
- [ ] Consent: a password sign up has `terms_accepted_at` equal to the sign up moment (trigger copy); onboarding stamps `now()`; calling `accept_terms()` twice leaves the first value; a direct `update profiles set terms_accepted_at` as the user fails with permission denied → "terms_accepted_at"
- [ ] Organization claim: after confirmation the access token carries `app_metadata.organization_id` (the proxy admits `/de/app`); the seeded client stays admitted → "organization claim after creation"
- [ ] Prefilled company: a confirmed sign up whose organization creation failed lands on onboarding with the company field prefilled from the metadata; a metadata free account sees it empty → "the prefilled company name"
- [ ] Link expired resend: `type=signup` offers the confirmation resend, `type=magiclink` or `email` sends a code and goes to `/verify-code`, `type=recovery` sends a reset link, `type=invite` shows the administrator note only → "which resend action to offer"
- [ ] Landing path: `next` inside the locale prefix is honoured, a foreign prefix or absolute URL falls back to the role home → "landing path"
- [ ] Error locale: open a confirm link whose `next` is `http://localhost:3000/en/app` with a spent token → `/en/sign-in?error=link_expired…`; a link without `next` → `/de/…` → "the locale of an error redirect"
- [ ] Templates: every link in Mailpit starts with `http://localhost:3000/api/auth/confirm?token_hash=` and carries `type` and an absolute `next`; the confirmation and magic link emails print a six digit code → "the link and the code"
- [ ] Verify code email: change the email on `/verify-code` to another address → the code for the original address is refused → "which email the code belongs to"
- [ ] Error mapping: a wrong code shows "Der Code ist falsch."; an expired code (after 15 minutes) shows the expired message; an unknown code lands on the generic message and a Sentry event locally logs → "error state to show"
- [ ] Invite locale: `pnpm user:invite … --locale en` → the link opens `/en/reset-password` → "role and locale of the invitee"
- [ ] Proxy organization check: with the organization claim removed from the token (a client whose membership row is deleted, then a refresh) `/de/app` sends the client to onboarding → "whether a client has an organization"

## Acceptance-criteria coverage
- AC-1 sign up steps 1 and 2, e2e · AC-2 code sign up step, e2e · AC-3 seeded sign in step, e2e · AC-4 code sign in step, e2e · AC-5 staging by hand (providers) plus onboarding e2e for the local half · AC-6 reset step, e2e · AC-7 sign out step, e2e · AC-8 gate step, proxy unit tests, e2e · AC-9 session step, e2e · AC-10 invite and smuggled role commands, e2e · AC-11 pgTAP and the row checks · AC-12 error state steps, e2e · AC-13 both languages and axe, e2e
