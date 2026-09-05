# 0002. Core data model and access rules

**Date**: 2026-09-04
**Status**: Accepted

## Summary

Every client company, research run, order, assessment and program in SME24 lives in one shared Postgres database, and three kinds of people (client members, experts, ops) read from it. This spec decides how rows are owned and who may see them: every client owned table carries an `organization_id`, the signed in user's organization travels in their access token, experts reach an organization only through an explicit assignment row, and ops reach everything by role, with every write recorded in an audit log that nobody can edit. Feature 3 builds the tenancy core plus the tables Slices 1 and 2 need, and records the shape of every later table so those features add to the model without breaking it. Access rules are tested in the database itself (pgTAP, a test framework that runs inside Postgres) on every pull request.

## Requirements

**User stories**:
- As a client member, I want every row of my organization to be invisible to every other organization so that a bug in a page can never show a competitor's safety data.
- As an expert, I want to see only the organizations I have been assigned to so that my view stays clean and a client's data stays with the people who work on it.
- As ops, I want to see and correct any organization's data, with every change recorded, so that support and the legal duties of the revised FADP (the Swiss data protection act) are workable.
- As the engineer, I want a tenant table contract and a working policy test harness so that each of Slices 1 to 8 adds tables the same way and a wrong policy fails CI instead of leaking a row.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: The schema files under `supabase/schemas/` declare the tenancy core (`organizations`, `organization_members`, `expert_assignments`, `audit_log`, the `profiles` extension, the `private` helper schema) and the Slice 1 and 2 tables (`kpi_definitions`, `companies`, `research_runs`, `company_kpis`, the `company_kpi_current` view); every table enables RLS in the same file it is created in; `pnpm db:diff` produces the migration, `pnpm db:reset` applies it cleanly, and the checked in generated types match (the CI types check passes).
- **AC-2**: The access token of a user with a current organization carries `app_metadata.organization_id` next to `app_metadata.role`; a user without one (the seeded expert and ops users) gets `app_metadata.role` only; `roleFromClaims` keeps working and a new `organizationIdFromClaims` helper reads the new claim.
- **AC-3**: A client member reads, inserts and updates rows only inside their own organization on every tenant table shipped here: a select against another organization returns zero rows, an insert or update that names another `organization_id` is rejected by the policy, and a client cannot read `audit_log` or write `kpi_definitions`.
- **AC-4**: An expert reads rows of an organization only while an `expert_assignments` row for them is `active`, and reads nothing before it exists or after it is `ended`; ops read and update every organization's rows and read `audit_log`.
- **AC-5**: Every insert, update and delete on `profiles`, `organizations`, `organization_members`, `expert_assignments`, `companies`, `research_runs` and `company_kpis` writes one `audit_log` row (actor, actor role, organization, table, row id, action, old and new data, changed columns); no app role (`anon`, `authenticated`, `service_role`) can update or delete an audit row, and the attempt fails with an error.
- **AC-6**: `public.create_organization(name)` creates the organization, the caller's owner membership and the caller's current organization in one transaction, returns the id, and refuses a caller who is not a client or already belongs to an organization.
- **AC-7**: `pnpm test:db` runs the pgTAP policy tests in `supabase/tests/` against the local stack, covering each shipped table for all three roles plus the cross tenant deny cases, and the same command runs in the CI job that starts the local database, so a broken policy fails the pull request.
- **AC-8**: The seeded users keep signing in with the documented password; the seed now gives the client user an organization as owner and adds a second client user with their own organization so cross tenant checks are possible by hand and in end to end tests.
- **AC-9**: The migration is additive only (no column or table dropped or renamed, no existing policy removed), applies on top of the init migration on staging, and the scaffold's ops smoke page keeps working.
- **AC-10**: `research_runs` is in the `supabase_realtime` publication, and the status transition trigger rejects an invalid move (for example `succeeded` back to `running`).

## Decision

**Chosen option**: Option 1: One shared schema with an `organization_id` on every client owned table, the organization carried as a token claim, an assignment table for experts, ops by role claim, a trigger written audit log, and pgTAP policy tests.

The six decisions you asked to settle, each with the pick, the reason and the runner up:

| # | Decision | Pick | Why | Runner up |
|---|---|---|---|---|
| 1 | Entities for Slices 1 to 8 | The full entity map below is the target; feature 3 ships the tenancy core and the Slice 1 and 2 tables; every later table is named here with its owner kind and the feature that lands it | Later tables whose shape is another feature's headline decision (questionnaires, order states, benchmark data set, program structure) would be guesses today; naming them with their access pattern now is what keeps the later migrations additive | Ship all 25 tables now (coherent, but guesses that later specs would have to migrate) |
| 2 | Tenancy | `organization_id not null` on every tenant table, the organization id in the token, experts cross organizations only through `expert_assignments`, ops by the `ops` role; `kpi_definitions`, benchmarks, packages and questionnaire content are global read tables | One predicate per table kind, no join in the common client path, expert access is a row you can list and end | Membership lookup inside every policy (always fresh, one extra indexed lookup per query) |
| 3 | Access rules | Policies per command in the table's own file, helpers in a `private` schema, the hook adds `app_metadata.organization_id`, tasks take explicit ids and always filter by `organization_id` | Matches spec 0001 and the scaffold, and keeps the service key path reviewable | A `scopedServiceClient(orgId)` wrapper (still a convention underneath, adds a layer to learn) |
| 4 | Audit log | One `audit_log` table written by a generic row trigger on every tenant and access control table; append only for every app role, guarded by a trigger that only a maintenance setting can bypass | Retrofitting audit is painful, ops access must be logged (spec 0001), and FADP erasure still needs one supervised way to redact | Application level audit calls from actions (misses task and SQL writes) |
| 5 | Policy tests | pgTAP files in `supabase/tests/`, run by `supabase test db` through `pnpm test:db`, locally and in the CI job that already starts the stack | Tests the policy where it lives, no sign in dance, runs in seconds; the role and claims are set per test with `set_config` | Vitest with `supabase-js` signing in as the seeded users (slower, needs the stack in the unit job) |
| 6 | Scope of feature 3 | Tenancy core + audit log + expert assignments + `kpi_definitions`, `companies`, `research_runs`, `company_kpis` + the test harness; the rest per feature under the tenant table contract | Tracer Bullet: real, narrow, end to end; features 6 to 8 build on it next week | Core only (features 8 and 9 would each invent their tables) |

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`)

## Feature design

### Table kinds

Every table in the product is one of five kinds. The kind decides its columns and its policy template; a later feature picks the kind and copies the template.

| Kind | Meaning | Ownership column | Who reads | Who writes |
|---|---|---|---|---|
| **T** tenant | Owned by one client organization | `organization_id uuid not null` | members of that organization, assigned experts, ops | members (per table), the service client from tasks, ops |
| **U** user scoped | Belongs to one person | `recipient_id` or `user_id`, plus a nullable `organization_id` for context | that user, ops | the service client (tasks), that user for read state, ops |
| **E** expert owned | An expert's own data | `expert_id uuid not null` | that expert, ops, clients with an active assignment (per table) | that expert, ops |
| **G** global | Reference data shared by everyone | none | every signed in user | ops, or a data migration |
| **I** internal | Ops only records | optional `organization_id` for context, never a foreign key that would cascade | ops | triggers, tasks, ops |

### Data model sketch: what lands in feature 3

Conventions for every table: `id uuid primary key default gen_random_uuid()` (the scaffold already uses random UUIDs; they are safe in URLs, and the tables stay small enough that index locality does not matter yet), `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` kept honest by the existing `set_updated_at` trigger, `text` with a `check` constraint for every status column (a Postgres enum cannot lose a value, so `text` keeps migrations additive; the existing `app_role` enum stays as it is), `timestamptz` everywhere, lowercase snake case identifiers, and an index on every foreign key.

**`profiles`** (exists, extended; kind U). Add `full_name text null`, `locale text not null default 'de' check (locale in ('de','en'))`, a foreign key from `organization_id` to `organizations(id) on delete set null`, and a comment that `organization_id` is the user's *current* organization, kept in step with `organization_members` by a trigger. `handle_new_user` also copies `full_name` and `locale` from `raw_user_meta_data` when present (display data only, never authorization). Column grants: `revoke update on public.profiles from authenticated; grant update (full_name, locale) on public.profiles to authenticated;` so a user can never change their own role or organization.

**`organizations`** (kind T, the tenant itself). `name text not null check (char_length(name) between 1 and 200)`, `created_by uuid null references profiles(id) on delete set null`, `archived_at timestamptz null` (a closed account that keeps its data until an erasure request), timestamps. Deleting an organization cascades through every tenant table; the audit log keeps the trail because it has no foreign key.

**`organization_members`** (kind T). `organization_id uuid not null references organizations(id) on delete cascade`, `user_id uuid not null references profiles(id) on delete cascade`, `role text not null default 'member' check (role in ('owner','member'))`, timestamps. `unique (organization_id, user_id)`, index on `user_id`. Trigger `private.sync_profile_organization()`: after insert, set `profiles.organization_id` when it is null; after delete, clear it when it pointed at that organization. A user belongs to one organization for now (enforced by `create_organization` and, from feature 22, the invitation acceptance action, not by a constraint, so multi organization users later need no migration).

**`expert_assignments`** (kind T, the bridge that lets an expert cross into an organization). `organization_id` (cascade), `expert_id uuid not null references profiles(id) on delete cascade`, `status text not null default 'active' check (status in ('active','ended'))`, `assigned_by uuid null references profiles(id) on delete set null`, `started_at timestamptz not null default now()`, `ended_at timestamptz null`, timestamps. Unique partial index on `(organization_id, expert_id) where status = 'active'`, partial index on `(expert_id) where status = 'active'`. Features 12 and 19 add nullable `order_id` and `program_id` columns to say why the assignment exists.

**`audit_log`** (kind I). `id bigint generated always as identity primary key` (never shown to users), `occurred_at timestamptz not null default now()`, `actor_id uuid null` (no foreign key, so the trail outlives the user), `actor_role text not null check (actor_role in ('client','expert','ops','service','system'))`, `organization_id uuid null` (no foreign key), `table_name text not null`, `row_id text not null`, `action text not null check (action in ('insert','update','delete'))`, `old_data jsonb null`, `new_data jsonb null`, `changed_columns text[] null`. Indexes: `(organization_id, occurred_at desc)`, `(table_name, row_id)`, `(actor_id, occurred_at desc)`.

**`kpi_definitions`** (kind G). `key text primary key` (for example `ltifr`), `name jsonb not null` and `description jsonb null` keyed by locale (`{"de": …, "en": …}`, checked to contain `de` and `en`; French and Italian later are a key, not a column), `unit text not null`, `direction text not null check (direction in ('lower_is_better','higher_is_better','neutral'))`, `sort_order integer not null default 0`, `is_active boolean not null default true`, timestamps. Feature 8 seeds the rows through a data migration (production needs them too, so not `seed.sql`).

**`companies`** (kind T). `organization_id` (cascade), `name text not null`, `legal_name text null`, `uid text null` (the Swiss company identifier, `CHE-…`), `website text null`, `industry_code text null` (NOGA code), `employees_count integer null check (employees_count >= 0)`, `canton text null check (canton ~ '^[A-Z]{2}$')`, `country text not null default 'CH'`, `created_by uuid null references profiles(id) on delete set null`, `archived_at timestamptz null`, timestamps. Index `(organization_id, created_at desc)`, unique partial `(organization_id, uid) where uid is not null`. One organization may hold several companies (a group and its subsidiaries).

**`research_runs`** (kind T). `organization_id` (cascade), `company_id uuid not null references companies(id) on delete cascade`, `status text not null default 'queued' check (status in ('queued','running','succeeded','empty','failed'))`, `trigger_run_id text null`, `requested_by uuid null references profiles(id) on delete set null`, `started_at timestamptz null`, `finished_at timestamptz null`, `error_code text null`, `error_message text null` (a message safe to show; details go to Sentry), `summary jsonb null` (what feature 8 wants to show about sources and coverage), timestamps. Indexes `(organization_id, created_at desc)`, `(company_id, created_at desc)`, partial `(status) where status in ('queued','running')`. Added to the realtime publication.

**`company_kpis`** (kind T). `organization_id` (cascade), `company_id` (cascade), `research_run_id uuid null references research_runs(id) on delete set null`, `kpi_key text not null references kpi_definitions(key)`, `period_year integer not null check (period_year between 2000 and 2100)`, `value numeric not null`, `source text not null check (source in ('research','client'))`, `confidence numeric null check (confidence between 0 and 1)`, `sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array')` (items shaped `{url, title, excerpt, retrieved_at}`), `note text null`, `created_by uuid null references profiles(id) on delete set null`, timestamps. Unique partial `(research_run_id, kpi_key, period_year) where research_run_id is not null`; unique partial `(company_id, kpi_key, period_year) where source = 'client'`; indexes `(organization_id)`, `(company_id, kpi_key, period_year)`.

**`company_kpi_current`** (view, `with (security_invoker = true)` so the caller's policies apply). One row per `(company_id, kpi_key, period_year)`: the client row when one exists, else the newest research row by `created_at`. Feature 9 reads the benchmark inputs from here, feature 10 writes the client rows.

### Target map: what later features add

Named now so each one lands as an additive migration under the same contract. Columns are that feature's spec to settle; the kind and the owner column are settled here.

| Table | Kind | Owner column | Lands in | Notes |
|---|---|---|---|---|
| `notifications` | U | `recipient_id`, nullable `organization_id` | 7 | Written by the email tasks from the first send, so feature 23 is a read surface; `read_at` is the only user write |
| `benchmarks` | G | none | 9 | Peer values per `kpi_key`, industry code, size band, year; written by data migration or ops |
| `packages` | G | none | 11 | The three fixed price packages and the retainer; prices in CHF, VAT rate |
| `orders`, `order_events` | T | `organization_id` | 11 | Order states are feature 11's decision (spec 0001); `stripe_events` is kind I with the event id unique |
| `retainer_enquiries` | I | nullable `organization_id` | 13 | Public form, no signed in user; insert through a server action with the service client, ops read |
| `expert_profiles` | E | `expert_id` | 16 | Competencies, industries, standards, languages, region, availability; a client with an active assignment reads the summary columns |
| `questionnaire_versions`, `questionnaire_items` | G | none | 17 | Versioned content so standards can change without touching answers |
| `assessments`, `assessment_answers` | T | `organization_id` | 17 | The assigned expert writes drafts; the client reads status only until release |
| `gap_reports`, `gap_findings` | T | `organization_id` | 18 | Structured findings the program builder reuses; the released document lives in Supabase Storage with RLS on `storage.objects` |
| `expert_matches` | T | `organization_id` | 19 | The suggestion, the reasons and the confirmed choice; confirming inserts an `expert_assignments` row |
| `programs`, `program_actions`, `progress_entries` | T | `organization_id` | 20 | Expert and client both write; per table policies say which columns |
| `invitations` | T | `organization_id` | 22 | Token hash, email, role, expiry; acceptance inserts the membership and revokes nothing |
| `analytics_events` | I | nullable `organization_id` | 15 or 24 | Only if feature 24 needs a database copy of the funnel next to PostHog |

### The tenant table contract (copy this for every kind T table)

```sql
create table public.<table> (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- …feature columns…
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index <table>_organization_id_created_at_idx on public.<table> (organization_id, created_at desc);
alter table public.<table> enable row level security;

create policy "<table>: members read their organization"
  on public.<table> for select to authenticated
  using (organization_id = (select private.jwt_org_id()));
create policy "<table>: members insert into their organization"
  on public.<table> for insert to authenticated
  with check (organization_id = (select private.jwt_org_id()));
create policy "<table>: members update their organization"
  on public.<table> for update to authenticated
  using (organization_id = (select private.jwt_org_id()))
  with check (organization_id = (select private.jwt_org_id()));
create policy "<table>: assigned experts read"
  on public.<table> for select to authenticated
  using ((select private.is_assigned_expert(organization_id)));
create policy "<table>: ops full access"
  on public.<table> for all to authenticated
  using ((select private.is_ops())) with check ((select private.is_ops()));

create trigger <table>_set_updated_at before update on public.<table>
  for each row execute function public.set_updated_at();
create trigger <table>_audit after insert or update or delete on public.<table>
  for each row execute function private.audit_row();
```

Rules that go with it: no delete policy for members (archive with `archived_at`; ops delete, and organization deletion cascades); drop or narrow a member policy per table when the feature says so (for example `company_kpis` members may only insert rows with `source = 'client'`); experts get insert or update policies only on the tables their feature names; `anon` gets no policy anywhere; helper calls are always wrapped in `(select …)` so Postgres evaluates them once per statement; every schema file holds the table, its indexes, RLS, policies and triggers together.

### Helper functions (schema `private`, not exposed through the API)

`create schema private; grant usage on schema private to authenticated, service_role;` The schema is not in `[api].schemas`, so PostgREST never exposes these as RPCs, but the policies (which run as the caller) need `grant execute` on each, added by hand to the migration.

| Function | Kind | Body in words |
|---|---|---|
| `private.jwt_app_role() returns text` | `stable`, `security invoker`, `language sql` | `auth.jwt() -> 'app_metadata' ->> 'role'` |
| `private.jwt_org_id() returns uuid` | `stable`, `security invoker`, `language sql` | `nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid` |
| `private.is_ops() returns boolean` | `stable`, `security invoker` | `jwt_app_role() = 'ops'` |
| `private.is_org_owner(org uuid) returns boolean` | `stable`, `security definer`, `set search_path = ''` | exists a row in `organization_members` with `organization_id = org`, `user_id = auth.uid()`, `role = 'owner'`. Definer because a policy on `organization_members` that read `organization_members` through RLS would recurse; the `auth.uid()` check inside is what keeps it safe |
| `private.is_assigned_expert(org uuid) returns boolean` | `stable`, `security definer`, `set search_path = ''` | `jwt_app_role() = 'expert'` and exists an `expert_assignments` row with `organization_id = org`, `expert_id = auth.uid()`, `status = 'active'` |
| `private.sync_profile_organization()` | trigger, `security definer` | keeps `profiles.organization_id` in step with memberships (above) |
| `private.audit_row()` | trigger, `security definer` | inserts the audit row (below) |
| `private.protect_audit_log()` | trigger | `raise exception 'audit_log is append only'` on update or delete unless `current_setting('app.audit_maintenance', true) = 'on'` |
| `private.check_research_run_transition()` | trigger | enforces the state machine below, raises on an invalid move |
| `public.create_organization(name text) returns uuid` | `security definer`, `set search_path = ''`, `revoke execute from anon, public` | requires `jwt_app_role() = 'client'` and no membership for `auth.uid()`; inserts the organization (`created_by = auth.uid()`), the owner membership, sets the profile's current organization, returns the id; raises `already_member` or `not_a_client` otherwise. The only insert path for organizations (no insert policy on the table) |

The policies on `organization_members` and `expert_assignments` use direct predicates (`user_id = (select auth.uid())`, `expert_id = (select auth.uid())`) rather than the helpers that read those same tables.

### Access token claims

`custom_access_token_hook` reads `role` and `organization_id` from `profiles` in one select and writes both under `app_metadata` (`organization_id` only when not null). Nothing else changes: the top level `role` claim stays `authenticated`, the hook stays granted to `supabase_auth_admin` only. A membership change shows up at the next token refresh (at most `jwt_expiry`, one hour); feature 22 revokes the removed user's sessions with the admin API so removal takes effect at once. `src/lib/auth/roles.ts` gains `organizationIdFromClaims(claims): string | null` beside `roleFromClaims`.

### State transitions

`research_runs.status`: `queued → running`, `queued → failed`, `running → succeeded | empty | failed`. The three end states are final. The client's insert creates `queued`; the task moves it on through the service client; the trigger rejects anything else, including a repeat of the same end state.

`expert_assignments.status`: `active → ended` (sets `ended_at`); never back. A new assignment is a new row.

### API surface

Reads and writes go through PostgREST as the signed in user, so the surface is the tables above plus these functions.

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `rpc/create_organization` | POST | `name: text` (required, 1 to 200 chars) | `uuid` of the new organization | authenticated, role `client` | `not_a_client`, `already_member`, check violation on name |
| `organizations`, `organization_members`, `expert_assignments`, `companies`, `research_runs`, `company_kpis`, `company_kpi_current` | GET, POST, PATCH | columns above; every insert names `organization_id` | rows the caller's policies allow | authenticated | `42501` policy violation on insert or update, empty result on a foreign select, check violations |
| `kpi_definitions` | GET | none | rows | authenticated | none |
| `audit_log` | GET | filters on `organization_id`, `table_name`, `row_id` | rows | authenticated, role `ops` | empty for other roles; `42501` on any write |
| `custom_access_token_hook` | called by Supabase Auth | `event.user_id` | claims with `app_metadata.role` and `app_metadata.organization_id` | `supabase_auth_admin` only | none (a missing profile yields the unchanged claims) |
| Task payloads (`src/trigger/`) | `tasks.trigger()` | `organizationId: uuid` plus the row ids the task works on, validated by `schemaTask` | rows written through the service client | service key | a task never selects without `.eq("organization_id", organizationId)` |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Token issue | `app_metadata.organization_id` | `profiles.organization_id`, maintained by the membership trigger |
| Token issue | `app_metadata.role` | `profiles.role` (unchanged from the scaffold) |
| Member read on a tenant table | which organization | the token claim through `private.jwt_org_id()` |
| Expert read on a tenant table | which organizations | `expert_assignments` rows with `status = 'active'` for `auth.uid()` |
| Owner only actions | who is an owner | `organization_members.role`, read fresh through `private.is_org_owner` |
| Ops access | who is ops | `app_metadata.role = 'ops'` |
| `create_organization` | `created_by`, owner membership, current organization | `auth.uid()`, the constant `owner`, the new id |
| Audit row | `actor_id` | `auth.uid()` (null for tasks and SQL) |
| Audit row | `actor_role` | `app_metadata.role` when present; `service` when the JWT `role` claim is `service_role`; `system` when there is no JWT (migrations, seed) |
| Audit row | `organization_id` | the row's `organization_id` column when the table has one, else null |
| Audit row | `row_id`, `changed_columns` | `new.id` or `old.id` as text; keys of `new_data` whose value differs from `old_data` |
| New profile | `full_name`, `locale` | `raw_user_meta_data.full_name` and `.locale` when present, else null and `de` (spec 0001 default locale) |
| Research run created | `status`, `requested_by`, `organization_id` | constant `queued`, `auth.uid()`, the token claim (with check) |
| Research run progressed | `status`, `trigger_run_id`, `started_at`, `finished_at`, `error_*` | the task through the service client, scoped by `organizationId` and the run id in its payload (feature 8) |
| KPI shown to a client | the effective value and its origin | `company_kpi_current` (client row wins, else newest research row) and its `source` column |
| KPI label | name in the user's language | `kpi_definitions.name ->> locale`, locale from `profiles.locale` |
| Seeded organizations | fixed ids for local and staging | `supabase/seed.sql` |
| Erasure request (feature 14) | redacted audit rows | `private.redact_audit_subject(user_id)` running under `app.audit_maintenance = on`, to be written in feature 14 |

### Key invariants

- A tenant row always has an `organization_id`; the policy `with check` makes it the caller's own organization for members.
- A client user has at most one membership and their `profiles.organization_id` equals it (function and trigger enforced; the constraint is deliberately absent so multi organization users are an additive change).
- Experts and ops have `profiles.organization_id = null` and therefore no organization claim; an expert reaches rows only through an `active` assignment.
- `audit_log` rows are never updated or deleted outside the maintenance path; every write on the listed tables produces exactly one audit row.
- `research_runs.status` and `expert_assignments.status` only move along the transitions above.
- `company_kpis`: at most one client row and at most one row per research run for a `(company, kpi, year)`.
- Migrations are additive: add, switch the code, remove in a later change; enums are never used for new status columns.
- Every `security definer` function lives in `private` (or is `create_organization`, revoked from `anon`), sets `search_path = ''`, and checks `auth.uid()` or the role claim in its body.

### Security model

Compliance scope: revised Swiss FADP with GDPR readiness. Personal data here: `profiles.full_name`, the email in `auth.users`, company contact details in later tables, and the copies inside `audit_log`. Data at rest stays in Zurich (spec 0001). Erasure keeps the audit trail but redacts personal fields through the maintenance path (feature 14 builds the function and the ops flow). Ops access is elevated but every ops write is audited; ops reads are not logged at the row level (see Follow-up).

Policy matrix for the tables shipped here (`select` / `insert` / `update` / `delete`):

| Table | Client member | Expert | Ops | Notes |
|---|---|---|---|---|
| `profiles` | own row, and rows of members of the same organization (select); own `full_name`, `locale` (update, column grant) | own row | all (select, update) | `supabase_auth_admin` select stays for the hook |
| `organizations` | own (select); owner update of `name` | assigned (select) | all | insert only through `create_organization`; ops delete for erasure |
| `organization_members` | own organization (select); owner insert, update, delete within it (feature 22 uses this) | none | all | direct predicates, no helper |
| `expert_assignments` | own organization (select, to show the assigned expert) | own rows (select) | all | insert and update ops only until feature 19 |
| `audit_log` | none | none | select | no write policy for anyone; `insert, update, delete` revoked from `anon`, `authenticated`, `service_role` |
| `kpi_definitions` | select | select | select, insert, update | seeded by migration |
| `companies` | own organization (select, insert, update) | assigned (select) | all | archive, never delete, for members |
| `research_runs` | own organization (select, insert with `requested_by = auth.uid()` and `status = 'queued'`) | assigned (select) | all | progress written by the task through the service client |
| `company_kpis` | own organization (select); insert, update, delete only where `source = 'client'` and `created_by = auth.uid()` | assigned (select) | all | research rows written by the task |
| `company_kpi_current` | inherits `company_kpis` policies (security invoker) | same | same | |

Service client (tasks and server only actions): bypasses RLS, so it is only safe when every query names both the row id and the `organization_id` from the task payload. The rule is enforced by convention, by `schemaTask` payload schemas that make `organizationId` required, by the Biome import restriction that already exists, and by code review (`/check review`). Policy tests do not cover tasks (spec 0001 accepts this).

### Audit log

What is logged: every insert, update and delete on every kind T, U and E table and on the access control tables (`profiles`, `organization_members`, `expert_assignments`, later `invitations`), through the same `private.audit_row()` trigger attached in each table's schema file. Not logged: reads, `kpi_definitions` and other global reference data (migrations own them), and `scaffold_checks`. By whom: the trigger records the actor from the request claims, so a member, an expert, ops, a task (`service`) or a migration (`system`) are all distinguishable; a task acting for a user is tied to that user through the row's own columns (`requested_by`), not through the actor. Immutability: no policy allows a write, the table privileges for `insert`, `update` and `delete` are revoked from `anon`, `authenticated` and `service_role` (the trigger inserts as its definer), and `private.protect_audit_log()` raises on update or delete unless `app.audit_maintenance` is `on`, which only the feature 14 redaction function sets inside its own transaction. Retention: keep everything until feature 14 sets a retention rule; partition by month only if the table ever approaches the size where the best practices skill says to.

### Policy tests

Location `supabase/tests/`, one file per table plus one for the hook and one for `create_organization`, named `<subject>.test.sql`. Each file follows the Supabase pgTAP shape: `begin; create extension if not exists pgtap with schema extensions; select plan(n); … select * from finish(); rollback;`, so nothing it creates survives. Impersonation is a temporary function declared at the top of each file (no extension, no shared state):

```sql
create function pg_temp.impersonate(user_id uuid, app_role text, org_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', user_id, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', app_role, 'organization_id', org_id)))::text, true);
end $$;
-- back to the superuser between scenarios:
-- reset role; select set_config('request.jwt.claims', null, true);
```

Each test file sets up two organizations, a member of each, an expert with an assignment to one, and the ops user, as the `postgres` role, then asserts per role: `results_eq` or `is(count(*))` for what is visible, `throws_ok` with `42501` for a denied insert or update, `lives_ok` for an allowed one, and one audit assertion per write. Run with `pnpm test:db` (`supabase test db`), locally after `pnpm db:reset`, and in CI inside the job that starts the local database (the current `types` job, renamed `database`, runs the tests before the type diff). No Vitest test signs in against the stack; a Playwright test in feature 6 checks the claim end to end through the real sign in.

### Configuration required

No new environment variables or credentials. New scripts and jobs: `pnpm test:db` in `package.json`, the CI `database` job, and a `supabase/tests/` folder. `supabase/config.toml` needs no change (`schema_paths` already globs `./schemas/*.sql`; `04_realtime.sql` is renamed `90_realtime.sql` so it stays last).

### Critical test scenarios

- Happy path: a client member of organization A inserts a company, a research run and a client KPI row and reads them back; each write leaves one audit row with their id and role `client`, verifies **AC-3**, **AC-5**.
- Cross tenant: the same member selects organization B's companies and gets zero rows; inserting a company with `organization_id = B` fails with `42501`, verifies **AC-3**.
- Expert scope: an expert sees nothing for A, sees A's companies after an `active` assignment, and nothing again after it is `ended`, verifies **AC-4**.
- Ops: reads both organizations, updates a company in B, reads the audit row for it; an update on `audit_log` as ops, as `authenticated` and as `service_role` all raise, verifies **AC-4**, **AC-5**.
- Organization creation: a client with no membership calls `create_organization` and gets an id, a membership as owner, and a profile with that organization; a second call raises `already_member`; an expert calling raises `not_a_client`, verifies **AC-6**.
- Token hook: called with the seeded client user's id returns claims with both `role` and `organization_id`; with the expert's id, `role` only, verifies **AC-2**.
- Transitions: `research_runs` `queued → running → succeeded` succeeds, `succeeded → running` raises, verifies **AC-10**.
- Seed and migration: `pnpm db:reset` succeeds, the three seeded users plus the second client sign in (Playwright roles test extended), types are unchanged after `pnpm db:types`, verifies **AC-1**, **AC-8**, **AC-9**.

## Build plan

Tracer Bullet for a schema feature means: the thinnest thread that goes schema file → migration → policy test in CI → claim readable in TypeScript first, then thicken table by table. Everything is additive, so the milestones can merge as separate pull requests (one migration each) or as one.

1. Create `supabase/schemas/00_private.sql`: the `private` schema, `jwt_app_role`, `jwt_org_id`, `is_ops`, with grants noted for the migration, satisfies **AC-3**
2. Create `10_organizations.sql` and `11_organization_members.sql` (tables, indexes, RLS, policies, `is_org_owner`, `sync_profile_organization`, `create_organization`), extend `01_profiles.sql` (foreign key, `full_name`, `locale`, same organization select policy, self update policy, `handle_new_user` copies name and locale) and `02_access_token_hook.sql` (organization claim), satisfies **AC-2**, **AC-6**
3. Extend `supabase/seed.sql`: organization for `client@example.com` as owner, a second client user with their own organization, fixed ids, satisfies **AC-8**
4. Create the pgTAP harness: `supabase/tests/` with the impersonation snippet, tests for `organizations`, `organization_members`, `profiles`, `create_organization` and the hook; add `pnpm test:db`; rename the CI `types` job to `database` and run the tests in it before the type diff, satisfies **AC-7**, **AC-2**, **AC-3**, **AC-6**
5. Generate the migration with `pnpm db:diff data_model_core`, append by hand the `private` schema grants, the `create_organization` revoke, and the `profiles` column grants; `pnpm db:reset`, `pnpm test:db`, `pnpm db:types`, commit the types, satisfies **AC-1**, **AC-9** (the thin thread is complete here)
6. Add `organizationIdFromClaims` to `src/lib/auth/roles.ts` with Vitest cases in `tests/roles.test.ts`, satisfies **AC-2**
7. Create `13_audit_log.sql`: table, indexes, ops select policy, `protect_audit_log`, `audit_row`, and attach the audit trigger to `profiles`, `organizations`, `organization_members`; migration revokes on `audit_log`; pgTAP tests for the actor columns and immutability under all three app roles, satisfies **AC-5**
8. Create `12_expert_assignments.sql` with `is_assigned_expert`, policies, audit trigger and tests, satisfies **AC-4**
9. Create `20_kpi_definitions.sql`, `21_companies.sql`, `22_research_runs.sql` (with `check_research_run_transition`), `23_company_kpis.sql` (with the `company_kpi_current` view), attach audit triggers, rename `04_realtime.sql` to `90_realtime.sql` and add `research_runs`; pgTAP tests per table including the expert and ops paths and the transitions, satisfies **AC-3**, **AC-4**, **AC-5**, **AC-10**
10. Second migration (or fold into the first when shipped in one pull request), hand check grants, `pnpm db:reset`, `pnpm test:db`, `pnpm db:types`; extend `e2e/roles.spec.ts` for the second client user; update the README boot sequence with `pnpm test:db`, satisfies **AC-1**, **AC-7**, **AC-8**, **AC-9**

## Consequences

**Positive**:
- One predicate per table kind; a feature adds a table by copying the contract, and a wrong policy fails a pull request instead of leaking a row.
- The common client path checks a claim, not a join, so RLS costs almost nothing per row; expert access is an explicit row ops can list, end and audit.
- Every later table is named with its owner kind now, so Slices 3 to 8 are additive migrations, which the shared staging database for previews requires anyway.
- Erasure under the FADP is one organization delete plus one redaction, with the audit trail intact.

**Negative / tradeoffs**:
- A claim is only as fresh as the token: a removed member keeps read access for up to an hour unless feature 22 revokes their sessions, which it must.
- Policy tests are SQL in pgTAP, a second test language next to Vitest; they run only where the local stack runs (not in `pnpm test`).
- `security definer` helpers bypass RLS by design; a careless edit to one of them is a silent hole, so they stay few, in `private`, and reviewed.
- The audit trigger doubles the write count on every tenant table and stores full row copies; fine for pilots, worth a retention rule before the table is large.
- Tasks still hold the secret key; the `organizationId` payload rule is a convention, not something the database enforces.
- Grants are not in the diff, so every migration that adds a `private` function or an audited table needs hand added grant lines and a careful review.

**Neutral**:
- `profiles.organization_id` is now a maintained denormalization (the current organization); a future multi organization user only needs a switcher that updates it.
- Random UUIDs stay the primary key; switching new tables to a time ordered generator later is a default change, not a migration of data.
- `scaffold_checks` stays until feature 1 is verified; nothing here depends on it.

## Follow-up

- [x] Feature 6 (auth): sign up calls `create_organization` after the first sign in and passes `full_name` and `locale` as user metadata; a Playwright test asserts the organization claim through the real sign in.
- [ ] Feature 8 (research): seed `kpi_definitions` through a data migration; the research task takes `organizationId`, `companyId` and `researchRunId` and writes `company_kpis` rows with `source = 'research'`; decide the per organization run quota (spec 0001 puts it in Postgres).
- [ ] Feature 12 (ops admin): if support needs a record of what ops looked at, add an application level audit call (a `private` function that inserts an `audit_log` row with `action = 'read'`, which needs the check constraint widened, an additive change).
- [ ] Feature 14 (legal): write `private.redact_audit_subject(user_id)` under `app.audit_maintenance`, the erasure and export flows on top of the organization cascade, and the audit retention rule.
- [ ] Feature 22 (team): on membership removal revoke the user's sessions with the admin API, and keep the at least one owner rule in the action.
- [ ] After `/check verify stack & architecture` passes, drop `scaffold_checks` and its realtime publication entry in a later additive migration.
- [ ] `/sync`: add to root `AGENTS.md` the `pnpm test:db` command, the tenant table contract pointer, and the rules that new status columns use `text` plus `check` (never an enum) and that `security definer` functions live in `private`.

## Rationale

Reasoning, options considered and the decision detail: see [rationale.md](rationale.md).
