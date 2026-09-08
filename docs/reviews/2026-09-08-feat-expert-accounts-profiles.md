# Review, feat/expert-accounts-profiles, 2026-09-08

**Reviewed by**: Claude Sonnet 5 (author on Claude Opus 5)
**Scope**: 105 files, branch vs `main` (merge base `8a177ec38e0ec48135d678643f98c9d6315f66d2`)
**Verdict**: Approve with nits

## Summary

This is a large, carefully built feature: a new `expert_profiles` table with a full state machine, a
private photo bucket, a definer view for client-visible summaries, an invite path shared between the
ops UI and the CLI script, three emails, and new UI across all three signed-in areas. The RLS design
is exemplary — every table, function, view and storage policy has a matching pgTAP file that proves
the exact scenario the spec claims (including the assign-during-deactivation race, the definer view's
owner, and the storage bucket's assignment-follows-access-window behaviour). The server actions
uniformly re-check authorization rather than trusting the proxy gate, matching the project's stated
rule. `verify.md` documents a real runtime bug (the 1 MB Next server-action body cap silently eating
photo uploads between 1–2 MB) that was found, fixed, and regression-tested. The main gap is that the
805-line `src/features/experts/actions.ts` — the file carrying the feature's authorization logic — has
no direct Vitest coverage; the spec's own "Critical test scenarios" call for exactly this (permission
checks, concurrency, invite failure branches) and it is missing. A few UX rough edges are worth a
look before merge but nothing here blocks it.

## Major

### 🟠 No unit tests for `src/features/experts/actions.ts`, `tests/features/experts/`
**Problem**: The spec's own "Critical test scenarios" table (`docs/specs/0013-expert-accounts-profiles/index.md`) calls for Vitest coverage of: an ops action called by a client answering `forbidden`; an expert sending `expertId` to `updateExpertProfile` answering `forbidden`; two simultaneous `assignExpert` calls answering one `ok` and one `already_assigned`; a double `completeExpertOnboarding` submit answering `ok` twice with one `onboarded_at`; and `inviteExpert`'s three failure branches (`already_invited`, `email_taken`, `invite_failed`). None of this exists. `tests/features/experts/` holds `catalogue.test.ts`, `form.test.ts`, `queries.test.ts`, `schema.test.ts` and four `ui/*.test.tsx` files, but no `actions.test.ts`. `tests/lib/auth/invite.test.ts` covers the shared `inviteStaffUser`/`resendStaffInvite` module well, but that module is one layer below the action — it does not exercise `requireOps`/`requireExpert`, the `expertId` self-write guard in `updateExpertProfile` (line 527), or the Postgres error-code mapping in `assignExpert` (`23505`/`23503`/`23514` at lines 371–375). The pgTAP suite proves the *database* enforces these rules independently of the action, which is real defense-in-depth, but it does not prove the action's own branch logic (e.g., that a caller who is `null` after `requireOps()` truly short-circuits before any Supabase call, or that `deactivateExpert`'s three-step idempotent sequence actually behaves correctly on a partial rerun).
**Why it matters**: This is the single highest-risk file in the branch — every ops-only and expert-only mutation flows through it, and it is also the file the review guide names explicitly for authorization inspection. RLS is the real boundary (confirmed above), but a regression in the action's own `forbidden` short-circuits (e.g., a future refactor of `requireOps`/`requireExpert` that drops the `typeof claims?.sub !== "string"` check) would not be caught by any test in this branch, only by whatever RLS still refuses — which is a much less specific signal than a unit test that names the exact scenario.
**Suggested fix**: Add `tests/features/experts/actions.test.ts` with a mocked Supabase client covering the scenarios the spec already lists: role-gate rejections for each ops-only and expert-only action, the `updateExpertProfile` `expertId`-sent-by-expert case, `assignExpert`'s three Postgres error codes, and `deactivateExpert`/`reactivateExpert` idempotency. This is `/test`'s job per the workflow, but it's worth flagging before merge since the spec itself calls it out as a required scenario and it did not land.

## Minor

### 🟡 Photo MIME type is trusted from the browser with no content sniffing, `src/features/experts/actions.ts:718-736`
**Problem**: `uploadExpertPhoto` validates `file.type` against `PHOTO_TYPES` (the browser-reported MIME type) and uses it to pick the object's extension, but never inspects the file's actual bytes. A crafted upload with a spoofed `Content-Type: image/jpeg` header could land content that is not a JPEG at the `<expert_id>/photo.jpg` path.
**Why it matters**: The bucket's own `allowed_mime_types` check (`supabase/migrations/20260907103500_expert_photo_bucket.sql`) is presumably also driven by the declared content type at upload time rather than sniffed bytes, so this is not caught a second time by the storage layer either. The risk is bounded — this is a private bucket, only the owner can write to it, and Storage typically doesn't execute served content — but a mismatched file (e.g., an SVG with embedded script served with an image content-type, or a much larger file than its declared size suggests) reaching a signed URL that renders as `<img>` is a plausible XSS/content-confusion vector depending on how strictly the CDN/browser trusts the served `Content-Type` versus sniffing.
**Suggested fix**: Consider a minimal magic-byte check (first few bytes match the JPEG/PNG/WebP signature) before upload, or note this as an accepted risk in the spec's Follow-up section if the team judges the private-bucket exposure low enough to skip it.

### 🟡 "Deactivate expert" has no confirmation step, `src/features/experts/ui/account-actions.tsx:92-101`
**Problem**: The deactivate button is a single `onClick` that immediately calls the action — no confirm dialog, no "type the expert's name to confirm," nothing between the click and ending every active assignment plus banning the sign-in.
**Why it matters**: This is one of the more consequential actions in the whole ops surface (it silently removes the expert from every client's "Your expert" card and bans their login for effectively forever), and the button sits next to "Resend invitation" and other low-stakes controls on the same page. A misclick during a busy ops session is entirely plausible, and while `reactivateExpert` exists as an undo path, it does not automatically restore the ended assignments, so a misclick is not free to reverse.
**Suggested fix**: Wrap the destructive button in a confirmation dialog (shadcn `AlertDialog` is already in the design system) naming the expert and the assignment count that will end.

### 🟡 `resendInvite`'s locale fallback silently defaults to English on an unreadable join, `src/features/experts/actions.ts:159-162`
**Problem**: `resendInvite` reads `profiles!expert_profiles_expert_id_fkey(locale)` and falls back to `"en"` if the joined value is not exactly `"de"`. If the join fails to populate for any reason (a null profile row, a schema drift), the ops user gets no signal that the locale guess was a fallback rather than the invitee's actual preference.
**Why it matters**: Low impact (the invite email would simply be in the wrong language), but it's a silent behavior rather than a surfaced one, inconsistent with the file's otherwise careful "log and report" discipline elsewhere.
**Suggested fix**: Optional — a `log.info` when the fallback path is taken would make a future "why did this invite go out in English" question answerable from the logs without a database query.

## Nits

- ⚪ `src/features/experts/actions.ts:527`, the `updateExpertProfile` "row not found" branch (line 553) answers `forbidden` for both an expert targeting a foreign row and ops targeting a nonexistent `expertId`; the latter reads more naturally as `not_found`, though the result type doesn't currently offer it and the UX impact is minimal since both are edge cases.
- ⚪ `src/lib/auth/invite.ts:58-62`, `createInviteClient` disables `autoRefreshToken`/`persistSession`/`detectSessionInUrl` inline at every call site rather than as a documented constant — fine as is, just noting there's no single place that would need updating if a fourth auth option were ever added.
- ⚪ `supabase/schemas/12_expert_assignments.sql:102-104`, `check_expert_assignable`'s early return for `client`/`expert` callers is explained thoroughly in the comment above it, but the comment is long enough (lines 85–92) that a reader skimming might miss that it's covering a genuinely subtle ordering fact about Postgres trigger vs. policy evaluation — worth keeping as is, just flagging it as dense.

## Strengths

- The RLS/storage/definer-function design is the standout of this branch: every access rule named in the spec's Security model has a corresponding pgTAP assertion, including negative cases that are easy to skip (an anonymous visitor, a deactivated expert with a still-active assignment row, the view's owner). `supabase/tests/expert_assignable.test.sql` in particular proves the exact concurrency race (deactivate-then-assign) the trigger exists to close, and does it for the service role too, not just `authenticated`.
- The invite path (`src/lib/auth/invite.ts`) is a genuinely hard problem (two systems, no single transaction) solved with a clear, well-tested rollback-on-every-step design, and sharing it between the ops action and `pnpm user:invite` avoids the classic drift between an admin UI and its CLI equivalent.
- `docs/specs/0013-expert-accounts-profiles/verify.md` is a model of honest verification: it records a real bug (photo uploads silently dying between 1–2 MB due to Next's default body cap), explains the fix decision with the tradeoffs considered, and shows before/after measurements from the real app rather than asserting the fix worked.

## Test coverage

Strong at the database layer: six new pgTAP files (`expert_profiles`, `expert_ops_notes`,
`assigned_expert_summaries`, `expert_assignable`, `expert_photos_storage`, plus the existing
`expert_assignments` extended) collectively prove every RLS and storage rule the spec's Security
model claims, including negative and race-condition cases. `tests/lib/auth/invite.test.ts` covers the
shared invite module's happy path and every failure/rollback branch well. The catalogue equality test
(`tests/features/experts/catalogue.test.ts`) is a nice piece of engineering — it parses the actual SQL
check constraints rather than duplicating the code list, so a real drift would fail it. UI component
tests exist for `account-actions`, `code-checkbox-group`, `expert-avatar` and `photo-field` (the
last including the regression test for the AC-6 body-size bug). `e2e/experts.spec.ts` drives the
onboarding gate, the ops assign/end flow, both client and expert card views, the three emails, and
axe on every new page.

The gap is `src/features/experts/actions.ts` itself: no `actions.test.ts` exists, so the
authorization-gate logic, the Postgres error-code translation in `assignExpert`, and the idempotent
multi-step sequences in `deactivateExpert`/`reactivateExpert` are exercised only by e2e happy paths
and by the (correct, but lower-level) pgTAP proof that the database would refuse the underlying
write anyway. See the Major finding above.

## Resolution, 8 Sep 2026

Worked on `feat/expert-accounts-profiles` after the review, on Claude Opus 5.

**Fixed**

- **Major, no unit tests for `actions.ts`** — `tests/features/experts/actions.test.ts`, 68 tests
  (`9f3c2b9`). Every scenario the spec's "Critical test scenarios" and build plan step 2 named:
  each ops only action answering `forbidden` to a client, to an expert, to claims carrying the
  right role but no `sub`, and to no session at all, every one asserting that nothing was queried
  so the short circuit is proven rather than the outcome; `updateExpertProfile` refusing an expert
  who sends an `expertId` *before* the update runs, and letting ops through on the same input; two
  racing `assignExpert` calls answering one `ok` and one `already_assigned`; `assignExpert`'s three
  Postgres codes, including a `23514` that is *not* the trigger's, which must still be reported;
  `inviteExpert`'s three failure branches with `already_invited` and `email_taken` kept off Sentry;
  a double onboarding submit answering `ok` twice under one idempotency key; and the idempotent
  sequences in `deactivateExpert` and `reactivateExpert`, including the partial reruns (a failed
  ban, a failed sweep, a failed unban) the finding called out.
- **Minor, no confirmation on deactivate** — `f3da34e`. The trigger opens the `Dialog` the ops
  order controls already use, naming the expert and the count of open assignments it will end,
  with "Keep this expert" as the way out. Reactivate and resend stay one press: neither destroys
  anything. Three component tests cover the gate, the cancel path and the zero assignment wording.
- **Minor, silent locale fallback in `resendInvite`** — `9f3c2b9`. `log.info` on the fallback path,
  so "why did this invite go out in English" is answerable from the logs.

**Kept deliberately**

- **Minor, photo MIME type trusted from the browser** — recorded as an accepted risk in the spec's
  Follow-up rather than fixed. The bucket is private, only the owner may write their own prefix,
  and every read is a 10 minute signed URL, so the blast radius is one expert's own card. A
  magic byte check here would be a second, weaker copy of a check that belongs in the `sharp`
  variant task already queued in Follow-up, which decodes the bytes anyway.
- **The three nits** — all kept, as the review itself suggested ("fine as is", "worth keeping as
  is"). The `not_found` versus `forbidden` distinction in `updateExpertProfile` would widen the
  result union for two edge cases that read identically to ops.

**Verification**: `pnpm typecheck`, `pnpm lint`, `pnpm test` (1504 passed, 1 skipped over 137
files, up from 1433), `pnpm db:reset` then `pnpm test:db` (556 over 25 files), `pnpm build &&
pnpm budget` (every page under budget), `TRIGGER_DEV_RUNNING=1 pnpm test:e2e experts.spec.ts`
(6 of 6, axe included) and the dialog driven in the real app as `ops@example.com` in both
languages, confirming it names the expert, counts the assignments and leaves the status `Active`
when ops back out.
