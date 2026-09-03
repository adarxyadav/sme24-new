# 0002. Core data model and access rules: rationale

Decision record for [index.md](index.md). Read by people and by `/architect` on update or supersede, not during a build.

## Context

SME24 keeps three kinds of people in one database: client organizations with several members each, invited EHS experts who work for several clients over time, and the ops team who sees everything. The scaffold (spec 0001) already has a `profiles` table with a role, an access token hook that copies the role into the token, a request proxy that gates the three areas by that role, and RLS switched on. What it does not have is the thing every slice stands on: which table belongs to whom, how a client's rows stay invisible to every other client, how an expert gets into a client's data and out again, and how ops access is recorded.

Forces. The build approach is Tracer Bullet, so Slice 1 (auth, email, the research pipeline) starts next and needs real tables within days, while the tables for assessments, programs and orders belong to features whose own specs decide their shape. Previews share the staging database, so every migration must be additive. The compliance scope is the revised FADP with GDPR readiness: personal data must be deletable and exportable, and ops access to client data should be traceable. The team is one or two people, so the access model must be one pattern to copy, not a per table invention, and a wrong policy must fail a test rather than wait for a customer to notice. Postgres 17 on Supabase in Zurich is fixed, and the four client factories plus the service key in tasks are already how data is reached.

Not deciding means feature 6 invents an organization model, feature 8 invents its tables, and the first policy leak is found by a pilot client.

## Options considered

The options differ in how tenancy is expressed and checked; the entity list is largely the same across them.

### Option 1: Shared schema, organization id on tenant tables, organization claim in the token, assignment table for experts, ops by role

Every client owned table has `organization_id`; the hook puts the user's current organization in `app_metadata`; member policies compare that claim; experts reach an organization through an `expert_assignments` row read by a small `security definer` helper; ops policies check the role claim. A row trigger writes an append only audit log. Policies are tested with pgTAP inside the database.

**Pros**:
- The common path (a member reading their own rows) is a column compared to a claim: no join, no helper, fast on every table.
- Expert access is data (a row with a status), so it can be listed, ended and audited like anything else.
- One template per table kind, shipped with a test harness, so later features copy rather than design.

**Cons**:
- Claim freshness: a membership change shows at the next token refresh, so removal must also revoke sessions.
- `security definer` helpers and the audit trigger bypass RLS by design and must be reviewed with care.

### Option 2: Same schema, membership lookup inside every policy (no organization claim)

Every member policy calls a `security definer` helper that checks `organization_members` for `auth.uid()`; the token carries only the role.

**Pros**:
- Always fresh: removing a member takes effect on the next query.
- Supports a user in several organizations with no change to the claim shape.

**Cons**:
- Every policy on every tenant table runs a lookup (indexed, but per statement on every read and write, and in every realtime evaluation).
- Spec 0001 already committed to the organization claim; the proxy and the UI would still need it for the current organization.

### Option 3: Everyone lives in an organization (experts and ops as organizations too), uniform membership based policies

Experts get one person organizations, ops an internal organization, and every table is reached through memberships and a cross organization grant table.

**Pros**:
- One uniform model, no role special cases in policies.
- Expert firms with several experts fit naturally.

**Cons**:
- Ops access becomes a grant to every organization, which is either a row per organization to keep in step or a special case anyway.
- More tables and more indirection before Slice 1 ships; the scope has no expert firm and no public expert sign up.

### Option 4: A schema or database per client organization

Each client gets its own Postgres schema; the connection picks the schema.

**Pros**:
- Strongest isolation story, easy per client export and deletion.

**Cons**:
- Supabase Auth, PostgREST, Realtime and the generated types all assume a fixed set of exposed schemas; per tenant schemas fight the platform.
- Migrations multiply by tenant, benchmarks across clients need a cross schema view, and experts and ops need cross schema access anyway. Only worth it for enterprise contracts that demand it, which the pilots do not.

## Rationale

Option 1 fits the forces best. The claim based member check is what spec 0001 planned, what the proxy already reads, and the cheapest predicate Postgres can evaluate, which matters because RLS runs on every query and on every realtime change. Its one weakness, claim freshness, is bounded by the one hour token life and closed by revoking sessions on removal, a two line change in feature 22. Expert access as an assignment row is the only shape that gives ops a list of who can see what, which is what an FADP processing record wants. Option 2 pays a lookup on every query to solve a problem (users in many organizations) the scope does not have, and Option 3 adds structure for expert firms that do not exist. Option 4 fights the platform the stack decision chose.

On the scope of feature 3 (decision 6): the scope's Done when says the model supports Slices 1 to 8 without a breaking migration. That promise is kept by two things, not by creating every table now: the tenant table contract (columns, policies, audit, index) and the target map that names each later table with its owner kind. The tables whose columns are another feature's headline decision (questionnaire versioning in feature 17, order states in feature 11, the peer data set in feature 9, program structure in feature 20) would be guesses today and a migration tomorrow. Shipping the Slice 1 and 2 tables now, with the harness, is the Tracer Bullet version: real, narrow, tested end to end.

On the audit log (decision 4): a trigger sees every write regardless of who made it (a page, a task, a migration), which application level logging cannot. Append only for every app role plus a guarded maintenance path is the smallest design that satisfies both "nobody can edit the trail" and "the FADP lets a person have their data erased".

On policy tests (decision 5): pgTAP tests the policy where it lives, needs no sign in, no HTTP and no seeded session, and runs in the CI job that already boots the stack for the types check. Vitest against the stack would exercise the full client path, which is valuable once, so feature 6 adds a single Playwright check of the claim through the real sign in rather than a second policy suite.

## Design conversation record

The interview was not run live; you gave the six decisions, the constraints and the reading list in the `/architect` brief, and this spec answers them with a recommended pick and a runner up each. Inferred framing: FEATURE mode on the existing stack, web, TypeScript and Supabase per `AGENTS.md`, Tracer Bullet, GA tier, revised FADP. Choices made on your behalf as RECOMMEND items, each reversible by editing the spec before `/develop`: random UUID primary keys (matching the scaffold) instead of a time ordered generator; `text` plus `check` for new status columns instead of enums; a `private` schema for helpers instead of `public`; one organization per client user enforced in functions, not by a constraint; `company_kpi_current` as a view now rather than in feature 10; the CI `types` job renamed `database` instead of a new job; no References section (default when the references consent was not asked).

## References

Not requested. The reasoning above stands on the project sources named inline (spec 0001, `AGENTS.md`, the installed `supabase` and `supabase-postgres-best-practices` skills) and no web links were fetched.
