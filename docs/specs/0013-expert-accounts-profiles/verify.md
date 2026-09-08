# Verify: expert accounts and profiles · spec 0013

**Run on**: 2026-09-08 · branch `feat/fix-checkout-session-persistence` · local stack
**Verdict**: FAIL. The database layer is real and proven. Every user facing surface of the
feature is missing, so eleven of the fifteen criteria cannot be met yet.

Feature 16 in the scope has all three build milestones unticked, and that matches what runs:
milestone 1 (schema, catalogue, invite thread) is built, milestones 2 and 3 are not.

## How this was run

- `pnpm db:reset` applied the two feature migrations, which were sitting on disk unapplied
  (the shared local stack had last been reset from another worktree).
- `pnpm test:db` for the policy rules.
- `pnpm vitest run` for the catalogue equality, `pnpm typecheck` for the types.
- A throwaway Playwright spec signed in as each seeded role through the project's own
  `signIn` helper and loaded every specced route against the running app.
- Direct `psql` probes as ops and as the expert for the state machine and the assign trigger.

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | met | After `pnpm db:reset`, `to_regclass` shows `expert_profiles`, `expert_ops_notes` and `assigned_expert_summaries` all present, plus `set_expert_status`, `set_expert_photo`, `assigned_organization_contacts`, `private.check_expert_assignable` and the `expert-photos` bucket. All 22 columns of the sketch match. View owner is `postgres`. The seeded `expert@example.com` row is `active`. `pnpm test:db` PASS, 553 tests, exit 0. Catalogue equality test 14 passed. `pnpm typecheck` clean. |
| AC-2 | blocked | `inviteExpert` and `inviteStaffUser` exist in code, but with no `/admin/experts/new` page there is no way to drive the action through the app. Not exercised. |
| AC-3 | blocked | `resendInvite` exists in code; its button lives on the missing expert admin page. Not exercised. |
| AC-4 | specced but missing | `/en/expert/onboarding` returns HTTP 404 signed in as `expert@example.com`. No onboarding page, no `completeExpertOnboarding` action. The layout gate cannot be exercised. |
| AC-5 | specced but missing | `/en/expert/profile` returns HTTP 404. No `ui/profile-form.tsx`, no `updateExpertProfile` action. |
| AC-6 | specced but missing | No `uploadExpertPhoto` or `removeExpertPhoto` action. The bucket and `set_expert_photo` exist; nothing calls them. |
| AC-7 | specced but missing | `/en/admin/experts` and `/en/admin/experts/new` both return HTTP 404 signed in as ops. No `Experts` entry in `AREA_NAV` (sidebar link count 0). |
| AC-8 | specced but missing | No `saveExpertOpsNotes` action. The table and its ops only policies are proven by pgTAP. |
| AC-9 | partly met | The database half is proven: deactivating the seeded expert then inserting an assignment raises `expert_not_active` from `private.check_expert_assignable`. The `assignExpert` and `endAssignment` actions, the org picker and the two emails do not exist. |
| AC-10 | partly met | `set_expert_status(expert,'inactive')` returns `inactive` and stamps `deactivated_at`; `active -> active` is a no op; `active -> invited` on an onboarded expert raises `invalid_transition`. The `deactivateExpert` and `reactivateExpert` actions do not exist. See the note below on the error name. |
| AC-11 | specced but missing | `/en/expert` renders ("Expert area") but is the pre existing placeholder: no assignment list. `/en/expert/clients/[organizationId]` does not exist, and there is no `listMyAssignments` or `getAssignedClient`. |
| AC-12 | specced but missing | `/en/app` renders as `client@example.com` with zero `[data-assigned-experts]` sections and no such markup anywhere in the source. |
| AC-13 | met | `pnpm test:db` PASS with all six expert files green: `expert_profiles`, `expert_ops_notes`, `assigned_expert_summaries`, `expert_assignable`, `expert_photos_storage`, `expert_assignments`. The view owner assertion holds. |
| AC-14 | specced but missing | None of `expert_welcome`, `assignment_received` or `expert_assigned` appear anywhere under `src/lib/email/`, and there is no `expert.onboarded` alert kind. |
| AC-15 | partly met | The `experts` namespace is present in both `messages/en-CH.json` and `messages/de-CH.json`, and the catalogue label test passes in both languages. The Playwright flow the criterion asks for does not exist, and the pages it would drive are missing. |

## Missing surfaces

Every one of these returned a real 404 from the running app, or is absent from the source:

- `/[locale]/admin/experts`, `/[locale]/admin/experts/new`, `/[locale]/admin/experts/[expertId]`
- `/[locale]/expert/onboarding`, `/[locale]/expert/profile`, `/[locale]/expert/clients/[organizationId]`
- The `Experts` entry in `AREA_NAV`
- Actions: `completeExpertOnboarding`, `updateExpertProfile`, `uploadExpertPhoto`, `removeExpertPhoto`,
  `saveExpertOpsNotes`, `assignExpert`, `endAssignment`, `deactivateExpert`, `reactivateExpert`
- Queries: `listMyAssignments`, `getAssignedClient`
- The three email templates and the `expert.onboarded` alert
- The client "Your expert" card on `/app`

Only `inviteExpert` and `resendInvite` exist in `src/features/experts/actions.ts`.

## Worth a look

- **The error name in `set_expert_status`.** The spec says a caller outside the allowed rules
  raises `forbidden`. When the expert calls `set_expert_status(self,'inactive')` on their own
  row the function raises `invalid_transition` instead. The call is refused either way, so this
  is a naming point, not a hole. Worth settling when the offboarding actions get built, since
  `deactivateExpert` maps these codes to its typed result.

- **Two unrelated Vitest failures.** `tests/trigger/send-email.local.test.ts` fails on an
  `email_deliveries_organization_id_fkey` violation. Pre existing and recorded already; nothing
  to do with this feature. Everything else is green: 1293 passed of 1296.

- **The shared local stack bites.** The two feature migrations were on disk but not applied,
  because the stack had last been reset from another worktree. Anything checking this feature
  should run `pnpm db:reset` first, and the pgTAP suite needs a fresh reset anyway since its
  own guard refuses a database holding rows beyond the seed.

## Next

`/develop expert accounts & profiles` for milestones 2 and 3. The database foundation under
them is sound, so the remaining work is the actions, the pages, the emails and the flow.
