# Experts

_How an expert reaches SME24, what their profile holds and what each environment needs before the first real invite goes out. Spec: [0013 Expert accounts and profiles](specs/0013-expert-accounts-profiles/index.md). The invite email itself is an auth email, see [auth.md](auth.md); the product emails ride the rail in [email.md](email.md)._

## How an expert travels

1. **Ops invite.** `/admin/experts/new` posts `inviteExpert` (ops only), which calls the shared `inviteStaffUser` in `src/lib/auth/invite.ts` — the same module `pnpm user:invite` runs, so the page and the script create the same rows in the same order. The role is a literal in the action and never comes from the form. The `expert_profiles` row is created at invite time with the email copied onto it, so the ops list is one query.
2. **The expert sets a password.** The invite link goes through `/api/auth/confirm` and lands on `/reset-password`. `/admin/experts` resends an invite to anyone still `invited`.
3. **Onboarding.** The `/expert` layout redirects every path except `/expert/onboarding` while the status is `invited` or the terms stamp is null. `completeExpertOnboarding` records consent through `accept_terms()`, writes the name and the first fields, then moves the row to `active` through `set_expert_status` — the only write path for the status. It then queues the `expert_welcome` email to the expert and the `expert.onboarded` alert to ops.
4. **The profile.** `/expert/profile` holds the full row: headline, bio, the three competencies, industries, standards, languages, cantons, availability, years of experience, phone and the photo. Every list field is a code from `EXPERT_CATALOGUE` in `src/features/experts/catalogue.ts` with German and English labels, so feature 19 can rank experts from the same table. Ops edit the same fields from `/admin/experts/[expertId]` and keep their record check in the separate ops only `expert_ops_notes`.
5. **Assignment.** Ops assign from the expert's admin page through `assignExpert`; eligibility is the `check_expert_assignable` trigger in the database, not the app, so a deactivation racing an assign can never land on an inactive expert. The action then queues `assignment_received` to the expert and `expert_assigned` to every member of the client organization. `endAssignment` closes one; **ending sends nothing.**
6. **What each side sees.** The expert's `/expert` lists their active clients and `/expert/clients/[organizationId]` shows that client's facts, KPIs, benchmark and contacts, read only. The client sees the name, headline and summary of their active experts on `/app`, through the `assigned_expert_summaries` view.
7. **Offboarding.** `deactivateExpert` moves the status first (which closes the trigger), then ends the open assignments, then bans the sign in. It is idempotent on purpose: a failure part way through is fixed by pressing the button again. `reactivateExpert` returns the expert to `active` or `invited` depending on `onboarded_at`.

## The emails and the alert

| What | To | Key | Link |
| --- | --- | --- | --- |
| `expert_welcome` | the expert, on onboarding | `expert-welcome/<expertId>` | `/expert/profile` |
| `assignment_received` | the expert, on assign | `assignment-received/<assignmentId>` | `/expert/clients/<organizationId>` |
| `expert_assigned` | each member of the client organization, on assign | `expert-assigned/<assignmentId>/<userId>` | `/app` |
| `expert.onboarded` (alert) | the ops Slack channel | `expert-onboarded/<expertId>` | `/admin/experts/<expertId>` |

`assignment_received` is the one template whose registry `link` is a function of its data rather than a constant, because the button and the notification row both point at that one client's page. An organization with no members is not an error: only the expert's email goes out. Every send goes through `sendEmail` and never fails the action — the assignment row is already written by the time the emails are queued.

`expert.onboarded` is the one alert that carries an email address, and it is a colleague's rather than a client's: ops need it to start the record check.

## The photo bucket

Photos live in the private `expert-photos` bucket, one object per expert at `<expert_id>/photo.<ext>`, at most 2 MB, JPEG, PNG or WebP. The policies are in `supabase/schemas/16_expert_photo_storage.sql` and proved by `supabase/tests/expert_photos_storage.test.sql`: the expert writes their own object, ops read any, and a client reads only the objects of experts currently assigned to them. Every read is a signed URL with a ten minute TTL (`PHOTO_URL_TTL_SECONDS`), never a public URL. `set_expert_photo` is the only write path for `photo_path`, so the column is outside the profile action's grant.

## Local development

- `supabase start` applies the migrations and `seed.sql`, which seeds `expert@example.com` and `ops@example.com` (password `sme24-local-password`).
- `pnpm email:dev` (port 3200) previews the three templates in both languages; read what actually went out at Mailpit, http://127.0.0.1:54324.
- `pnpm trigger:dev` runs the tasks; without `TRIGGER_SECRET_KEY` the sends log `trigger_unavailable` and the actions still succeed.
- Tests: `supabase/tests/expert_*.test.sql` and `assigned_expert_summaries.test.sql` (pgTAP), the catalogue equality test in Vitest, and the Playwright flow with axe over `/admin/experts`, `/admin/experts/new`, `/admin/experts/[id]`, `/expert`, `/expert/profile`, `/expert/onboarding`, `/expert/clients/[id]` and `/app`.

## Per environment checklist

Do these once per hosted environment (staging, production).

- [ ] **The bucket exists.** Confirm `expert-photos` is present and private in the Supabase dashboard after the migrations run; the bucket is created by `supabase/migrations/20260907103500_expert_photo_bucket.sql`, so a failed migration leaves photo upload broken while everything else works.
- [ ] **An invite works from the admin.** Invite a real address from `/admin/experts/new`, confirm the mail arrives (it is an auth email over the Resend SMTP path from [auth.md](auth.md), not the product rail), set a password and complete onboarding. Then deactivate that expert again.
- [ ] **The Slack alert lands.** The onboarding above should post `expert.onboarded` to the ops channel with the name, address and competencies. If nothing arrives, check `OPS_ALERT_WEBHOOK_URL` in Trigger.dev ([email.md](email.md)) before suspecting the action.
- [ ] **The three emails land.** Assign that expert to a seeded client organization and confirm `assignment_received` reaches the expert and `expert_assigned` reaches the members; on staging both addresses must be on `EMAIL_ALLOWED_RECIPIENTS`.
- [ ] **`/admin/emails` shows the rows.** Four deliveries (one welcome, one assignment received, one per member) with `sent` or `delivered`, each with a notification row behind it.
