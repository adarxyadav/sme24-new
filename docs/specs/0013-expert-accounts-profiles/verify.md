# Verify: expert accounts and profiles · spec 0013

**Run on**: 2026-09-08 · branch `feat/expert-accounts-profiles` · local stack · HEAD `a1d721f`
**Verdict**: PASS with one finding. Fourteen of the fifteen criteria are met and driven in the
real app. **AC-6 is met only up to ~1 MB**: a photo between 1 MB and the specced 2 MB is rejected
by Next before the action runs, and the expert sees no message at all.

**Closed on 2026-09-08** by `/debug expert photo upload limit`; AC-6 is now met in full. See
[## The AC-6 finding, closed](#the-ac-6-finding-closed) at the end of this file.

This supersedes the run of 2026-09-07, which was taken on `feat/fix-checkout-session-persistence`
before milestones 2 to 4 existed and found eleven criteria unbuilt. Every surface it listed as
missing now exists and was driven.

## How this was run

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build && pnpm budget` on the real commands.
- `pnpm db:reset` first, because three worktrees share the one local stack, then `pnpm test:db`.
- `pnpm db:types` and a `git diff` on the generated file, to prove the committed types are current.
- The committed `e2e/experts.spec.ts` under `TRIGGER_DEV_RUNNING=1` with `pnpm trigger:dev` running.
- A throwaway Playwright spec for the seven criteria the committed suite does not drive (AC-2, 3,
  5, 6, 7, 8, 10), signed in as the seeded `ops@example.com` and `expert@example.com`, deleted
  again after the run.
- `psql` against the local database for the delivery rows, the profile row and the status machine.

## Gate results

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS, clean |
| `pnpm lint` | PASS, 531 files, no fixes |
| `pnpm test` | PASS, 1342 passed, 1 skipped, 128 files |
| `pnpm test:db` | PASS, 556 tests over 25 files, exit 0 |
| `pnpm db:types` | no diff: the committed types are current |
| `pnpm build` | PASS, 61 static pages |
| `pnpm budget` | PASS, every page under its budget |
| `e2e/experts.spec.ts` | PASS, 6 of 6, serial, with the worker running |
| `e2e/design.spec.ts` | 8 of 9 after the fix below; the one failure is pre existing |

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | met | `pnpm db:reset` applies `20260907102956_expert_profiles.sql` and `20260907103500_expert_photo_bucket.sql`; `pnpm test:db` passes 556 tests including all six expert files; `pnpm db:types` leaves no diff; the catalogue equality test passes in Vitest; the seeded `expert@example.com` row is `active`. |
| AC-2 | met | Invited a fresh address through `/en/admin/experts/new` in the browser: the action redirected to the new `/admin/experts/<uuid>` page and `expert_profiles` held the row with `status 'invited'` and the email. Inviting the same address again showed "This expert has already been invited." and created no second user. |
| AC-3 | met | The "Resend invitation" button is rendered on the detail page of an `invited` expert, and is absent once the status leaves `invited`. |
| AC-4 | met | Committed spec, test 2: an expert whose row is put back to `invited` is redirected from `/expert` to `/expert/onboarding`, completes the form with consent, and is redirected back; a second visit to the onboarding page is redirected to `/expert`. |
| AC-5 | met | Saved headline, summary, years of experience, phone, one competency, one language and one canton on `/en/expert/profile`; the row held every value. A 130 character headline was refused with "Use 120 characters or fewer." and the valid value then saved. |
| AC-6 | **partly met** | Under 1 MB the whole path works: a PNG uploaded, `photo_path` became `<expert_id>/photo.png`, the rendered avatar used a signed URL (`token=` in the `src`, never a public URL), and "Remove photo" cleared the column back to null. A wrong type file was refused with the right message. **The 1 MB to 2 MB window fails silently** — see the finding. |
| AC-7 | met | `/en/admin/experts` lists the seeded expert with its status badge, carries the status filter and the "Invite an expert" link, and `Experts` sits in the admin sidebar directly before `Design gallery`. The detail page shows the profile form, the notes editor, the assignments section and the account section. All three pages pass axe. |
| AC-8 | met | Saved ops notes through the editor on the detail page; `expert_ops_notes` held the text. pgTAP proves an expert selects zero rows from that table. |
| AC-9 | met | Committed spec, test 1: ops assign the seeded organization through the picker, both sides see it, ending it removes it. The eligibility rule also shows in the UI: on an `invited` expert the Assign button is disabled and the page reads "Only an active expert can be assigned to a client." |
| AC-10 | met | Driven through the real ops UI in two browser contexts: ops press "Deactivate expert", the row goes `inactive`, and the expert's next navigation to `/en/expert` lands on `/forbidden` on a still live session. "Reactivate expert" returns an onboarded expert to `active` and the area opens again; an expert who never onboarded returns to `invited`, not `active`. |
| AC-11 | met | Committed spec, test 1: the expert's own list and the read only client page. |
| AC-12 | met | Committed spec, test 1: the client's "Your expert" card appears on `/app` while the assignment is active and is gone once it is ended. |
| AC-13 | met | `pnpm test:db` green across `expert_profiles`, `expert_ops_notes`, `assigned_expert_summaries`, `expert_assignable`, `expert_photos_storage` and `expert_assignments`, the view owner assertion included. `set_expert_status` refused a service role call with `not_signed_in`, so the function is not a way round the rules. |
| AC-14 | met | The three templates, their six previews, the registry entries and the `expert.onboarded` alert all exist, and the rows the worker actually wrote carry the specced keys: `expert-welcome/<expertId>`, `assignment-received/<assignmentId>` and `expert-assigned/<assignmentId>/<userId>`. The links match the spec: `/expert/profile`, `/expert/clients/<organizationId>` and `/app`. Ending an assignment wrote no row. |
| AC-15 | met | Both catalogs hold 1715 keys with zero drift either way; the `experts` namespace is 273 keys in each, and every catalogue code has a label in both languages. Every new page passes axe, and the gallery does too after the fix below. |

## Finding

**A photo over 1 MB fails silently (AC-6).** `PHOTO_MAX_BYTES` in `catalogue.ts` is 2 MB and
`uploadExpertPhoto` answers `too_large` above it, but `next.config.ts` sets no
`serverActions.bodySizeLimit`, so Next's own 1 MB default rejects the request body with a 413
before the action runs. Measured through the real form:

| File | Result |
|---|---|
| 900 KB | saved |
| 1100 KB | nothing at all |
| 1500 KB | nothing at all |
| 3000 KB | nothing at all |

Two things are wrong: a file the spec promises to accept (1 MB to 2 MB) is refused, and the
refusal is invisible — no toast, no alert, no message. The expert is left looking at an unchanged
photo with no idea why. The `too_large` string is therefore unreachable in the browser.

The fix is a decision, not a guess, so it is left for `/debug`: either raise
`serverActions.bodySizeLimit` above 2 MB so the action's own check is the one that fires, or drop
`PHOTO_MAX_BYTES` under 1 MB and reword the message. Either way the oversized case needs a visible
answer, and the client side `accept`/size check should catch it before the request leaves.

## Fixed in this run

**The gallery combobox had no accessible name.** `/admin/design` is scanned by `design.spec.ts`
for spec 0003 AC-10, and the `ExpertsSection` this feature added put a bare `Combobox` on it. A
Combobox renders a `button`, so with no associated label axe reported a critical `button-name`
violation, failing all four gallery scans (light and dark, both languages). The real ops picker in
`assignments-section.tsx` was already correct — it wraps the control in `Field` with a
`FieldLabel htmlFor` — so the gallery example now does the same, with a `gallery.comboboxLabel`
key added to both catalogs. All four gallery tests pass.

## Not caused by this feature

- **`design.spec.ts` keyboard test.** "the sidebar shell is operable by keyboard" fails on the
  skip link (`toBeFocused` sees `inactive`), in isolation as well as in the suite. This branch
  changes neither `design.spec.ts` nor any file on the skip link path, so it is pre existing and
  belongs to spec 0003, not here. The other five design failures recorded before this run were the
  four gallery scans, now fixed, and this one.
- **The Vitest `send-email.local` failures** recorded in earlier runs no longer occur: the suite is
  1342 passed, 1 skipped, 0 failed.

## Notes for the reviewer

- The seeded expert's `expert-welcome/<expertId>` key is spent for 30 days, so re onboarding that
  expert queues nothing. The email tests clear the three templates' rows first, which is why they
  pass on a rerun.
- The Trigger.dev dev environment has `RESEND_API_KEY` set, so the worker sends through Resend,
  which rejects `@example.com`. Emails never reach Mailpit locally; the assertions are on
  `email_deliveries` rows, which is what the feature owes.
- `pnpm db:reset` before `pnpm test:db` is not optional here: three worktrees share the one local
  stack, so the feature migrations can sit unapplied.

## The AC-6 finding, closed

**Closed on 2026-09-08** by `/debug expert photo upload limit`, on branch
`feat/expert-accounts-profiles`.

**The decision: raise the limit, do not lower `PHOTO_MAX_BYTES`.** The two candidates were not
equal. AC-6 in the spec promises "up to 2 MB", the `expert-photos` bucket carries its own
`file_size_limit` of 2097152 in `20260907103500_expert_photo_bucket.sql`, and the hint and error
strings in both catalogs name 2 MB. Lowering the app constant would have contradicted the spec and
left the app stricter than the bucket it writes to, for a limit that only exists because of a
framework default. Raising the Next limit leaves every one of those in agreement.

`next.config.ts` now sets `experimental.serverActions.bodySizeLimit: "3mb"` (still under
`experimental` in Next 16.3.4, checked against `node_modules/next/dist/docs/`). It is 3 MB rather
than 2 MB on purpose: that doc states the cap applies to the raw request body, multipart
boundaries and part headers included, so a limit of exactly `2mb` would still reject a 2 MB file.
The headroom is what lets `uploadExpertPhoto`'s own `too_large` check be the one that fires.

**The oversized case is now visible.** `ExpertPhotoField` checks `file.size > PHOTO_MAX_BYTES`
before it builds the `FormData`, so a file over 2 MB never leaves the browser and the expert gets
the existing `experts.photo.errors.too_large` alert at once. Both paths use the same key, and the
string the finding called unreachable is now reachable.

**Driven in the real app**, the same four sizes the finding measured, through the real form on
`/de/expert/profile` as the seeded `expert@example.com`, in a throwaway Playwright spec deleted
after the run:

| File | Before | After |
|---|---|---|
| 900 KB | saved | saved |
| 1100 KB | nothing at all | **saved** |
| 1500 KB | nothing at all | **saved** |
| 2000 KB | not measured | **saved** |
| 3000 KB | nothing at all | **refused, "Diese Datei ist grösser als 2 MB.", no POST sent** |

The 3000 KB case also asserts that no server action POST is issued, which is what proves the
client side check fires rather than the raised server limit merely being generous.

**Gates rerun for the fix**: `pnpm typecheck` clean, `pnpm lint` 531 files no fixes, `pnpm test`
1342 passed 1 skipped, `pnpm db:reset` then `pnpm test:db` 556 tests over 25 files PASS,
`pnpm build && pnpm budget` all pages under budget, and `TRIGGER_DEV_RUNNING=1 pnpm test:e2e
experts.spec.ts` 6 passed with `pnpm trigger:dev` running. The pre existing `design.spec.ts`
keyboard failure above is unchanged and untouched.

**Owed to `/test`**: a regression test for the size guard. The natural home is a Vitest test on
`ExpertPhotoField` proving a file over `PHOTO_MAX_BYTES` renders the `too_large` alert and never
calls `uploadExpertPhoto`, plus a test that a file under it does call it; the end to end size
window itself is covered by the table above and does not need a permanent Playwright case.

## Next

`/test expert accounts & profiles` for the suite, including the regression test named above. All
fifteen criteria are now met; the scope's "Verify it" covers the feature in full.
