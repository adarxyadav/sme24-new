# 0012. Expert accounts and profiles: rationale

The decision record behind [index.md](index.md). `/develop` does not need this file.

## Context

The product sells a senior expert's visit, and the site promises fifteen years in an operating role, sector depth and Swiss practice. Until now an expert is a role claim, an empty `/expert` page and a command line invite. Nothing describes what an expert covers, nothing connects an expert to a client except an `expert_assignments` row nobody creates, and the client never learns who is coming. Feature 17 (assessments) needs an expert who can open a client's data, feature 19 (matching) needs structured facts to rank on, and the ops team needs to run the network without a terminal.

Forces: three roles share one database with RLS as the boundary (spec 0002), so every read the client or expert gets must be a policy or a view someone can test. Experts are contractors: their phone, availability and the record check notes are personal data under the revised FADP and must not leak to clients. The service client is fenced by Biome to tasks and `actions.ts`. Row level security is per row, not per column, which shapes where the ops only notes can live. The team is small, the network is a few dozen people at most, and the client dashboard is already a long page.

Not deciding leaves feature 17 without a way to reach a client, feature 19 without inputs, and ops inviting experts by hand on a laptop with the production secret key.

## Options considered

### Option 1: Profile columns on `profiles`, free text tags, keep the CLI invite

Extend `profiles` with a handful of text columns for experts, tag fields as comma separated text, and keep `pnpm user:invite` as the only invite path with a read only experts list in the admin.

**Pros**:
- Smallest schema change, no new table, no bucket.
- The script already works and is tested.

**Cons**:
- Free text cannot be ranked by feature 19 and cannot be labelled in two languages.
- Expert only columns on the shared `profiles` table widen the column grant and the audit noise for every client row.
- Ops still need the secret key on a laptop to invite anyone.

### Option 2: One expert owned profile table plus a scoped summary view, the invite path shared between an ops action and the script, manual assignments on the existing bridge table (chosen)

A kind E `expert_profiles` table with catalogue coded `text[]` lists checked in the database, a separate ops only notes table, a definer view that exposes the client visible columns only while an active assignment exists, a private photo bucket, the invite steps extracted into a server only module used by both the ops action and the script, and ops assign and end actions on `expert_assignments`.

**Pros**:
- Coded lists with GIN indexes are exactly what matching needs, and the labels live in the catalogs like every other string.
- The client sees profile data only through a view whose filter is one testable predicate; the private columns are structurally absent from it.
- The notes table makes "the expert never sees it" a policy, not a convention.
- One invite implementation; the script becomes a thin wrapper.

**Cons**:
- Three definer objects (the view, two functions) to keep honest; a new view column is client visible by default.
- Codes are declared in TypeScript, the check constraints and the label keys; a new standard is a migration.
- The copied email can drift from `auth.users`.

### Option 3: Reference tables and join tables per vocabulary, invites through a Trigger.dev task

Normalise industries, standards, languages and regions into their own tables with join tables, editable by ops without a deploy, and run the invite as a background task with retries.

**Pros**:
- Vocabularies change without a migration; ops can add a standard in the admin.
- The task gives the invite retries and a run log.

**Cons**:
- Five more tables and their policies and pgTAP files for lists that change a few times a year; feature 19 queries join four tables to rank one expert.
- Labels in two languages per row move out of the catalogs into data, which the localization rule wants in the catalogs.
- An invite is one admin API call that ops want to see succeed while they watch; a task adds a pending state and a dashboard hop for nothing.

## Rationale

Option 2 fits the forces. RLS per row is the reason the notes get their own table and the client gets a view: both are provable in pgTAP, and the tenant contract of spec 0002 already planned `expert_profiles` as kind E with "a client with an active assignment reads the summary columns". Coded `text[]` lists mirror the KPI catalogue pattern (a TypeScript catalogue plus a test that keeps the database equal), which the team already maintains, and give feature 19 indexed columns on one row rather than joins. The engineer chose the sharing of the invite module over a task because an invite is one synchronous admin call whose failure ops want to see immediately, and the Biome fence already allows the service client in `actions.ts`.

The email is copied onto the profile row so the ops list, the resend and the duplicate check are one table read instead of an admin API page walk; the drift risk is accepted and listed as a follow up. The photo lives in a private bucket with signed URLs because the invoices bucket already set that pattern and the alternative, a public URL, would make a contractor's face reachable by anyone with the link. Offboarding bans the auth user rather than deleting it because the audit trail and the matching history reference the profile, and a ban is reversible.

Option 1 was rejected because free text kills feature 19 and keeps the secret key on laptops. Option 3 was rejected because the vocabularies are small and slow moving, the labels belong in the catalogs, and the task adds an asynchronous state to a flow ops watch.

**RECOMMEND items settled here**:
- The consent gate is a layout check, not a new claim: the expert layout reads two columns per request. Runner up: a `terms_accepted` claim from the access token hook, rejected because it changes the hook for one area and needs a token refresh after consent.
- Contacts come from a definer function, not a view: the email lives in `auth.users`, which no app policy can reach. Runner up: copy the email onto `profiles`, rejected because spec 0005 deliberately kept it out.
- `status` moves only through `set_expert_status`: a single function holds the state machine so the ops and expert transitions are one table of rules. Runner up: a transition trigger like `expert_assignments`, rejected because the expert's own transition needs a role check the trigger cannot make cleanly.
- The ops list reads the table, not the view: ops see every status; the view is for clients.
- Assign sends emails from the action after the insert, not from a task: two sends with idempotency keys through `sendEmail`, which already triggers a task per send.
- Deactivate ends assignments before the ban so a client card never shows a banned expert, and the action answers with the count.
- The "first company per organization" rule for the expert list mirrors the client dashboard's one company assumption until feature 22.
- `available_from` cannot be in the past: a stale date is worse than none for matching.

## Cross check (2026-09-07, a read only pass on a different model)

Twenty gaps and seven soundness notes came back; the engineer chose to apply the recommended fixes. Applied: the invite step order (profile row before the email, rollback of both), the `23505` mapping on the email, `email_taken` without a role qualifier, the layout gate as a render only concern with every action re checking status, the unconditional own row select policy, the photo write order and the previous object read, the shared column grant for ops writes, zero member organizations on assign, `not_found` from the foreign key, the idempotent deactivate with status first, the explicit transition table and the reactivate target from `onboarded_at`, the view owner assertion, user client signed URLs, one behaviour for the unassigned client page, the whitespace tolerant catalogue test plus pgTAP `throws_ok`, the hosted seed row, the three notification links, the assign eligibility trigger (closing the deactivate versus assign race), the two redundant `profiles` and `organization_members` policies dropped, the retired OHSAS 18001 code dropped, and the photo bucket moved to build slice 5.

Not applied, with the reason: the claim that `inviteUserByEmail` cannot resend to an existing user. Supabase resends to an existing unconfirmed user, which is the exact sequence the current script runs (create unconfirmed, then invite); AC-3 now records this. The suggestion to defer `expert_welcome` was declined because the engineer chose that email in the interview.

## Evidence

**Existing objects this feature builds on** (read during discovery, 2026-09-07):
- `supabase/schemas/01_profiles.sql`: role enum, `terms_accepted_at`, `accept_terms()`, the `full_name, locale` update grant.
- `supabase/schemas/12_expert_assignments.sql`: the bridge table, the `active → ended` trigger, the ops full access policy, direct predicate policies.
- `supabase/schemas/00_private.sql`: `is_ops()`, `is_assigned_expert(org)`, `jwt_org_id()`.
- `supabase/schemas/46_invoice_storage.sql` and the bucket data migration: the private bucket pattern with folder scoped policies.
- `scripts/invite-user.mts`: create user with `app_metadata.role`, fix the profile role, `inviteUserByEmail` with the `/reset-password` redirect, delete on failure.
- `src/proxy.ts`: the area gate and the `/app/onboarding` rule the expert layout mirrors.
- `src/components/shell/nav.ts`: `AREA_NAV` per area.
- `src/lib/email/schema.ts` and `src/trigger/benchmark-company.ts`: the `userId` recipient shape and the per member idempotency key pattern.
- `src/lib/alerts/schema.ts`: alert kinds as a schema plus a presenter.
- `src/lib/analytics/server.ts`: `captureServerEvent`.
- `src/features/research/queries.ts` and `src/features/benchmark/queries.ts`: the dashboard pieces the expert client page reuses.
- `biome.json`: the service client fence (allowed in `src/features/*/actions.ts`, `src/trigger/` and `scripts/`).
