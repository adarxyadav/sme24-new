# Verify, fix/provider-callback-locale (auth redirect fixes), 2026-09-06

**Mode**: `/check verify` (runtime proof on the local stack)
**Scope**: the two commits on the branch, 2962407 (provider callback lands staff on their role home) and f70de63 (emailed sign in link lands staff on their role home), against spec 0005 AC-5 and AC-13
**Verdict**: FAIL on the gate, PASS on every runtime case

## Summary

Every emailed link now carries the bare locale root as `next`, and every role lands on its own home: ops on `/de/admin`, expert on `/en/expert`, client on `/de/app`, a fresh sign up on `/de/app` with its organization created, the password reset on `/de/reset-password`. The six digit code path still works for ops. All six cases were driven in a real browser against the running dev server on port 3000, with the mails read from Mailpit and the landing pages screenshotted.

The gate still fails because the repo's own auth e2e suite is red on this branch. One of the two failures is this branch's doing: the sign up test at `e2e/auth.spec.ts:96` still expects the confirmation link to contain `/de/app`, which the second commit deliberately changed to the bare locale root. That assertion needs the same update as the code before a PR, or CI's e2e job will fail. The other failure predates the branch and is not caused by it (details below).

The provider callback could not be exercised locally (no Google or Microsoft on the local stack). Its Vitest suite passes, and the hand check on staging stays owed.

## Runtime cases (emailed link, AC-5 and AC-13)

Driven by a scratch Playwright spec (serial, one worker) against `http://localhost:3000`, the user's `pnpm dev` on this checkout. Mails were read through the Mailpit search API on port 54324, each link opened in a fresh browser context, and the landing URL asserted. Evidence files live in the session scratchpad under `evidence/` (one `.mail.txt` and one `.png` per case).

| Case | Steps | Mail (subject, type, `next`) | Landed on | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Ops seed on `/de/sign-in`, "Stattdessen einen Code per E-Mail erhalten", open "Per Link anmelden" in a fresh context | "Ihr Anmeldecode · Your sign in code", `magiclink`, `http://localhost:3000/de` | `/de/admin` (screenshot shows the German Ops Admin home, signed in as ops@example.com) | PASS |
| 2 | Expert seed on `/en/sign-in`, "Email me a code instead", open "Sign in with the link" in a fresh context | same subject, `magiclink`, `http://localhost:3000/en` | `/en/expert` (screenshot shows the English Expert area, signed in as expert@example.com) | PASS |
| 3 | Client seed on `/de/sign-in`, request the code, open the link in a fresh context | same subject, `magiclink`, `http://localhost:3000/de` | `/de/app` | PASS |
| 4 | New address on `/de/sign-up`, code path (no password), open the confirmation link in a fresh context | "Bestätigen Sie Ihre E-Mail · Confirm your email", `signup`, `http://localhost:3000/de` | `/de/app`; service client rows: `profile.role = client`, organization "Verify AG", one `owner` membership, `terms_accepted_at` set | PASS |
| 5 | Client seed on `/de/forgot-password`, "Link senden", open the link in a fresh context | "Passwort zurücksetzen · Reset your password", `recovery`, `http://localhost:3000/de/reset-password` | `/de/reset-password` | PASS |
| 6 | Ops seed on `/de/sign-in`, request the code, type the six digit code from the mail | same subject as case 1, the code from the mail body | `/de/admin` | PASS |

Every link starts with `http://localhost:3000/api/auth/confirm?token_hash=` and carries `type` and an absolute `next`. Cases 1 to 4 carry the bare locale root as `next`, case 5 carries `/de/reset-password`, exactly as the branch intends. The `next` value on the mails is itself the proof that the running server serves the branch code: on `main` the same links carry `/de/app`.

## Provider callback (AC-5)

Blocked locally: the local stack has no Google or Microsoft provider, so the callback was not driven. Covered by the regression suite instead:

```
pnpm vitest run tests/features/auth/provider-callback.test.ts tests/features/auth/confirm-link.test.ts
Test Files  2 passed (2)
Tests       15 passed (15)
```

The nine callback tests prove the locale travels on its own parameter, `next` is passed only when valid, ops and expert land on their homes, a client's valid `next` still wins, and error redirects keep the locale. **Owed to staging by hand**: sign in with Google as the invited expert and as ops, expect `/expert` and `/admin`; a new client still reaches onboarding. Record it on the spec's `verify.md` staging row when you do it.

## Commands

| Command | Result | Verdict |
| --- | --- | --- |
| `pnpm typecheck` | route types generated, `tsc --noEmit` clean | PASS |
| `pnpm lint` | Biome checked 311 files, no fixes | PASS |
| `pnpm test` | 71 files, 755 tests passed | PASS |
| `PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e auth` | 25 passed, 2 failed (see below) | FAIL |

The e2e ran against the running server on port 3000 because Next 16 holds a per directory dev lock, so the suite's own server on port 3100 cannot start in this checkout. The spec's `verify.md` records the same way of running it.

## Failing and owed

- **`e2e/auth.spec.ts:96`, stale assertion, caused by this branch.** The sign up test expects `decodeURIComponent(link)` to contain `/de/app`; the link now carries `next=http://localhost:3000/de` (the mail in the failure output shows exactly that). The behaviour is right, the test is behind. Recommended: update the assertion to the bare locale root (and let it still assert the landing on `/de/app`, which passes) in a third commit on this branch, then rerun the auth e2e. A one line test change; `/test` or `/develop` owns it, this check does not edit code.
- **`e2e/auth.spec.ts:562`, pre existing, not caused by this branch.** The invite test runs `pnpm user:invite` without `--locale` and expects `/de/reset-password`, but the script has defaulted to `en` since commit defeb42 (English as the default language, already on `main`), so the link lands on `/en/reset-password`. The branch's change to `buildConfirmRedirectUrl` is not involved: the invite path still names `/reset-password` and lands there. It shows up now only because the local stack is the only place this test runs (it skips on a deployment). Recommended: pass `--locale de` in the test, or expect `/en/`, in the same third commit or a separate small fix, your call.
- **Provider callback on staging** stays a hand check, as above.

## Cleanup

The fresh account from case 4 was deleted by the script, the e2e teardown sweep removed its own `@example.test` accounts, and a direct count afterwards found zero test users and only the two seed organizations. The seed users' passwords were not changed (case 5 stopped on the reset page). No scope box was ticked and no `verify.md` step was changed, since the gate did not pass.

## Next

1. Fix the two e2e assertions on this branch (the first is required, the second is optional but cheap), rerun `PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e auth`, expect 27 passed.
2. Rerun this check or, since the runtime cases are proven, just confirm the suite is green and open the PR into `main` titled "fix(auth): land staff on their role home after provider and emailed sign ins".
3. After the merge, do the staging hand check for Google as ops and expert.
