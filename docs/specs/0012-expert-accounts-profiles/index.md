# 0012. Expert accounts and profiles

**Date**: 2026-09-07
**Status**: Proposed

## Summary

Ops invite senior EHS experts from a new `/admin/experts` page instead of the command line, the invited expert sets a password, gives consent, fills a structured profile (headline, bio, the three assessment competencies, industries, standards, languages, cantons, availability, years of experience, phone, photo) and lands in an expert area that lists the client organizations ops have assigned to them, each with a read only page of the company facts, KPIs and benchmark. Ops assign and end those assignments from the expert's admin page, and a client sees the name, headline and summary of every expert currently assigned to them on the dashboard. Every list field is a code from one TypeScript catalogue with German and English labels, so feature 19 (matching) can rank experts from the same table. The profile row is created at invite time with the email copied, so the ops list is one query, and offboarding is one ops action that ends the assignments and bans the sign in.

## Requirements

**User stories**:
- As an ops user, I want to invite an expert by email with the role fixed so that nobody reaches the expert area without our record check.
- As an invited expert, I want to set a password, give my consent once and describe what I do so that ops and clients know what I cover.
- As an expert, I want to see only the clients assigned to me, with the facts and figures the client already saw, so that I arrive on site prepared and never see another expert's clients.
- As an ops user, I want to assign an expert to a client organization and end that assignment later so that access follows the engagement.
- As a client, I want to see who my assigned expert is and what they cover so that I know who is walking my site.
- As an ops user, I want to keep record check notes on an expert that the expert never sees, and deactivate an expert who leaves the network, so that the network stays curated.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: `supabase/schemas/13_expert_profiles.sql` declares `expert_profiles` (kind E, keyed on `expert_id`) with the columns of the data model sketch, RLS on, the policies of the security model, a check constraint per list column against the catalogue codes, the audit trigger and the `updated_at` trigger; `14_expert_ops_notes.sql` declares `expert_ops_notes` with ops only policies; `15_assigned_expert_summaries.sql` declares the `assigned_expert_summaries` view. `pnpm db:diff` produces the migration, `pnpm db:reset` applies it, the hand re added grants and the bucket data migration are in place, `pnpm test:db` passes the new pgTAP files and the generated types are current. A Vitest test keeps `EXPERT_CATALOGUE` in `src/features/experts/catalogue.ts` and the database check constraints equal (same codes per list): it parses every `array[...]` literal in the schema file with a whitespace tolerant parser (the formatter wraps the canton list), and each pgTAP file adds one `throws_ok` per list with a code outside the catalogue. `supabase/seed.sql` and `scripts/seed-users.mts` both give the seeded `expert@example.com` an `active` profile row, so the local and the hosted test accounts never loop on onboarding.
- **AC-2**: `inviteExpert(previous, input)` in `src/features/experts/actions.ts` (ops only) parses `{ email, fullName, locale }` and calls `inviteStaffUser` in the server only module `src/lib/auth/invite.ts`, which runs in this order through the service client: look up `expert_profiles.email` (a hit answers `already_invited`), create the user unconfirmed with `app_metadata.role = 'expert'` (an `email_exists` error from the admin API answers `email_taken`, whatever the other account's role), fix the role on the profile, insert the `expert_profiles` row with `status 'invited'`, the email, `invited_by` the caller and `invited_at now()` (a `23505` on the email, two ops inviting at once, answers `already_invited` and deletes the just created user), then send Supabase's invite email whose link opens `/<locale>/reset-password`; when the email fails the row and the user are deleted together and the action answers `invite_failed`. The last step before the success return is the email, so a real user without a profile row can never remain. It answers `{ ok: true, data: { expertId } }` or `{ ok: false, error: 'validation' | 'email_taken' | 'already_invited' | 'invite_failed' | 'forbidden' | 'unexpected' }`. `pnpm user:invite` calls the same module and, for `--role expert`, inserts the same row; the script's behaviour for `--role ops` is unchanged. The module is imported only by `actions.ts` files and `scripts/`.
- **AC-3**: `resendInvite(previous, input)` (ops only) parses `{ expertId }`, refuses with `not_invited` unless the row's status is `invited`, calls `inviteUserByEmail` again with the same redirect (Supabase resends the invite to an existing unconfirmed user, which is what the script already relies on; a confirmed user would get `email_exists`, impossible here because confirming moves the status to `active` through onboarding), updates `invited_at` and answers `{ ok: true, data: { expertId, invitedAt } }`; the `max_frequency` limit of the auth email rail maps to `rate_limited`. The expert page shows the button only while the status is `invited`.
- **AC-4**: The invite link lands on `/reset-password`; after saving a password the expert is sent to `/expert`. The expert layout (`src/app/[locale]/expert/layout.tsx`) reads `expert_profiles.status` and `profiles.terms_accepted_at` with the user client on every page render and redirects every `/expert` path except `/expert/onboarding` to `/expert/onboarding` while the status is `invited` or the consent is null, redirects `/expert/onboarding` to `/expert` once neither holds, and redirects an `inactive` expert to `/forbidden`. The gate is a page render concern only: it never runs for a server action post, so every expert action in `src/features/experts/actions.ts` re checks the caller's status itself and answers `forbidden` when it is not the one the action needs. The onboarding page shows the consent box, full name (prefilled from the profile), headline, languages and regions; `completeExpertOnboarding(previous, input)` calls `accept_terms()` first, then updates `profiles.full_name`, then updates the profile row with the fields, then calls `set_expert_status(auth.uid(), 'active')` (the only write path for `status`, which stamps `onboarded_at`), captures the `expert_onboarded` event, queues the `expert_welcome` email to the expert and the `expert.onboarded` ops alert, and answers `{ ok: true, data: { expertId } }`. A double submit is harmless: `accept_terms()` writes only when null and the status function treats `active → active` as a no op.
- **AC-5**: `/expert/profile` renders one form (`src/features/experts/ui/profile-form.tsx`) with headline, bio, competencies, industries, standards, languages, regions, availability, `available_from`, availability note, years of experience and phone, prefilled from the row, every list field a checkbox group or multi select over `EXPERT_CATALOGUE` labelled in the reader's language, and a "Save" button; `updateExpertProfile(previous, input)` parses with `expertProfileSchema` in `schema.ts` (headline 1 to 120 characters, bio up to 800, each list a set of catalogue codes with at least one competency, one language and one region once the profile is active, `years_experience` an integer 0 to 60 or empty, `phone` up to 30 characters matching `^[+0-9 ()/-]*$` or empty, `available_from` a date not before today or empty), updates the caller's own row through the user client (the column grant leaves `email`, `status`, `invited_*`, `onboarded_at`, `deactivated_at` and `photo_path` out) and answers `{ ok: true, data: { expertId, updatedAt } }` or `{ ok: false, error: 'validation' | 'forbidden' | 'unexpected' }`. Ops open the same form on `/admin/experts/[expertId]` and `updateExpertProfile` accepts an optional `expertId` that only an ops caller may set (a non ops caller sending one gets `forbidden`); ops writes of these same fields go through the ops update policy on the user client under the shared column grant (column grants are per role, not per policy, so ops and the expert share one grant), and any ops write outside that set (the email fix in Follow-up) goes through the service client inside the action after the ops role check.
- **AC-6**: `uploadExpertPhoto(formData)` (the expert only, for their own row) accepts one file of type `image/jpeg`, `image/png` or `image/webp` up to 2 MB and runs in this order with the user client: read the caller's current `photo_path`, upload to the private bucket `expert-photos` at `<expert_id>/photo.<ext>` with `upsert: true` (`ext` from the validated MIME type), call `set_expert_photo(path)` to write `photo_path` (when that call fails the just uploaded object is deleted and the action answers `unexpected`), then delete the previous object when its extension differs (a failed cleanup is logged and never fails the action: the path is deterministic per extension, so an orphan is overwritten by the next upload of that type). It answers `{ ok: true, data: { photoPath } }` or `{ ok: false, error: 'validation' | 'too_large' | 'unsupported_type' | 'forbidden' | 'unexpected' }`. `removeExpertPhoto()` calls `set_expert_photo(null)` first, then deletes the object (again logged, never fatal). Wherever a photo is shown (the profile form, the ops expert page, the client card, the expert list), the server component mints a signed URL valid 10 minutes through `photoUrl(supabase, photoPath)` in `queries.ts` with the caller's user client, so the bucket policy is the boundary for every viewer, never a public URL and never the service client; a row without a photo shows the initials avatar from the design system.
- **AC-7**: `/admin/experts` lists every `expert_profiles` row (name, email, status badge, competencies, availability, active assignment count, invited or onboarded date) newest first with a status filter (`all` default, `invited`, `active`, `inactive`) and cursor pagination of 50, `/admin/experts/new` holds the invite form (email, full name, language), and `/admin/experts/[expertId]` shows the profile (read only summary plus the AC-5 form), the photo, the ops notes editor (AC-8), the assignments section (AC-9), the resend button (AC-3) and the deactivate or reactivate button (AC-10). `Experts` joins the admin sidebar in `AREA_NAV` before `Design gallery`.
- **AC-8**: `saveExpertOpsNotes(previous, input)` (ops only) parses `{ expertId, notes }` (up to 4000 characters, empty allowed) and upserts `expert_ops_notes` for that expert with `updated_by` the caller. An expert selecting `expert_ops_notes` gets zero rows in pgTAP, and the expert pages never query the table.
- **AC-9**: `assignExpert(previous, input)` (ops only) parses `{ expertId, organizationId }` and inserts an `expert_assignments` row (`status 'active'`, `assigned_by` the caller); the eligibility check lives in the database, a `before insert` trigger `private.check_expert_assignable` on `expert_assignments` that raises `expert_not_active` (errcode `check_violation`) unless the expert's profile status is `active`, so a deactivation racing an assign can never leave an assignment on an inactive expert. It answers `{ ok: true, data: { assignmentId } }`, `expert_not_active` from the trigger, `already_assigned` on a `23505` of the active unique index, and `not_found` on a `23503` of `organization_id`. `endAssignment(previous, input)` parses `{ assignmentId }`, updates `status` to `ended` (the transition trigger sets `ended_at`) and answers `{ ok: true, data: { assignmentId, endedAt } }`, `not_found` when no active row matched. Both live in `src/features/experts/actions.ts`. The organization picker on the ops expert page is a searchable `Combobox` over `organizations` (id, name, the first company name) fed by `listOrganizationsForAssignment(supabase, search)` limited to 20 rows. On a successful assign the action reads the organization's `organization_members.user_id` rows with the service client and queues `expert_assigned` to each (key `expert-assigned/<assignmentId>/<userId>`) and `assignment_received` to the expert (key `assignment-received/<assignmentId>`), both through `sendEmail`, and captures `expert_assigned`; an organization with no members is not an error, only the expert's email goes out. Ending sends nothing. Feature 12 adds the `order_id` column and assigns from an order; this action stays the manual path.
- **AC-10**: `deactivateExpert(previous, input)` (ops only) parses `{ expertId }` and runs in this order: `set_expert_status(expertId, 'inactive')` first (which stamps `deactivated_at` and, through the trigger of AC-9, blocks any new assignment from that moment), then updates every `active` assignment of the expert to `ended`, then bans the auth user through `banStaffUser(userId)` in `src/lib/auth/invite.ts` (`auth.admin.updateUserById` with `ban_duration '876000h'`). The action is idempotent: on an already `inactive` expert it re runs the ban and the assignment sweep and answers `ok`, so a failure after step one is fixed by pressing the button again. It answers `{ ok: true, data: { expertId, endedAssignments } }`. `reactivateExpert(previous, input)` lifts the ban (`ban_duration 'none'`), computes the target from `onboarded_at` (`invited` when null, else `active`), calls `set_expert_status` with it and answers `{ ok: true, data: { expertId, status } }`, `already_active` when the row is not `inactive`. The expert layout redirects an `inactive` expert with a live session to `/forbidden` (their own row select policy is unconditional on status, which is what lets the gate see it), and the picker of AC-9 never lists an inactive expert.
- **AC-11**: `/expert` lists the caller's `active` assignments (company name, canton, industry label from the NOGA section, `started_at`) newest first through `listMyAssignments(supabase)` (the expert's own rows joined to `organizations` and the organization's first company), with the existing empty state when there are none; each row links to `/expert/clients/[organizationId]`, which renders the company facts card (name, UID, canton, industry, size band), the `KpiTable` on `company_kpi_current`, the `BenchmarkSegment` on the latest snapshot, and a contacts card listing the organization's members (full name and email) from `assigned_organization_contacts(organizationId)`. `getAssignedClient(supabase, organizationId)` catches `not_assigned` from that function (and an organization the policies hide) and returns `null`, and the page calls `notFound()` on `null`: one behaviour for the unassigned case. The expert sidebar gains `Profile` (`/expert/profile`). `Overview` stays the first entry.
- **AC-12**: `/app` renders an "Your expert" card (`<section aria-labelledby="assigned-experts-heading" data-assigned-experts>`) immediately after the page header whenever `assigned_expert_summaries` returns at least one row for the caller's organization, one entry per active expert (photo or initials, full name, headline, bio, competencies, industries, standards and languages as labelled badges, "since {date}"); with no row the section is absent. The strings live in the `experts` namespace in both catalogs and the section passes axe.
- **AC-13**: Row access: an expert reads and updates only their own `expert_profiles` row (the select policy is `expert_id = auth.uid()` with no status condition) and never `expert_ops_notes`; a client member reads `assigned_expert_summaries` rows only for experts with an `active` assignment to their organization, gets zero rows from the `expert_profiles` table and zero from `storage.objects` in `expert-photos` except the photos of those experts; an expert gets member names and emails only through `assigned_organization_contacts`, which raises `not_assigned` for any other caller (no new policy on `profiles` or `organization_members`); ops read and write everything except that `status` and `photo_path` change only through the two functions; the view is owned by `postgres` and a pgTAP assertion on its owner keeps a future migration from changing that. pgTAP files `expert_profiles.sql`, `expert_ops_notes.sql`, `assigned_expert_summaries.sql`, `expert_assignable.sql` and `expert_photos_storage.sql` prove each rule for the client, expert and ops roles, including the ended assignment case and the assign on an inactive expert.
- **AC-14**: The three templates `expert_welcome` (to the expert, notification link `/expert/profile`), `assignment_received` (to the expert, with company name and the link `/expert/clients/<organizationId>`) and `expert_assigned` (to each member, with the expert's full name, headline and the link `/app`) exist as a schema entry, a React Email component, a registry entry, `email.<name>` keys in both catalogs and a preview each, and each names its `notifications.link` value as listed; the `expert.onboarded` alert kind is a schema plus a presenter (expert name, email, competencies, a link to the admin page). Every send goes through `sendEmail` with the idempotency keys named in AC-4 and AC-9 and writes the `notifications` row the task already creates.
- **AC-15**: Every user facing string of the feature lives under `experts` (and `nav`, `email`, `areas`) in both catalogs; the catalogue labels for NOGA sections, standards, languages, cantons and competencies are `experts.catalogue.*` keys with a Vitest test that every code has a label in both languages. The new pages pass axe in Playwright, and the whole feature is a Playwright flow on the local stack: ops invite through the UI, the invite email is read from Mailpit, the expert sets a password, completes onboarding, saves the profile, ops assign the seeded client organization, the expert opens the client page, and the seeded client sees the card on `/app`.

## Decision

**Chosen option**: Option 2: One expert owned profile table plus a scoped summary view, the invite path shared between an ops action and the script, and manual ops assignments on the existing bridge table.

Experts are staff accounts created only by ops, described in one `expert_profiles` row with catalogue coded lists, exposed to assigned clients through a view that checks the assignment, and connected to clients by the `expert_assignments` rows spec 0002 already defined, which ops now create and end by hand until features 12 and 19 automate it.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `react-email` (`resend/resend-skills`, `.claude/skills/react-email/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `email-testing` (`petrkindlmann/qa-skills`, `.claude/skills/email-testing/`) · `posthog-instrumentation` (`posthog/posthog-for-claude`, `.claude/skills/posthog-instrumentation/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (the target; one migration, AC-1):

**`expert_profiles`** (kind E, expert owned, spec 0002 contract)

| Column | Type | Notes |
|---|---|---|
| `expert_id` | `uuid primary key references profiles(id) on delete cascade` | 1:1 with the profile |
| `email` | `text not null unique check (email = lower(email))` | Copied at invite so the ops list needs no admin API call; the sign in email stays in `auth.users` |
| `status` | `text not null default 'invited' check (status in ('invited','active','inactive'))` | Written only by `set_expert_status` |
| `headline` | `text null check (char_length(headline) between 1 and 120)` | Client visible |
| `bio` | `text null check (char_length(bio) between 1 and 800)` | Client visible |
| `competencies` | `text[] not null default '{}' check (competencies <@ array['compliance','management_system','safety_culture'])` | The three assessment types, keyed like `packages` |
| `industries` | `text[] not null default '{}' check (industries <@ array[<NOGA section letters A to U>])` | Matches `companies.industry_code` by its first letter in feature 19 |
| `standards` | `text[] not null default '{}' check (standards <@ array[<catalogue codes>])` | Curated list in the catalogue (see below) |
| `languages` | `text[] not null default '{}' check (languages <@ array['de','fr','it','en'])` | |
| `regions` | `text[] not null default '{}' check (regions <@ array[<the 26 canton codes>])` | Matches `companies.canton` |
| `availability` | `text not null default 'available' check (availability in ('available','limited','unavailable'))` | Expert and ops only |
| `available_from` | `date null` | When the availability changes next |
| `availability_note` | `text null check (char_length(availability_note) <= 300)` | Expert and ops only |
| `years_experience` | `integer null check (years_experience between 0 and 60)` | Expert and ops only |
| `phone` | `text null check (char_length(phone) <= 30)` | Expert and ops only |
| `photo_path` | `text null check (photo_path ~ ('^' || expert_id::text || '/photo\.(jpg|png|webp)$'))` | Written only by `set_expert_photo` |
| `invited_by` | `uuid null references profiles(id) on delete set null` | Null when the script invited |
| `invited_at` | `timestamptz not null default now()` | Refreshed by resend |
| `onboarded_at` | `timestamptz null` | Set by `set_expert_status(...,'active')` the first time |
| `deactivated_at` | `timestamptz null` | Set by `set_expert_status(...,'inactive')`, cleared on reactivate |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Indexes: `(status)`, `(email)` is the unique constraint, GIN on `competencies`, `industries`, `regions` and `languages` (feature 19 filters on them). Audit trigger and `set_updated_at` trigger as every kind E table. `revoke truncate`.

Column grants for `authenticated` on update: `headline, bio, competencies, industries, standards, languages, regions, availability, available_from, availability_note, years_experience, phone` (the expert's own row through the policy; ops through theirs). Insert is granted to `authenticated` only for the ops insert policy (the script and the action use the service client anyway). `status`, `photo_path`, `onboarded_at`, `deactivated_at`, `email`, `invited_*` are outside the grant.

Functions (both `security definer`, `set search_path = ''`, `revoke execute from anon, public`, `grant to authenticated`):
- `public.set_expert_status(target uuid, next text) returns expert_profiles`: the whole state machine in one place. Ops may run `invited → active`, `invited → inactive`, `active → inactive`, `inactive → invited` (only while `onboarded_at` is null) and `inactive → active` (only while `onboarded_at` is not null); the expert may only run `invited → active` on their own row; a same state call (`active → active`, `inactive → inactive`) is a no op that returns the row; anything else raises `invalid_transition`, a caller outside those rules raises `forbidden`. Activation stamps `onboarded_at` the first time and clears `deactivated_at`; deactivation stamps `deactivated_at`.
- `private.check_expert_assignable()` trigger, `before insert` on `expert_assignments`: raises `expert_not_active` (errcode `check_violation`) unless the expert's `expert_profiles.status` is `active`. The eligibility rule lives here, not in the action, so it holds under concurrency and for feature 19.
- `public.set_expert_photo(path text) returns expert_profiles`: writes `photo_path` on the caller's own row (null allowed), checks the path prefix is the caller's id.
- `public.assigned_organization_contacts(org uuid) returns table (user_id uuid, full_name text, email text, role text)`: members of `org` with the email from `auth.users`, for callers where `private.is_assigned_expert(org)` or `private.is_ops()`, else raises `not_assigned`. Kept a function, not a view, because the email lives in `auth.users`.

**`expert_ops_notes`** (kind I, ops only): `expert_id uuid primary key references profiles(id) on delete cascade`, `notes text not null default '' check (char_length(notes) <= 4000)`, `updated_by uuid null references profiles(id) on delete set null`, `created_at`, `updated_at`. One policy: ops for all. Audit trigger. `revoke truncate`.

**`assigned_expert_summaries`** (view, `security_invoker = false`, owner `postgres` and asserted so in pgTAP, `grant select to authenticated`, `revoke from anon`): `select a.organization_id, a.id as assignment_id, a.started_at, p.id as expert_id, p.full_name, e.headline, e.bio, e.competencies, e.industries, e.standards, e.languages, e.photo_path from expert_assignments a join profiles p on p.id = a.expert_id join expert_profiles e on e.expert_id = a.expert_id where a.status = 'active' and e.status = 'active' and (a.organization_id = private.jwt_org_id() or private.is_ops() or a.expert_id = auth.uid())`. The row filter lives in the view because a definer view bypasses table RLS; the column list is written out (never `select *`). The client card and the ops expert page read it; the migration re adds the column list by hand as the AGENTS.md rule warns.

**`expert-photos` bucket** (data migration `expert_photo_bucket.sql`, `public false`, `file_size_limit 2097152`, `allowed_mime_types` jpeg png webp; policies in `16_expert_photo_storage.sql`): select for the owner (`(storage.foldername(name))[1] = auth.uid()::text`), for ops, and for members of an organization with an active assignment to that expert (`exists (select 1 from expert_assignments where expert_id::text = (storage.foldername(name))[1] and organization_id = private.jwt_org_id() and status = 'active')`); insert, update and delete for the owner only. Path `<expert_id>/photo.<ext>`.

**`expert_assignments`**: no column change; gains the `check_expert_assignable` trigger. Ops insert and update through the existing ops policy. The `order_id` column stays for feature 12. No new policy on `profiles` or `organization_members`: the expert client page gets member names and emails from `assigned_organization_contacts` alone.

**Catalogue** (`src/features/experts/catalogue.ts`, a `const` object per list, labels as `experts.catalogue.<list>.<code>` keys): competencies `compliance`, `management_system`, `safety_culture`; industries the NOGA sections `A` to `U`; languages `de`, `fr`, `it`, `en`; regions the 26 canton codes; standards `iso_45001`, `iso_14001`, `iso_9001`, `iso_50001`, `ekas_6508`, `suva_asa`, `arg_argv`, `vuv`, `stfv`, `scc`, `iso_31000`, `esti`, `bauav`, `psa` (no retired standard such as OHSAS 18001; ops extend the list in code). The Vitest test of AC-1 keeps the catalogue and the check constraints equal. Adding a code is a catalogue entry, a check constraint change (a migration) and two label keys.

**State transitions** (`expert_profiles.status`, enforced only by `set_expert_status`):

| From | To | Who | Side effect |
|---|---|---|---|
| `invited` | `active` | the expert on their own row (onboarding), or ops | `onboarded_at = now()` when null |
| `invited` | `inactive` | ops (deactivate before onboarding) | `deactivated_at = now()` |
| `active` | `inactive` | ops (deactivate) | `deactivated_at = now()` |
| `inactive` | `invited` | ops (reactivate), only while `onboarded_at` is null | `deactivated_at = null` |
| `inactive` | `active` | ops (reactivate), only while `onboarded_at` is not null | `deactivated_at = null` |
| any | the same state | anyone allowed to reach it | no op, returns the row |

`reactivateExpert` computes the target from `onboarded_at` before calling. `expert_assignments.status` keeps spec 0002's `active → ended`.

**API surface** (server actions in `src/features/experts/actions.ts` unless noted; every action parses with `schema.ts`, answers a typed result and never throws for an expected failure):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `inviteExpert` | action | `email:string (req)`, `fullName:string (req, 1 to 200)`, `locale: 'de' or 'en' (req)` | `expertId` | ops | `validation`, `email_taken`, `already_invited`, `invite_failed` |
| `resendInvite` | action | `expertId:uuid` | `expertId`, `invitedAt` | ops | `not_invited`, `rate_limited`, `invite_failed` |
| `completeExpertOnboarding` | action | `termsAccepted:true`, `fullName`, `headline`, `languages[]`, `regions[]`, `locale?` | `expertId` | expert (own row) | `validation`, `forbidden` |
| `updateExpertProfile` | action | the AC-5 fields, `expertId?:uuid` (ops only) | `expertId`, `updatedAt` | expert (own) or ops | `validation`, `forbidden` |
| `uploadExpertPhoto` | action (`FormData`) | `file` | `photoPath` | expert (own) | `too_large`, `unsupported_type`, `validation` |
| `removeExpertPhoto` | action | none | `expertId` | expert (own) | `unexpected` |
| `saveExpertOpsNotes` | action | `expertId`, `notes` (≤4000) | `expertId`, `updatedAt` | ops | `validation`, `forbidden` |
| `assignExpert` | action | `expertId`, `organizationId` | `assignmentId` | ops | `expert_not_active` (trigger), `already_assigned` (`23505`), `not_found` (`23503`) |
| `endAssignment` | action | `assignmentId` | `assignmentId`, `endedAt` | ops | `not_found` |
| `deactivateExpert` | action (idempotent) | `expertId` | `expertId`, `endedAssignments` | ops | `not_found`, `unexpected` |
| `reactivateExpert` | action | `expertId` | `expertId`, `status` | ops | `already_active`, `not_found`, `unexpected` |
| `listExperts(supabase, filters)` | query | `status`, `cursor` | rows plus `nextCursor` | ops (RLS) | throws |
| `getExpertAdminPage(supabase, expertId)` | query | `expertId` | profile, notes, assignments (active and ended), signed photo URL | ops (RLS) | throws `not_found` |
| `getMyExpertProfile(supabase)` | query | none | the caller's row | expert | throws |
| `listMyAssignments(supabase)` | query | none | active assignments with organization and company | expert (RLS) | throws |
| `getAssignedClient(supabase, organizationId)` | query | `organizationId` | company, KPI rows, latest snapshot, contacts | expert (RLS plus the function) | `null` when not assigned |
| `listAssignedExperts(supabase, organizationId)` | query | `organizationId` | `assigned_expert_summaries` rows with signed photo URLs | client member (view filter) | throws |
| `listOrganizationsForAssignment(supabase, search)` | query | `search` (≤100) | up to 20 organizations with their first company name | ops | throws |
| `inviteStaffUser`, `banStaffUser`, `unbanStaffUser` (`src/lib/auth/invite.ts`, `server-only`) | module | email, role, locale, fullName; userId | userId; void | service client | `email_taken`, `invite_failed` |
| `pnpm user:invite` | script | as today | as today | service key | as today plus `already_invited` |

Every action logs one structured line (`expert invited`, `expert onboarded`, `expert assigned`, `assignment ended`, `expert deactivated`) with the ids and sends unexpected errors to Sentry. Pages are `force-dynamic` through the area layouts; the admin list reads `searchParams` for the filter and cursor as `/admin/enquiries` does.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `inviteExpert` | the invitee's role | fixed literal `expert` in the action; never an input |
| `inviteExpert` | the invite redirect | `buildConfirmRedirectUrl(NEXT_PUBLIC_APP_URL, locale, '/reset-password')`, decided in spec 0005 |
| `inviteExpert` | `email` on the row | the input, lower cased and trimmed by the schema |
| `inviteExpert` | `email_taken` versus `already_invited` | `expert_profiles.email` lookup first; then the admin API error `email_exists` |
| `inviteExpert` | `invited_by` | the caller's `sub` claim |
| expert layout gate | whether to send to onboarding | `profiles.terms_accepted_at` and `expert_profiles.status` read in the layout with the user client |
| `completeExpertOnboarding` | `terms_accepted_at` | `accept_terms()` (spec 0005), the only write path |
| `completeExpertOnboarding` | the `active` status and `onboarded_at` | `set_expert_status(auth.uid(), 'active')`, which stamps `now()` |
| `completeExpertOnboarding` | the welcome email language | `profiles.locale`, resolved by the `send-email` task from the `userId` recipient |
| `updateExpertProfile` | which row is written | the caller's `sub`, or `expertId` when the caller's role claim is `ops` |
| `updateExpertProfile` | "today" for `available_from` | the server clock in `Europe/Zurich`, the same rule as `currentYear` in spec 0010, as a pure `todayInZurich(now)` |
| `uploadExpertPhoto` | the object path | `<sub>/photo.<ext>` with `ext` from the validated MIME type, never the file name |
| any photo render | the image URL | `createSignedUrl(photo_path, 600)` on the server per render |
| `assignExpert` | `assigned_by`, `started_at` | the caller's `sub`; the column default `now()` |
| `assignExpert` | the email recipients | `organization_members.user_id` for the organization (the members of that organization), read with the service client inside the action after the insert succeeded; the expert's `expert_id` |
| `assignExpert` | the company name in both emails | the organization's first `companies` row by `created_at`, else the organization name |
| `endAssignment` | `ended_at` | the transition trigger from spec 0002 |
| `deactivateExpert` | the order of the three steps | status first (blocks new assignments through the trigger), then the assignment sweep, then the ban; each step idempotent so a rerun completes a half done call |
| `deactivateExpert` | the ban | `auth.admin.updateUserById(userId, { ban_duration: '876000h' })` |
| `reactivateExpert` | the restored status | `onboarded_at is null` gives `invited`, else `active`, computed in the action and passed to `set_expert_status` |
| `uploadExpertPhoto` | the previous object to delete | the caller's own `photo_path`, read with the user client before the upload |
| `/expert` list | industry label | `companies.industry_code` first letter mapped through `EXPERT_CATALOGUE.industries`; "unknown" when null |
| `/expert` list | company per organization | the organization's first company by `created_at` (one company per organization until feature 22) |
| `/expert/clients/[organizationId]` | KPI rows and snapshot | `getCompanyDashboard` pieces reused through `getAssignedClient`, read under the assigned experts read policies |
| `/expert/clients/[organizationId]` | contacts | `assigned_organization_contacts(organizationId)` |
| `/app` card | which experts | `assigned_expert_summaries` filtered by the view to the caller's organization claim |
| `/app` card | "since {date}" | `started_at` formatted in the reader's locale through next-intl |
| ops list | the assignment count | `count(*)` of `active` assignments per expert in the list query |
| catalogue labels | German and English text | `experts.catalogue.<list>.<code>` in both catalogs |
| analytics | `expert_invited`, `expert_onboarded`, `expert_assigned` | `captureServerEvent` with the expert id as `distinctId` and the organization id as a property |

**Key invariants**:
- One `expert_profiles` row per expert profile, one per email; a row exists for every user whose `profiles.role` is `expert` and was created through the invite path (the seeded `expert@example.com` gets a seed row).
- `status` and `photo_path` change only through the two definer functions; the state machine above admits nothing else.
- An assignment is only ever created for an `active` expert, enforced by the `check_expert_assignable` trigger, never by the action alone; deactivation sets the status first, then ends every active assignment, then bans, and can be rerun.
- A client sees profile data only through the view and only while an `active` assignment exists; the view never exposes availability, phone, years of experience or notes.
- Every list column holds only catalogue codes (`<@` check), and the catalogue and the constraints hold the same sets (Vitest).
- Every email send is idempotent under the keys named above; no send is ever made directly from a transport.
- The role never comes from user input: the action hard codes `expert`; the script keeps its allow list.

**Security model** (compliance scope: revised Swiss FADP with GDPR readiness; an expert profile is personal data of a contractor and the phone number and notes are the sensitive part):
- Ops: read and write everything: the AC-5 columns of `expert_profiles` through the ops policy on the user client (the column grant is shared with the expert), `expert_ops_notes` and `expert_assignments` through their ops policies, the reserved columns of `expert_profiles` (`email`, `invited_*`) and the invite, ban and unban through the service client inside `actions.ts` only, after the ops role check.
- Expert: read (unconditionally on status) and update their own `expert_profiles` row (granted columns only), read their own assignments, read `organizations`, `companies`, `research_runs`, `company_kpis` and `benchmark_snapshots` of organizations with an `active` assignment through the existing assigned experts read policies, call `assigned_organization_contacts` for those, upload and delete their own photo. Never `expert_ops_notes`, never `orders` or `invoices` (spec 0011), never another expert's row, never `profiles` or `organization_members` of a client directly.
- Client member: read `assigned_expert_summaries` rows for their organization and the photos of those experts; nothing else of the feature.
- `anon`: nothing; every new function revokes `anon` execute by hand in the migration.
- Audit: `expert_profiles`, `expert_ops_notes` and `expert_assignments` writes go to `audit_log` through the existing trigger; the ban is recorded by a log line and the `deactivated_at` stamp, because `auth.users` is outside the trigger's reach.
- The invite email and the reset link keep spec 0005's rules (token hash verification, `otp_expiry` of 15 minutes locally, resend from the ops page).

**Configuration required**:
- No new environment variables. `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_APP_URL` (existing) are what the invite module needs on the server; the hosted Supabase project needs the `expert-photos` bucket, created by the data migration on deploy.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path (Playwright, local stack): ops invite through the UI, Mailpit yields the invite, the expert sets a password, completes onboarding with consent, saves a full profile and a photo, ops assign the seeded client organization, the expert sees the client page with KPIs and contacts, the seeded client sees the card on `/app`, verifies **AC-2**, **AC-4**, **AC-5**, **AC-6**, **AC-9**, **AC-11**, **AC-12**, **AC-15**.
- Failure case (Vitest, actions with a mocked module): inviting an address that already has a profile answers `already_invited` and creates no user; an admin API `email_exists` answers `email_taken`; an invite email failure deletes the created user and answers `invite_failed`, verifies **AC-2**.
- Failure case (pgTAP): `set_expert_status` refuses `active → invited`, `inactive → active` by the expert, and `invited → active` by another expert; `assignExpert` on an `invited` expert answers `expert_not_active` (Vitest), verifies **AC-4**, **AC-9**, **AC-10**.
- Concurrency (Vitest): two simultaneous assigns of the same pair answer one `ok` and one `already_assigned`; a double onboarding submit answers `ok` twice with one `onboarded_at`, verifies **AC-4**, **AC-9**.
- Auth/permission (pgTAP): the client of organization A sees expert X in the view while assigned and zero rows after the assignment is `ended` or X is `inactive`; client B sees nothing; expert X reads zero `expert_ops_notes` rows and zero rows of expert Y; expert X gets `not_assigned` from `assigned_organization_contacts(B)`; a client gets zero objects from `expert-photos` for an unassigned expert, verifies **AC-8**, **AC-13**.
- Auth/permission (Vitest): a client calling any ops action gets `forbidden`; an expert sending `expertId` to `updateExpertProfile` gets `forbidden`, verifies **AC-5**, **AC-13**.
- Offboarding (Playwright): ops deactivate an assigned expert; the client card disappears, the expert's next navigation lands on `/forbidden`, the assignment shows `ended` on the ops page, verifies **AC-10**.
- Catalogue (Vitest): every code in `EXPERT_CATALOGUE` is in the matching check constraint and vice versa, and every code has a label in both catalogs, verifies **AC-1**, **AC-15**.
- Accessibility (Playwright with axe): `/admin/experts`, `/admin/experts/new`, `/admin/experts/[id]`, `/expert`, `/expert/profile`, `/expert/onboarding`, `/expert/clients/[id]` and `/app` with the card, verifies **AC-7**, **AC-11**, **AC-12**, **AC-15**.

## Build plan

Tracer Bullet: the first slice runs one expert from invite to a visible client card through every layer, then the profile, the ops controls and the emails thicken it.

1. Migration for the target model: `13_expert_profiles.sql`, `14_expert_ops_notes.sql`, `15_assigned_expert_summaries.sql`, the `check_expert_assignable` trigger in `12_expert_assignments.sql`, the three functions with hand re added grants, the seed row for `expert@example.com` in `supabase/seed.sql` and `scripts/seed-users.mts`, the pgTAP files `expert_profiles.sql`, `expert_ops_notes.sql`, `assigned_expert_summaries.sql` (with the owner assertion) and `expert_assignable.sql`, `pnpm db:types`; the catalogue file and its equality test, satisfies **AC-1**, **AC-8** (schema half), **AC-13** (all but the bucket)
2. The invite thread end to end: `src/lib/auth/invite.ts` (`inviteStaffUser` extracted from the script, `banStaffUser`, `unbanStaffUser`), the script refactored onto it, `inviteExpert` and `resendInvite`, the `/admin/experts` list, `/admin/experts/new` form and a minimal `/admin/experts/[expertId]` page, the `Experts` nav entry, the Vitest action tests and the first Playwright steps (invite through the UI, Mailpit, set password), satisfies **AC-2**, **AC-3**, **AC-7**
3. Expert onboarding and the gate: the expert layout check, `/expert/onboarding` with consent and the first fields, `completeExpertOnboarding`, the `expert_onboarded` capture, the Playwright continuation, satisfies **AC-4**
4. Assignment and the two ends of it: `assignExpert`, `endAssignment`, the organization picker and the assignments section on the ops expert page, `listMyAssignments` and the `/expert` list, `getAssignedClient` and `/expert/clients/[organizationId]` (facts, KPI table, benchmark segment, contacts), `listAssignedExperts` and the `/app` card with the `experts` namespace, the `expert_assigned` capture, the Playwright continuation to the client card, satisfies **AC-9** (without emails), **AC-11**, **AC-12**
5. The full profile: `expertProfileSchema`, `updateExpertProfile` for the expert and ops, `/expert/profile`, the same form on the ops page, `Profile` in the expert nav, then the photo: the bucket data migration, `16_expert_photo_storage.sql` with its `expert_photos_storage.sql` pgTAP file, the upload and removal actions with signed URLs; `saveExpertOpsNotes` and the notes editor, satisfies **AC-5**, **AC-6**, **AC-8**, **AC-13** (the bucket)
6. Offboarding: `deactivateExpert` and `reactivateExpert`, the buttons, the layout redirect for `inactive`, the Playwright offboarding flow, satisfies **AC-10**
7. Emails and the alert: the three templates with previews and catalog keys, the `expert.onboarded` alert, the sends wired into onboarding and assignment with their idempotency keys, the `pnpm email:dev` previews checked, satisfies **AC-14**, **AC-9** (emails), **AC-4** (welcome)
8. Closing pass: every string in both catalogs, axe on every new page, the design gallery section for any new primitive (the multi select checkbox group, the initials avatar if new), `pnpm build && pnpm budget`, `docs/experts.md` with the per environment checklist (bucket present, invite tested from the admin, Slack alert), satisfies **AC-15**

## Consequences

**Positive**:
- Ops run the whole expert lifecycle from the admin: invite, resend, review, assign, end, deactivate, without a terminal or the Supabase dashboard.
- Feature 19 gets a ranking input for free: coded lists with GIN indexes on one table, availability and years of experience.
- Clients see their expert through a view whose filter is provable in pgTAP; the private half of the profile never leaves the expert and ops.
- The invite path exists once, shared by the script and the action, so a fix lands in both.

**Negative / tradeoffs**:
- Copying the email onto `expert_profiles` means an email change in Supabase Auth does not propagate; ops fix it by hand until an auth email change hook exists (Follow-up).
- The ban ends the session only at the next token refresh (up to an hour); the layout redirect covers the gap for pages, and a server action from a stale session is still refused by RLS on every ops write, but the expert can read their own row for that hour.
- A definer view and three definer functions carry their own security surface; each check is written into the object and tested, but a future column added to the view is client visible by default until someone thinks about it.
- Catalogue codes live in three places (TypeScript, the check constraints, the label keys); the tests keep them equal, but adding a standard is a migration.
- Audit log rows are not negotiable for an access control table; `expert_profiles` and `expert_ops_notes` write them, and the ban is only logged.

**Neutral**:
- `expert_assignments` gains no column; feature 12 adds `order_id` as spec 0002 planned.
- The seeded expert gets a seed profile row so the four test accounts keep working without an invite.
- The manual assign action stays after feature 19: matching confirms into the same table, ops can still override by hand.

## Follow-up

- [ ] Feature 12 (ops admin): add `order_id` on `expert_assignments`, assign from the order and show "scheduled for" to the expert; fold `/admin/experts` into the ops shell.
- [ ] Feature 19 (matching): rank on `competencies`, `industries` by NOGA prefix, `regions`, `languages`, `availability` and `years_experience`; confirming writes the same `expert_assignments` row this feature's action writes.
- [ ] Feature 22 (team invitations): the expert client page shows every member; the "first company" rule for the list breaks once an organization holds several companies, so the list groups by company then.
- [ ] Email change on an expert account: keep `expert_profiles.email` in step (an auth hook or an ops edit), until then ops update it by hand.
- [ ] Feature 14 (legal): the expert consent is a contractor consent; check whether the expert terms differ from the client terms and version them separately.
- [ ] Photo resizing: add a `sharp` variant task only if the client card or the ops list gets slow on large uploads.
- [ ] `/sync`: root `AGENTS.md` gains the expert rule (invite through `src/lib/auth/invite.ts` only, status through `set_expert_status`, catalogue equality test, the summary view for client reads) and a pointer to `docs/experts.md`.
