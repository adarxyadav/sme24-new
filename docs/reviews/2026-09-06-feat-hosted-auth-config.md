# Review, feat/english-default (hosted Auth config as code), 2026-09-06

**Reviewed by**: Opus 5 (author on a different model)
**Scope**: 5 files, uncommitted
**Verdict**: Changes requested

## Summary

The change moves hosted Supabase Auth settings out of the dashboard and into `supabase/config.toml`, applying them with `supabase config push` in the migrate job. The diagnosis is right (Supabase defaults `otp_length` to 8, the app renders six boxes, and the hosted project had never been configured from the repo), the direction is right (config as code beats a checklist nobody re-runs), and the skip-instead-of-fail gating follows the pattern already in the workflow.

The problem is the blast radius of the mechanism the change introduces. `config push` sends the whole `[auth]` tree, not just the keys the author thought about, and the `[remotes.staging]` block overrides only four of them. Several base values that are correct locally and harmful hosted are left unoverridden, one of them a security setting (`skip_nonce_check = true` on Google) and one of them a functional regression that silently disables the fix this change exists to ship (`max_frequency`/`email_sent` interplay is handled, but `[auth.email] max_frequency` is overridden while the far more damaging `jwt_expiry`, sms and mfa blocks are not). Separately, the SMTP password the gating logic is built to protect is very likely never transmitted at all, which makes both the gate and its justifying comment wrong.

## Blockers

### 🔴 Google `skip_nonce_check = true` is pushed to the hosted project, `supabase/config.toml:363`

**Problem**: The base `[auth.external.google]` block sets `skip_nonce_check = true` with the comment "Required for local sign in with Google." `[remotes.staging]` does not override it, and `config push` sends the merged tree, so staging receives `skip_nonce_check = true`. The commented-out `[remotes.staging.auth.external.google]` template at line 501 does carry `skip_nonce_check = false`, which shows the author knew the value must flip, but that block is commented out, so today's push sends `true`.

**Why it matters**: Supabase's own documentation calls disabling the nonce check a "short-lived troubleshooting workaround" that "weakens replay-attack protection" and says to enable it "only in the environment where you're debugging." This is a security control being silently relaxed on a hosted project by a config file whose stated purpose is to be authoritative. It is worse than the dashboard drift the change is fixing, because a reviewer reading `docs/auth.md` sees the checklist say `skip_nonce_check = false` and would not suspect the pushed value is `true`. It bites the moment Google is enabled, and nothing in the deploy log flags it.

**Suggested fix**: Add `skip_nonce_check = false` to a `[remotes.staging.auth.external.google]` block that is live rather than commented out (the provider can stay `enabled = false` there; the override only needs to correct the nonce value). Alternatively flip the base to `false` and have developers set `true` in a local, git-ignored override, which keeps the insecure value out of the file that gets pushed.

### 🔴 The gate protects a secret that `config push` does not send, `.github/workflows/deploy.yml:38-46`

**Problem**: The gating comment and `docs/auth.md:44` both assert that "Pushing without the password would blank the hosted SMTP credentials, so skip instead." Supabase's config-drift field registry lists `auth.email.smtp.pass` in `SECRET_CONFIG_FIELDS`, the set of paths "never pushed, compared, or displayed", stripped before any push or drift operation (alongside `auth.external.*.secret`, `auth.captcha.secret`, the hook secrets and the Twilio token). If the CLI's `config push` applies the same exclusion, the SMTP password is never transmitted, so `SUPABASE_AUTH_EMAIL_SMTP_PASS` cannot blank anything, and the whole premise of the gate is wrong.

**Why it matters**: Two concrete consequences, and they point in opposite directions, which is why this is a blocker rather than a doc nit. First, the gate blocks the fix: a maintainer who sets `SUPABASE_ACCESS_TOKEN` but not `SUPABASE_AUTH_EMAIL_SMTP_PASS` gets the "Auth config push skipped" notice and the 8-digit OTP bug persists, for a reason that does not exist. Second, and more serious, if the password genuinely is stripped then `[remotes.staging.auth.email.smtp] enabled = true` is pushed with no password behind it, and the hosted project is switched to custom SMTP it cannot authenticate against, breaking every auth email on staging, which is the exact surface this change is meant to repair. The change is currently shipping on an untested assumption about which of these two behaviours is real.

**Suggested fix**: Determine empirically which fields `config push` sends before merging, by running it once by hand against staging and reading the printed diff (the docs already describe this manual path at `docs/auth.md:49`). If the password is stripped, the SMTP password must be set once in the dashboard or via the management API, the gate should drop the `SUPABASE_AUTH_EMAIL_SMTP_PASS` condition, and both the workflow comment and `docs/auth.md` need rewriting. If it is sent, keep the gate and say so in the comment with the evidence. Either way the current comment states as fact something unverified.

## Major

### 🟠 `jwt_expiry`, `[auth.sms]`, `[auth.mfa]` and the other providers are pushed unoverridden, `supabase/config.toml:165, 273-333`

**Problem**: The remotes block overrides exactly four things: `site_url`, `additional_redirect_urls`, `rate_limit.email_sent` and `email.max_frequency`. Everything else under `[auth]` goes to staging as written for local development. That includes `jwt_expiry = 3600`, `[auth.mfa] max_enrolled_factors = 10` with TOTP and phone enrollment disabled, `[auth.sms]` with its `enable_signup = false`, the Twilio block, `[auth.external.apple]`, `[auth.web3.solana]`, `[auth.third_party.*]` and `[auth.oauth_server]`. The prompt asked specifically whether every key harmful when pushed is overridden; it is not.

**Why it matters**: Most of these happen to be benign or match the hosted default, but the change is asserting authority over the entire Auth surface without having audited it. `[auth.mfa.totp] enroll_enabled = false` is the sharp one: spec 0005 line 195 queues TOTP enrolment for ops in feature 12, and the moment someone enables it in the dashboard the next deploy silently switches it back off, with the file giving no hint that it owns that setting. That is precisely the dashboard-drift failure mode inverted, and it will be diagnosed slowly because the deploy log shows a successful push.

**Suggested fix**: Walk the `[auth]` tree once and, for each key, either confirm it is correct hosted or add an override. Where a value is deliberately left at the local setting because it matches the hosted default, say so in a comment so the next reader does not have to re-derive it. At minimum call out the MFA block so feature 12 is not surprised.

### 🟠 Production is wired to push nothing, and the empty-ref trick is fragile, `.github/workflows/deploy.yml:28, 64`

**Problem**: `PROJECT_REF` is `${{ github.ref_name == 'production' && '' || 'fxmdkvhououxakmyddwn' }}`. In GitHub Actions the `&&`/`||` idiom returns the right operand when the left is falsy, and `''` is falsy, so on the `production` branch this evaluates to the staging ref, not the empty string. The `[ -n "$PROJECT_REF" ]` guard therefore does not skip on production; it passes, and if the production environment ever carries `SUPABASE_ACCESS_TOKEN` and `SUPABASE_AUTH_EMAIL_SMTP_PASS`, a push to `production` would apply the staging remote block to the staging project.

**Why it matters**: This is a live footgun aimed at the wrong project. Today it is latent because no production Supabase project exists and the production environment has no secrets, so the `DB_URL` condition skips first. It stops being latent on the day production is created, which is exactly when nobody will be re-reading this ternary. The intent (skip on production) is defensible; the encoding does not express it. Note also that the ref is duplicated as a literal in two places in the workflow plus a third in `config.toml`, so a project change means three edits.

**Suggested fix**: Make the production branch skip explicitly rather than by relying on an empty string being falsy, for instance by testing `github.ref_name` in the `if:` condition of the push step, or by making the ref a per-environment GitHub variable so the value lives with the environment rather than in the workflow literal. Whichever is chosen, drop the duplicated literal so there is a single source for the ref.

### 🟠 `docs/email.md` now contradicts `docs/auth.md` on the sending domain, `docs/auth.md:41`

**Problem**: `docs/auth.md` states staging sends from `no-reply@send.akaiv.in`, "verified 6 Sep 2026", and `config.toml:492` hard-codes that `admin_email`. `docs/email.md:35` still reads "Blocked until there is DNS access to `sme24.ch`; until then staging may send from `SME24 <onboarding@resend.dev>` to the allowlist only." Both files are current and describe the same Resend account and the same environment.

**Why it matters**: The project convention is that `docs/email.md` owns the sending-domain facts and `docs/auth.md` links to it; the prompt names `email.md` as the source for those facts. A reader following the link now gets a stale answer, and the two files disagree about whether staging can mail non-team addresses at all. That matters operationally, because the allowlist question decides whether a tester outside the org receives the confirmation email this change is fixing.

**Suggested fix**: Update `docs/email.md` to record the verified `send.akaiv.in` domain and drop the `onboarding@resend.dev` fallback, so the two documents agree and `auth.md` can keep pointing at `email.md` for the domain.

## Minor

### 🟡 The site URL forecloses the staging domain the README still promises, `supabase/config.toml:471`

**Problem**: `site_url = "https://sme24.vercel.app"` is the raw Vercel deployment host, while `README.md:120` still instructs the operator to "assign `staging.<domain>` to `main`". If that assignment is ever made, the site URL silently points at the wrong host and confirmation links go to the Vercel URL.

**Why it matters**: `site_url` is what the templates build every emailed link from, so a mismatch breaks confirmations rather than degrading gracefully. Low severity only because the custom domain does not exist yet.

**Suggested fix**: Either drop the `staging.<domain>` line from the README until it is real, or add a note at the site URL that it must move when the domain is assigned.

### 🟡 The preview wildcard is narrower than the one it replaced, `supabase/config.toml:472`

**Problem**: The removed comment described the wildcard as `https://*-<team>.vercel.app/**`; the new value is `https://*-adarxyzs-projects.vercel.app/**`. Vercel preview hostnames are not all of that shape, and branch-alias previews in particular can take other forms.

**Why it matters**: A preview whose hostname does not match the pattern cannot complete OAuth or a confirmation redirect, and the failure appears as a generic redirect error on that preview only, which is a slow thing to diagnose.

**Suggested fix**: Verify the pattern against an actual preview URL from the team, and widen it if branch aliases differ.

### 🟡 The CLI pin is exact in the workflow but a caret range in `package.json`, `.github/workflows/deploy.yml:52`

**Problem**: `setup-cli` pins `2.116.0` with a comment to "keep in step with the `supabase` dev dependency", but `package.json:84` declares `^2.116.0`, so a lockfile refresh moves the local CLI while CI stays put.

**Why it matters**: `config push` is now a deploy-time mutation of hosted Auth, so a version skew between the CLI a developer validates with locally and the one that runs in CI is a real correctness risk, not just tidiness. The comment claims an invariant the manifest does not enforce.

**Suggested fix**: Pin the dev dependency exactly, so the stated invariant holds.

### 🟡 The push is unverified after the fact, `.github/workflows/deploy.yml:67`

**Problem**: `config push --yes` runs and the job ends. Nothing asserts the hosted project ended up with `otp_length = 6`, which is the single value this whole change exists to correct.

**Why it matters**: The test signal is `configured`, but neither Vitest nor Playwright can cover a toml push, so the only available check is at deploy time. Given the change's own account of the bug (a setting silently at its default for days without anyone noticing), a deploy that reports success while the setting is wrong is a plausible repeat.

**Suggested fix**: No unit test is warranted here. Consider having the e2e sign-up flow assert the received code is six digits, so the regression that motivated this change is caught by the suite that already runs against every deployment.

## Nits

- ⚪ `supabase/config.toml:466`, the staging project ref is a literal here and in two places in `deploy.yml`; a single source would prevent them drifting.
- ⚪ `.github/workflows/deploy.yml:45`, the skip notice tells the reader to "give the branch a project ref in deploy.yml" but not that `config.toml` needs a matching `[remotes.<name>]` block, which is the half people forget.
- ⚪ `docs/auth.md:44`, "Without it the push would blank the SMTP password, so the step refuses to run" repeats the unverified claim from the blocker above and will need the same correction.
- ⚪ `supabase/config.toml:475`, the comment says "Raise here when staging needs more" directly under a value that is already the hosted default, which reads as if 30 were a local artefact.

## Test coverage

Correctly out of scope for unit tests: this is toml, yaml and prose, and the prompt rightly says not to demand Vitest coverage for it. The relevant gate is a deploy and a manual `config push` against staging with the printed diff read, which is what should settle the blocker about which fields are actually transmitted. The one cheap automated net available is the existing Playwright sign-up flow asserting a six-digit code, noted as a minor above; that would have caught the original bug and would catch its recurrence. No existing test changes behaviour as a result of this diff.

## Strengths

- The root-cause diagnosis is genuinely good and well recorded. Both `config.toml:463` and `docs/auth.md:47` capture the 8-versus-6 digit symptom, why it happens, and that the fix is a deploy rather than an app change, which is exactly the note that saves the next person an hour.
- Moving hosted Auth from a manual checklist to a pushed file is the right call, and the docs were rewritten to match rather than left as a stale checklist beside the new mechanism.
- The skip-with-a-notice gating follows the pattern already established for `DB_URL` and `TRIGGER_ACCESS_TOKEN` in the same workflow, so the file stays internally consistent, and the notices name the secret and the doc to consult.
- Secrets are handled correctly at the file level: `env()` indirection throughout, nothing literal in git, and the workflow passes the values through step `env` rather than interpolating them into the `run` script where they would risk landing in a log.
