# Review, feat/data-model, 2026-09-04

**Reviewed by**: Claude Opus 5 (author on a different model)
**Scope**: 35 files, branch vs main (merge base d59176b)
**Verdict**: Changes requested

## Summary

This is the core data model for feature 3: ten tables, the tenancy helpers in a `private` schema, an append only audit log, a pgTAP suite of 204 assertions and the CI job that runs it. The tenancy design is sound and the central isolation property holds. I tried a dozen cross tenant reads and writes against the running local stack and every direct attempt was refused by policy: a client cannot select, insert or move rows into another organization, and an expert cannot widen, edit or delete their own assignment.

The problems are on the paths around that core rather than in it. One is a real privilege escalation: a client owner can insert an arbitrary user id into their own organization, and because a trigger then writes that organization into the victim's profile, the access token hook mints an organization claim for a user who never consented. That reaches an ops or expert account. Two more findings are about the audit log and the contract test promising more than they deliver: TRUNCATE is open to `anon` and `authenticated` on every tenant table and leaves no trail, and the contract test would pass a future table whose policy is `using (true)`.

## Blockers

### 🔴 An owner can force any user into their organization and mint them an organization claim, `supabase/schemas/11_organization_members.sql:29`

**Problem**: The insert policy checks only that the row names the caller's own organization and that the caller owns it. Nothing constrains `user_id`. An owner can therefore insert any `auth.users` id, including an expert or an ops account. The `private.sync_profile_organization` trigger at line 77 then sets `profiles.organization_id` for that victim whenever it was null, and `public.custom_access_token_hook` copies it into the victim's next access token.

CONFIRMED on the freshly reset local stack. As the seeded client owner of org A:

```
insert into public.organization_members (organization_id, user_id, role)
values ('aaaaaaaa-…', '33333333-…' /* the ops user */, 'owner');
```

succeeds, and `public.profiles` for the ops user then reads `organization_id = aaaaaaaa-…`. Feeding that user id to `custom_access_token_hook` returns `{"role": "ops", "organization_id": "aaaaaaaa-…"}`. The same works for the expert user.

**Why it matters**: This inverts the tenancy story the spec tells. An attacker who registers as a client and creates an organization can attach staff accounts to their own tenant without consent. Every `members read their organization` policy trusts the organization claim on its own with no membership lookup, so the victim's session then reads the attacker's tenant, and any page that keys off the claim treats them as a member. It also silently rewrites an ops user's profile, which is a state the ops area is not written to expect. The insert is genuinely a hole rather than a theoretical one: it needs only a normal signed in client and the PostgREST table endpoint.

**Suggested fix**: Do not let a policy be the only gate on who joins an organization. Membership should arrive through an accepted invitation, which is where feature 22 is heading anyway, so bring forward the minimum of it now. Until then the narrow fix is to stop `authenticated` from inserting into `organization_members` at all and route owner adds through a security definer function that verifies the target user consented, or at least that the target is a `client` with no existing organization. Whichever route you take, also reconsider whether `sync_profile_organization` should write a profile on insert; having the membership row drive the victim's claim is what turns a bad row into a bad token.

### 🔴 Every tenant table can be truncated by `anon` and `authenticated`, with no audit row, `supabase/schemas/01_audit_log.sql:42`

**Problem**: The audit log revokes `insert, update, delete, truncate` from the three app roles for itself, and the contract test asserts exactly that. No tenant table does the same. Supabase's stock default privileges hand `anon`, `authenticated` and `service_role` the full `arwdDxtm` set on every new table in `public`, so all of them hold TRUNCATE on `companies`, `company_kpis`, `research_runs`, `organizations`, `organization_members`, `expert_assignments` and `profiles`. TRUNCATE is not filtered by RLS and fires no row trigger, so it wipes every organization at once and writes nothing to `audit_log`.

CONFIRMED on the local stack: `set local role anon; truncate table public.company_kpis;` succeeds. On `companies` the statement stops on a foreign key complaint rather than a permission one, which confirms the privilege check itself passed. Truncating `audit_log` is correctly refused with `permission denied`.

**Why it matters**: The spec's promise is that every write is recorded and nobody can erase the trail. A single request destroys all client data across all tenants and leaves the audit log showing nothing happened, which is the opposite of what the FADP story in the spec requires. RLS being the real boundary is the project's stated model, and TRUNCATE is the one DML verb that walks around it.

**Suggested fix**: Revoke `truncate` from `anon`, `authenticated` and `service_role` on every table in `public`, in the schema files next to each table so the pattern is visible, and add the matching lines to a migration by hand since grants are not diffed. Then extend the contract test's existing audit log grant sweep to cover every table rather than only `audit_log`, so a later slice cannot reintroduce it. It is worth checking `delete` on the same pass: `anon` holds insert, update and delete on all of these too, and while RLS does block those today, revoking what no role should ever need is cheaper than trusting every future policy.

## Major

### 🟠 The contract test passes a future table whose policy is wide open, `supabase/tests/contract.test.sql:23`

**Problem**: The contract test is the mechanism the spec relies on to keep slices 1 to 8 honest, but it checks only structural facts: RLS is enabled, an audit trigger exists, `organization_id` is not null and references organizations, functions pin `search_path`, views are `security_invoker`. It never inspects a single policy expression, and it never asserts that a table has any policy at all.

CONFIRMED by creating a table in a rolled back transaction with `organization_id not null references organizations on delete cascade`, an id column, RLS enabled, the audit trigger attached, and one policy `for all to authenticated using (true) with check (true)`. Every contract check passes.

Concretely, these bad shapes get through today: a table whose only policy is `using (true)`; a table with RLS on and zero policies (invisible to the app, so it fails loudly rather than leaking, but the test claims to catch shape problems); a policy that filters on `company_id` but forgets `organization_id`; a table whose grants were never revoked from `anon`; and a table that should be in the realtime publication but is not, since the publication assertion is a hand written list that a new table simply is not on.

**Why it matters**: The spec sells this file as the thing that makes a wrong policy fail CI instead of leaking a row. It does not do that. A later slice can add a cross tenant readable table and the pull request stays green, which is worse than having no contract test because it buys false confidence.

**Suggested fix**: Add assertions over `pg_policy` rather than only over `pg_class`. At minimum: every tenant table has at least one policy; no policy on a tenant table has a qualifier of literal `true` unless the table is on a recorded exception list (as `kpi_definitions` legitimately is); every tenant table's select policy text mentions `organization_id` or one of the two tenancy helpers. A text level assertion on `pg_get_expr(polqual, polrelid)` is crude but catches the shapes above. Also say in the file's header comment what the test does not check, so the next author does not over trust it.

### 🟠 A member can repoint a `company_kpis` row at another organization's company, `supabase/schemas/23_company_kpis.sql:61`

**Problem**: The insert policy correctly requires that `company_id` belongs to a company of the caller's organization, through the `exists` subquery at line 55. The update policy checks `organization_id`, `source` and `created_by` but drops that company check, so `company_id` is freely writable within the row.

CONFIRMED: as the seeded client of org A, inserting a valid client KPI for company A and then running `update public.company_kpis set company_id = '<company in org B>'` succeeds, leaving a row with `organization_id` of A and `company_id` of B.

**Why it matters**: It is not a read leak, and I checked that: the other organization still sees zero rows because their select policy filters on `organization_id`. What it produces is a row that no query can reach through either tenant, and worse, a row whose two identifiers disagree. Any later feature that joins from company to KPI without also filtering on `organization_id`, which is a natural thing to write given `company_id` looks like the specific key, turns this into a genuine cross tenant read. The same asymmetry exists on `research_runs`, which avoids it only because members have no update policy there at all.

**Suggested fix**: Repeat the `exists` company check in the update policy's `with check`, matching the insert policy. Better still, since `company_id` should never change for the life of a KPI row, block the column from moving at all with a trigger or by not granting update on it, which also removes the class of bug rather than one instance. Add a negative pgTAP case for it: the current `company_kpis` tests cover cross organization inserts but not this repoint.

### 🟠 The access token hook passes a self supplied `app_metadata.role` through when the profile row is missing, `supabase/schemas/02_access_token_hook.sql:25`

**Problem**: The hook reads the profile, and only rewrites `app_metadata` when `user_role is not null`. When no profile row exists the incoming claims are returned untouched, and Supabase builds those from `raw_app_meta_data`, which sign up can influence.

CONFIRMED: calling the hook with a user id that has no profile and claims `{"app_metadata":{"role":"ops"}}` returns `{"role": "ops"}` unchanged.

**Why it matters**: The whole role model rests on the hook being the only writer of `app_metadata.role`. Today `handle_new_user` creates a profile for every new auth user so the window is narrow, but it is not closed: a user whose profile was deleted, a user created by a path that bypasses the trigger, or any future change to that trigger reopens it, and the failure mode is a self assigned ops role. The comment at line 5 states the top level `role` claim is left alone, but says nothing about this branch.

**Suggested fix**: Make the else branch explicit rather than implicit. When no profile is found, strip `role` and `organization_id` from `app_metadata` instead of returning the claims as they arrived, so the hook always fully owns those two keys. Add a pgTAP case for the missing profile input; `access_token_hook.test.sql` covers the present profile cases well but not this one.

## Minor

### 🟡 The pgTAP suite is not isolated from pre-existing rows, `supabase/tests/research_runs.test.sql:82`

The suite passes on a clean reset, but it inserts fixture rows with fixed keys and depends on the seed's exact contents. While probing I had added a `kpi_definitions` row with key `ltifr` and a couple of companies, and five of the twelve files then failed, four of them with a bad plan before running a single assertion. CI always starts from a fresh container so this will not flake there, but it makes the suite unpleasant to run locally against a database you have touched, and a bad plan failure hides which assertion actually broke. Consider namespacing fixture keys per test file, or asserting the preconditions the file needs at the top so a dirty database fails with a clear message.

### 🟡 Members can add rows but the read policy trusts the claim alone, `supabase/schemas/11_organization_members.sql:23`

Every `members read their organization` policy across the five tenant tables resolves membership purely from `private.jwt_org_id()`. There is no check that the caller is still a member. That is a deliberate performance choice and the token refresh window is bounded by `jwt_expiry`, which the header comment in `02_access_token_hook.sql` acknowledges, so I am not raising it as a blocker on its own. It is worth recording explicitly in the spec's Consequences that a removed member keeps reading their old organization until their token expires, because it is exactly the property the blocker above exploits, and a reader of the schema files would not infer the window from them.

### 🟡 The CI job rename drops the configured branch protection check, `.github/workflows/ci.yml:39`

The job id changes from `types` to `database`. AGENTS.md notes branch protection on `main` and `production` requiring `check` is still to set, so nothing breaks today, but if a required status check named `types` was ever configured it silently stops being reported and the rename reads as green. Worth a note in the PR description so whoever sets branch protection uses the new name.

### 🟡 `create_organization` and the token hook stay executable by `service_role`, `supabase/migrations/20260903195301_data_model_tables.sql`

Already known and listed below, but recording the severity opinion here: the bodies do refuse (`create_organization` demands `auth.uid()` and the client role, the hook is only meaningful to the auth admin), so the practical risk is low. It is still worth an explicit revoke rather than relying on the body, because the body's guard and the grant are two different authors' assumptions and only one of them is written down.

## Nits

- ⚪ `supabase/schemas/23_company_kpis.sql:112`, `select distinct on (…) *` in a view means a later column added to `company_kpis` silently joins the view's contract. Listing the columns costs nothing and makes the view's shape a decision rather than a consequence.
- ⚪ `supabase/schemas/21_companies.sql:9`, the `uid` column holds a Swiss CHE identifier but has no format check, unlike `canton` right below it which does. Either check both or neither.
- ⚪ `supabase/schemas/12_expert_assignments.sql:64`, the transition error message interpolates old and new status but the assignment id would be more useful in a log than the statuses, which the caller already knows.
- ⚪ `supabase/seed.sql:18`, the four user ids are readable placeholders, which is good, but the file is documented as apply by hand on staging once. A guard that refuses to run when the database already holds non seed users would make that instruction enforceable rather than advisory.

## Already known

Raised by the engineer up front, so listed with my severity opinion only, not as fresh findings.

- The postgres superuser can truncate `audit_log`. Agreed, and out of scope for a policy layer. Note the related tenant table TRUNCATE gap above is a different and much more serious thing, because it does not need a superuser.
- `service_role` keeps execute on `create_organization` and the token hook. Minor, see above.
- The owner update policy on `organizations` is not narrowed to `name`. Minor. An owner can currently set `archived_at` and `created_by` on their own organization. Neither is a cross tenant problem, but `archived_at` will mean something to a later feature, so narrow it before that feature exists.
- `public.handle_new_user` is security definer. Correct and necessary, and the contract test names it as one of the two allowed exceptions, which is the right way to record it.
- `organizationIdFromClaims` accepts an uppercase uuid. Nit rather than a decision owed. Postgres accepts either case for a uuid literal, so it cannot cause a mismatch; the only cost is that two spellings of one id can flow through the app. Lowercasing on read is one line if you want the canonical form.
- pgdelta grant drift. I checked every grant, revoke and default privilege in `supabase/schemas/*.sql` against the two migrations. Each one has a matching line, and I found nothing in the migrations that exceeds the schema files, with one thing to note: `REVOKE ALL ON SCHEMA "public" FROM "supabase_auth_admin"` in the older init migration is immediately followed by the usage and select re-grants, so the token hook path stays intact. The parity is good.

## Strengths

- The tenancy core genuinely works, and it holds up under attack rather than only under the tests. Cross tenant select, insert and update are all refused on every tenant table, and the expert path is the tightest part of the change: an expert cannot insert an assignment, cannot repoint one at another organization, and cannot delete one to cover their tracks. I tried all three.
- Putting the helpers in a `private` schema that is not exposed to PostgREST, marking only the two that read a table as security definer, and explaining in the file header exactly why each one needs it, is the right call and unusually well documented.
- `private.audit_row` is a good piece of work. One generic trigger, actor and role derived from the request claims, and the `service` versus `system` distinction correctly resolved. I checked a service role insert and it is labelled `service` as intended.
- Using column grants rather than a policy to stop a user changing their own role and organization is the correct instinct, and it is what stopped the escalation above from being directly self serviceable.
- The unit tests for `organizationIdFromClaims` are thorough in the way security helper tests should be: malformed uuids, non string values, whitespace, an injection shaped string, and an explicit case proving a top level claim cannot override `app_metadata`.

## Test coverage

204 pgTAP assertions across twelve files, all passing on a clean reset, plus 45 Vitest assertions and a new e2e case for the second seeded client. Coverage per table per role is real, and the negative cases are present for the paths the author thought about: cross organization select returning zero rows, cross organization insert refused, a client refused on `kpi_definitions`, an expert seeing nothing before an assignment exists and nothing after it is ended.

What is untested is the space around those paths, which is where all four significant findings live. There is no case for an owner inserting a `user_id` that is not their own, none for the profile sync trigger firing on a victim, none for TRUNCATE against any table other than `audit_log`, none for repointing `company_kpis.company_id` on update, and none for the token hook with a missing profile row. Each of those is a single assertion in a file that already exists. The contract test is the other gap, and it is the structural one: it is the file the spec relies on to police later slices, and it currently asserts shape without ever asserting a policy means anything.
