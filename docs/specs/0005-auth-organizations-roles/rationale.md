# 0005. Auth, organizations and roles: rationale

The decision record behind [index.md](index.md). `/develop` reads the index; this file holds the why.

## Context

> ⚠️ Premise note: three sign in methods in the walking skeleton is wider than the scope row asked for ("real sign in from day one"). Password plus code run entirely on the local stack; Google and Microsoft need a console app per environment and can only be verified on staging. That is not wrong for a Swiss B2B audience on Microsoft 365, but it is the part most likely to drag. The build plan therefore puts the providers last, so the slice ships on password and code alone if the console setup is still pending, and the provider milestone lands as its own thickening.

Feature 6 is the first slice that real people touch. The stack decision (spec 0001) chose Supabase Auth with cookie sessions, put the app role under `app_metadata` through a custom access token hook, and made the request proxy gate the three areas by that claim. The data model (spec 0002) added organizations, memberships, the organization claim and `create_organization`, and left two things explicitly to this feature: the sign in methods and how a client ends up inside an organization. The scaffold has a password sign in page that works for the four seeded users and nothing else: no sign up, no confirmation, no reset, no way to make an expert or an ops account except the seed.

The forces: pilot clients arrive from a free benchmark and must reach `/app` without a person in the loop, so sign up is public and self serve; experts and ops are your own people and contractors and must never be able to sign up into those roles; three user types share one database, so the role and the tenant must be on the session before any page renders; Swiss data protection (revised FADP, GDPR readiness for EU clients) means the sign up form collects personal data and needs a consent record; and everything is German and English from the first screen, including email. The team is one engineer with AI help, so every extra vendor, console or template is a maintenance line that stays forever.

Not deciding leaves the scaffold's password only sign in as the de facto product: no self serve funnel, seeded staff only, and every later feature inventing its own idea of "a client with no organization yet".

## Options considered

### Option 1: Supabase Auth, password only, organization created at sign up

Keep the scaffold's password sign in, add sign up, confirmation and reset, and create the organization in the sign up action. The smallest surface that meets the scope row.

**Pros**:
- Fewest moving parts, fully testable on the local stack, no provider consoles.
- The scaffold, the seed and the Playwright helper already work this way.

**Cons**:
- Companies on Microsoft 365 or Google Workspace get a password they will forget; reset traffic becomes the support load.
- Creating the organization inside the sign up action runs before the email is confirmed, so every junk sign up leaves a tenant behind.

### Option 2: Supabase Auth with password, email code and Google plus Microsoft; confirmation required; organization at the first confirmed sign in (chosen)

Sign up collects the company name and keeps it in user metadata; the first confirmed sign in (link, code, or provider callback) runs `create_organization` and refreshes the token. Provider sign ups, which carry no company name, go through an onboarding page. Staff are invited by a script with the role fixed. Supabase sends all auth mail through Resend SMTP with bilingual templates.

**Pros**:
- Every method ends in the same helper, so organization creation and consent have one implementation.
- Confirmation before creation means only real people own tenants.
- Reuses the stack you already run: no new auth vendor, no new session model, RLS and the claims from spec 0002 untouched.

**Cons**:
- Providers need a Google Cloud client and an Entra registration per Supabase project and cannot run locally.
- Bilingual templates stack two languages in every email until a per user sender exists.
- More pages and more error states than Option 1, so a bigger slice.

### Option 3: A hosted identity provider (Clerk, WorkOS or Auth0) in front of Supabase through third party auth

Move sign up, sign in, providers, MFA and organizations to a hosted identity product and let Supabase accept its tokens.

**Pros**:
- Polished, localized sign in screens, organizations and invitations out of the box, MFA and SSO ready for enterprise clients.
- Provider and template maintenance moves to the vendor.

**Cons**:
- A second identity system beside Supabase Auth: two user records, a mapping for the role and organization claims, and the hook from spec 0002 rewritten around foreign tokens.
- Another data processor outside Switzerland to list in the privacy policy and cover with an agreement.
- Per user pricing on top of Supabase, for a walking skeleton with a handful of pilot clients.

Rolling your own auth was not considered; spec 0001 already settled on a proven service, and a custom session or token scheme is the one failure pattern this stack is designed to avoid.

## Rationale

Option 2 fits the forces better than the simpler Option 1 because the audience is not consumers. Swiss SMEs on Microsoft 365 expect the Microsoft button, and a six digit code is the cheapest way to keep a client who forgot a password moving, which matters when the funnel starts from a free benchmark. The extra surface is contained: one helper (`finalizeSignIn`) owns what happens after any method succeeds, one error map owns the messages, and the confirm and callback handlers are thin. Creating the organization at the first confirmed sign in rather than in the sign up action is the difference between junk tenants and none, and it makes provider sign ups (no form, no company name) a first class path through the same onboarding page rather than a special case.

Option 3 was rejected on operational reality, not capability: it adds a second identity system to a one engineer team, another processor under FADP, and a rewrite of the access token hook that spec 0002 just tested to the row. The things it offers that Option 2 lacks (MFA, SSO, invitation UI) are follow ups on features 12 and 16 and Supabase Auth supports each of them natively.

The smaller calls follow the same line. Supabase keeps sending the auth emails because moving them to your own sender pulls feature 7 (templates, Resend SDK, failed send visibility) into this slice; Resend SMTP is a dashboard setting on a domain feature 7 needs anyway, and the bilingual template is the honest Swiss default until a per user sender exists. Consent lives on `profiles` as a timestamp written once by the trigger or a null only function, because the column must not be user writable and the same record must exist for provider sign ups that never saw the form. The invite script uses the Supabase invite email rather than a temporary password so no credential travels through chat, and it sets the role on the profile (the source the hook reads) and in `app_metadata` (what the dashboard shows). Password rules stop at length 8 plus the leaked password check because composition rules add support tickets and no security. No MFA, captcha or custom auth domain now: each is a toggle or a small feature later, and none blocks the pilot.

Decisions made with full design context, each with the runner up:
- **Confirm handler under `/api/auth/confirm` and the provider callback under `/api/auth/callback`**: spec 0001 keeps route handlers unlocalized under `/api`; the locale travels in `next`. Runner up: localized `/[locale]/auth/confirm` pages, which would render and need messages for a page nobody sees.
- **`finalizeSignIn` as one server side helper**: the only way three methods and two handlers agree on organization creation and redirects. Runner up: repeat the logic in each action.
- **Provider users' locale and name**: the onboarding action writes the page locale through the existing column grant, and `handle_new_user` falls back to the provider's `name` metadata. Runner up: a profile update in the callback handler, which does not know whether the profile is new.
- **`otp_expiry` 900 seconds**: fifteen minutes fits a code typed from a phone; the scaffold's hour is longer than a code deserves. Runner up: 600 seconds.
- **Always `signOut({ scope: 'others' })` after a password update**: whether Supabase revokes the other sessions itself depends on settings and versions; the app owns the behavior AC-6 asserts. Runner up: rely on the platform and verify at build time, which leaves a test asserting something the app does not control.
- **Email links built by hand in the templates** (`{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=…&next={{ .RedirectTo }}`): the token hash is verified by the handler in any browser, so a link opened on a phone works. Runner up: `{{ .ConfirmationURL }}`, which issues a PKCE code only the requesting browser can exchange.
- **`ensureOrganization` as the single writer, automatic on the first confirmed sign in, the onboarding page as the fallback**: keeps the interview decision (no extra click for password and code sign ups) with one code path for the write, and turns a failure after the token is minted into a prefilled page rather than an error. Runner up: the cross check's proposal to always show the onboarding page, one click more on every path.
- **Invite through `admin.createUser` then `inviteUserByEmail`**: the invite call accepts no `app_metadata`, so the role must exist before the profile trigger fires. Runner up: invite first and patch the role after, which races the invitee.
- **Email dependent Playwright tests skip on a deployment URL**: the Vercel e2e job has no mail catcher. Runner up: mint links through the admin API in tests, which would never exercise the templates.
- **Auth pages are `noindex`**: the marketing layout's metadata does not apply; the pages set `robots: { index: false }`. Runner up: leave them indexable, which puts a sign in page in search results.
- **PostHog**: one server side `user_signed_up` capture in `finalizeSignIn` when an organization is created, with the method as a property; feature 15 owns the full taxonomy. Runner up: no event until feature 15, which loses the pilot funnel data.
- **Route slugs identical in both languages** (`/sign-up`, not `/registrieren`): spec 0004 keeps sign in and the areas identical and only localizes marketing slugs. Runner up: German slugs, which would diverge from `/sign-in`.

## Cross check

An independent model read the draft (2026-09-05). Its findings on the invite call, session revocation, the `otp_disabled` answer, the template link shape, the PKCE verifier cookie, the onboarding order, the passwordless code path, the proxy order and the smaller sourcing gaps were applied above and in the index. Three findings were declined on purpose:

- A signed cookie for the email on `/verify-code`: the query parameter plus an editable field is enough, since a code is useless to anyone but the mailbox owner.
- Raising the local `email_sent` rate limit: it applies only with custom SMTP, which the local stack does not use.
- `prefetch={false}` on auth links against the refresh race: the ten second refresh token reuse interval exists for that case; the AC-9 test gains a second navigation instead.

One note kept for reviewers: under Supabase's email rate limits a real address and an unknown one can differ in timing on repeated sign ups. Not exploitable at pilot scale, not a bug.
