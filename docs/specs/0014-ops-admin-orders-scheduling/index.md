# 0014. Ops admin: orders, companies and scheduling

**Date**: 2026-09-08
**Status**: In Progress

## Summary

Ops can already see emails, enquiries, orders and experts, but they cannot see a company, and they
cannot record what happens after an order is paid. This spec adds a companies view and turns the
order into the delivery record: ops set the visit date and the assessor on the order itself, and
the order's status carries three new delivery states after `paid`. The client dashboard then shows
the date and who is coming. Nothing new is created in the database beyond four columns on `orders`,
because the tables for companies, research, benchmarks and expert access already exist and only
need reading.

## Requirements

**User stories**:
- As ops, I want to see every company with its research, its figures and its orders, so that I can
  answer a client question without opening the database.
- As ops, I want to record the agreed visit date and the assessor on a paid order, so that the
  client knows when the work happens and who is doing it.
- As ops, I want to move an order through the delivery states, so that the app's record matches
  what really happened.
- As a client, I want to see the date and the expert on my dashboard, so that I know the work is
  booked and by whom.
- As ops, I want a landing page that shows the work waiting on me, so that I know what to do next
  when I sign in.

**Acceptance criteria**:
- **AC-1**: `/admin/companies` lists every company across all organizations with its name, its
  organization, its canton, its employee count and the state of its latest research run, newest
  first, with keyset paging.
- **AC-2**: `/admin/companies/[companyId]` shows the company facts, its organization and that
  organization's members, every research run with status and provider run id, the KPIs of the
  latest succeeded run with their sources, the latest benchmark snapshot read through
  `SNAPSHOT_SCHEMAS`, and every order placed by that organization.
- **AC-3**: A paid order can be scheduled: ops pick a date in the future and an assignable expert,
  and the order moves `paid` to `scheduled` with `scheduled_at` and `assigned_expert_id` set. The
  same action upserts the active `expert_assignments` row for that expert and organization.
- **AC-4**: Scheduling refuses an expert who is not assignable (status not `active`), and the
  refusal comes from the database, not the app.
- **AC-5**: Scheduling refuses a date that is not in the future, and the refusal comes from the
  database.
- **AC-6**: Ops can move `scheduled` to `in_progress`, and `in_progress` to `delivered`, which sets
  `delivered_at`. Every other transition out of these states raises.
- **AC-7**: Ops can unschedule: `scheduled` back to `paid`, which clears `scheduled_at` and
  `assigned_expert_id`. The `expert_assignments` row is left active, because the expert may still
  legitimately hold access.
- **AC-7a**: Ops can correct the date or the expert on an order already `scheduled`, `in_progress`
  or `delivered` without moving its status, and the same guards apply as on the original schedule.
  A correction that names a different expert ends the superseded expert's assignment, unless that
  expert is still named by another order of the same organization whose status is `scheduled`,
  `in_progress` or `delivered`.
- **AC-8**: A client, an expert and an anonymous visitor cannot write any of the four delivery
  columns, and cannot reach any `/admin` route.
- **AC-9**: Scheduling sends the `assessment_scheduled` email to the client organization's members
  in each recipient's stored language, carrying the date and the expert's name, through the
  existing `sendEmail` rail.
- **AC-10**: The client dashboard shows, on each scheduled order, that order's own date and its
  assigned expert's name and photo, matched by the order's `assigned_expert_id` against
  `assigned_expert_summaries` and read with a signed `photoUrl`. An organization with several
  scheduled orders sees the right expert on each one.
- **AC-11**: `/admin` shows the work waiting on ops (paid orders with no date; orders whose
  `scheduled_at` is today or earlier in `Europe/Zurich` and whose status is still `scheduled` or
  `in_progress`; new enquiries; failed email deliveries; failed research runs) and counts for
  companies, open research runs, orders by status and active experts, each linking into its list.
  The scaffold checks demo is gone from that page.
- **AC-12**: Every delivery write is recorded in `audit_log` with the ops actor, through the
  existing `orders_audit` trigger.
- **AC-13**: Every new string is in both `messages/de-CH.json` and `messages/en-CH.json`, every new
  route is in `PATHNAMES`, and axe finds no violation on the new pages.

## Decision

**Chosen option**: Option 1: Extend `orders` with delivery columns and states, add read only ops
views, write through the service client.

The order is the delivery record. Four nullable columns and three additional statuses turn the
existing money row into the thing ops schedules, so no new table is created and the client
dashboard reads one row. Ops writes go through the service client after an ops check in the action,
the pattern spec 0011 already established for this table.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `frontend-design` (`anthropics/skills`, `.claude/skills/frontend-design/`) · `react-email` (`resend/resend-skills`, `.claude/skills/react-email/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**

Additive only. No new table.

`public.orders` gains four columns:

| Column | Type | Null | Notes |
|---|---|---|---|
| `scheduled_at` | `timestamptz` | yes | the agreed on site date and time |
| `assigned_expert_id` | `uuid` | yes | references `public.profiles (id)` on delete set null |
| `delivered_at` | `timestamptz` | yes | set when the order reaches `delivered` |
| `scheduled_by` | `uuid` | yes | references `public.profiles (id)` on delete set null, the ops actor |

`orders.status` check extends from five values to eight: `pending`, `paid`, `cancelled`,
`refunded`, `expired`, plus `scheduled`, `in_progress`, `delivered`.

Two indexes support the ops overview queue:

- `orders_paid_unscheduled_idx on public.orders (paid_at) where status = 'paid'`
- `orders_scheduled_at_idx on public.orders (scheduled_at) where status in ('scheduled', 'in_progress')`

Read as is, no change: `companies`, `research_runs`, `company_kpis`, `benchmark_snapshots`,
`organizations`, `organization_members`, `expert_profiles`, `assigned_expert_summaries`,
`expert_assignments`, `enquiries`, `email_deliveries`, `audit_log`.

**State transitions**

The existing `private.check_order_transition()` trigger gains edges. Current edges stay untouched:

```
pending -> paid | cancelled | expired
paid    -> refunded
```

Added:

```
paid       -> scheduled     requires scheduled_at not null and > now(), and assigned_expert_id not null
scheduled  -> in_progress
scheduled  -> paid          unschedule: requires scheduled_at and assigned_expert_id both null
in_progress-> delivered     requires delivered_at not null
delivered  -> refunded
```

Everything else raises, as today. Note the deliberate asymmetry on the future date check: it binds
only on the `paid -> scheduled` edge, so ops can correct the date on an order already
`in_progress` or `delivered` (recording a visit after the fact is real work), which is why the
check lives on that edge rather than as a table level constraint.

**The correction path needs a second trigger.** `orders_check_transition` is declared
`before update of status`, so it does not fire at all when only `scheduled_at` or
`assigned_expert_id` changes. Invariant 1 would therefore have no database guard on the correction
path AC-7a allows. A second trigger closes it:

```
create trigger orders_check_delivery_columns
  before update of scheduled_at, assigned_expert_id on public.orders
  for each row execute function private.check_order_delivery_columns();
```

`private.check_order_delivery_columns()` raises unless the row's status is one of `scheduled`,
`in_progress` or `delivered` and both columns are not null after the update. It does not re check
the future date, because a correction on an `in_progress` or `delivered` order is legitimately in
the past. It does not fire on the `paid -> scheduled` edge writing both columns in the same
statement as the status, because that update names `status` and is already covered; both triggers
firing on one statement is harmless, since both assert the same end state.

**API surface**

Server actions in `src/features/ops-admin/actions.ts`, each returning the typed result shape and
never throwing for an expected failure.

| Action | Inputs | Outputs | Auth | Key errors |
|---|---|---|---|---|
| `scheduleOrder` | `orderId` uuid, `scheduledAt` ISO datetime, `expertId` uuid | `{ ok: true }` | ops | `forbidden`, `validation`, `not_found`, `not_paid`, `expert_not_assignable`, `date_not_future`, `invalid_transition`, `unexpected` |
| `rescheduleOrder` | `orderId` uuid, `scheduledAt` ISO datetime, `expertId` uuid | `{ ok: true }` | ops | `forbidden`, `validation`, `not_found`, `not_scheduled`, `expert_not_assignable`, `unexpected` |
| `unscheduleOrder` | `orderId` uuid | `{ ok: true }` | ops | `forbidden`, `not_found`, `not_scheduled`, `unexpected` |
| `setOrderDeliveryState` | `orderId` uuid, `next` `'in_progress' \| 'delivered'` | `{ ok: true }` | ops | `forbidden`, `not_found`, `invalid_transition`, `unexpected` |

Every action reads the order, decides, then writes; the database is the arbiter, so a lost race
surfaces as the trigger's own exception. `scheduleOrder` maps the trigger message
`orders status is already %` to `invalid_transition`, so two ops scheduling the same order at once
give one success and one `invalid_transition`, never a silent overwrite. `check_expert_assignable`
raising maps to `expert_not_assignable`, which is how a deactivation racing a schedule is reported.

Queries in `src/features/ops-admin/queries.ts` (throw, per the project rule): `listCompanies`,
`getCompanyDetail`, `listOpsQueue`, `listOpsCounts`.

**Value sourcing**

| Action | Value produced or displayed | Source |
|---|---|---|
| `scheduleOrder` | the ops actor id | `auth.getClaims()` in the action, written to `scheduled_by` |
| `scheduleOrder` | expert assignability | the `check_expert_assignable` trigger, spec 0013 |
| `scheduleOrder` | the organization to grant the expert | `orders.organization_id` on the order row |
| `scheduleOrder` | "now" for the future date check | `now()` in the transition trigger, database clock |
| `scheduleOrder` | the email recipients | every `organization_members` row of `orders.organization_id`, whatever their role, the same set `expert_assigned` already uses |
| `scheduleOrder` | each recipient's language | `profiles.locale`, not null with default `'en'`, so there is no unset case; `sendEmail` already resolves it |
| `scheduleOrder` | the expert's display name in the email | `profiles.full_name` of `assigned_expert_id` |
| `scheduleOrder` | the date's rendering | the recipient's `profiles.locale` plus the `Europe/Zurich` zone, the zone `years.ts` already fixes |
| `scheduleOrder` | the `expert_assignments` conflict target | `(organization_id, expert_id) where status = 'active'`, the existing partial unique index; an `ended` row is never revived, a new row is inserted instead |
| `rescheduleOrder` | whether to end the superseded assignment | ended unless another order of the same organization with status `scheduled`, `in_progress` or `delivered` still names that expert |
| `setOrderDeliveryState` | `delivered_at` | `now()` in the action, written on the `delivered` edge |
| client dashboard | which expert belongs to which order | the order's own `assigned_expert_id` matched against `assigned_expert_summaries.expert_id` |
| client dashboard | the expert name, headline and photo path | `assigned_expert_summaries`, filtered to the caller's org |
| client dashboard | the photo URL | `photoUrl` on the caller's user client, a ten minute signed URL, spec 0013 |
| `listOpsQueue` | "overdue" for an order | `scheduled_at <= now()` with status in `('scheduled', 'in_progress')`, compared in `Europe/Zurich` |
| `getCompanyDetail` | the benchmark figures | the latest `benchmark_snapshots` row read through `SNAPSHOT_SCHEMAS` by its stored version |
| `/admin/companies` | the latest run state per company | the newest `research_runs` row for that company |

**Key invariants**

1. `scheduled`, `in_progress` and `delivered` each imply `scheduled_at` and `assigned_expert_id`
   are both not null; `paid` implies both are null. Enforced by the transition trigger on a status
   change and by `orders_check_delivery_columns` on a correction that leaves status alone, so
   neither write path can break it.
2. `delivered` implies `delivered_at` is not null. Enforced by the transition trigger.
3. `UPDATE` on `orders` stays revoked from `anon` and `authenticated`, with no column granted back.
   Every ops write goes through the service client after the action authorizes ops.
4. An expert reaches an organization's rows only through an active `expert_assignments` row.
   Scheduling upserts that row; it never grants access another way. A re assignment ends the
   superseded expert's row unless another live order of that organization still names them, so
   access does not accumulate silently.
5. A scheduled order's expert was assignable at the moment of the write, enforced by the database
   trigger, so a deactivation racing a schedule cannot land.
6. Delivery states never move money. `paid_at`, the amounts and the invoice are untouched by every
   action in this spec.

**Security model**

- Every `/admin` route stays behind the proxy's ops gate and every action re authorizes ops itself,
  never trusting the proxy alone.
- Ops read companies, research, KPIs, snapshots, organizations and members through the existing
  `is_ops()` policies; no policy is widened.
- Clients read their own order's `scheduled_at` and `assigned_expert_id` through the existing
  member select policy on `orders`, and the expert's public half through
  `assigned_expert_summaries`, which already scopes to the caller's organization.
- No new personal data is stored. The expert's identity reaching the client is the same public half
  spec 0013 already exposes.
- Every delivery write lands in `audit_log` through the existing `orders_audit` trigger, so the
  revised FADP trail covers scheduling as it covers payment.

**Configuration required**

None. No new environment variable, credential or third party.

**Critical test scenarios**

- Happy path: ops schedule a paid order, the order reads `scheduled` with both columns set, the
  `expert_assignments` row is active, and the client dashboard shows the date and the expert,
  verifies **AC-3**, **AC-10**.
- Failure case: scheduling with a past date raises from the database, and with a deactivated expert
  raises from `check_expert_assignable`, verifies **AC-4**, **AC-5**.
- Failure case: `paid` straight to `delivered`, and `delivered` back to `scheduled`, both raise,
  verifies **AC-6**.
- Concurrency: two ops schedule the same order at once; one wins, the loser gets
  `invalid_transition` mapped from the trigger's `orders status is already scheduled`, rather than
  a silent overwrite, verifies **AC-3**.
- Concurrency: an expert is deactivated between the ops read and the write; the write is refused by
  `check_expert_assignable` and reported as `expert_not_assignable`, verifies **AC-4**.
- Correction path: `scheduled_at` updated alone on an `in_progress` order fires
  `orders_check_delivery_columns`; nulling `assigned_expert_id` alone raises, verifies **AC-7a**.
- Re assignment: an order rescheduled to a different expert ends the first expert's assignment, but
  not when that expert still holds another live order of the same organization, verifies **AC-7a**.
- Two scheduled orders in one organization each show their own expert on the dashboard,
  verifies **AC-10**.
- Auth: a client and an expert calling each action get `forbidden`; a direct `UPDATE` on the four
  columns as `authenticated` is refused by the revoke, verifies **AC-8**.
- Unschedule: `scheduled` back to `paid` clears both columns and leaves the assignment active,
  verifies **AC-7**.
- Email: scheduling queues `assessment_scheduled` to every member in their stored language,
  verifies **AC-9**.
- Accessibility: axe over `/admin/companies`, `/admin/companies/[companyId]`, the scheduling dialog
  and the rebuilt `/admin`, verifies **AC-13**.

## Build plan

Tracer Bullet, so the first slice runs the whole thread (migration, action, ops UI, client UI)
before the read only surfaces thicken it.

1. Migration: the four columns, the extended status check, the two partial indexes, the new
   transition edges in `private.check_order_transition()` and the new
   `private.check_order_delivery_columns()` with its `orders_check_delivery_columns` trigger, plus
   the pgTAP file covering every added edge, both guards, the correction path and the revoke,
   satisfies **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-7a**, **AC-8**, **AC-12**.
2. The scheduling thread end to end: `src/features/ops-admin/` with `schema.ts`, `scheduleOrder`
   writing the order and upserting the assignment through the service client, the trigger error to
   typed error mapping, the scheduling dialog on `/admin/orders` with the expert combobox and the
   date field, and the per order date plus expert card on the client dashboard, satisfies **AC-3**,
   **AC-4**, **AC-5**, **AC-10**.
3. The delivery states and the correction path: `setOrderDeliveryState`, `unscheduleOrder` and
   `rescheduleOrder` with the superseded assignment rule, their controls on the orders row, and the
   status badge extended to the three new states in both catalogs, satisfies **AC-6**, **AC-7**,
   **AC-7a**, **AC-13**.
4. The `assessment_scheduled` email: the schema entry, the React Email component, the registry
   entry, `email.assessmentScheduled.*` keys in both catalogs and the preview, fired from
   `scheduleOrder`, satisfies **AC-9**.
5. Companies list and detail: `listCompanies` and `getCompanyDetail`, `/admin/companies` with
   keyset paging and `/admin/companies/[companyId]` with the research, KPI, snapshot, organization
   and order blocks, plus the two `PATHNAMES` entries and the sidebar entry, satisfies **AC-1**,
   **AC-2**, **AC-13**.
6. The real `/admin` overview: `listOpsQueue` and `listOpsCounts`, the queue and count tiles
   replacing the scaffold checks demo, satisfies **AC-11**.
7. Hardening: Vitest over the pure pieces and the actions, the Playwright ops thread with axe over
   every new page, and the design gallery section for any new primitive, satisfies **AC-13**.

## Consequences

**Positive**:
- Ops get the company view they have never had, so a client question is answered in the app rather
  than in the database.
- The order becomes the single delivery record, so the client dashboard reads one row and the
  status badge tells the whole story from `pending` to `delivered`.
- No new table, no new environment variable and no new third party, so the operational surface does
  not grow.
- Scheduling and expert access are written by one action, so an expert can never be booked without
  the access they need to do the work.

**Negative / tradeoffs**:
- `orders.status` now carries two concerns, payment and delivery, on one column. A future refund of
  a delivered order, or a delivery that must be re opened, will strain the single state machine,
  and splitting the column later is a migration across live rows.
- Ops writes bypass RLS through the service client, so the ops check in the action is the only
  boundary. A missing check is a real hole, which is why every action re authorizes and pgTAP
  cannot catch it for us.
- Unscheduling leaves the `expert_assignments` row active on purpose, so an expert keeps read
  access to an organization they are no longer booked for until ops end it. That is the safer
  default but it is a standing grant.
- Feature 24 (ops metrics) will want counts this overview also computes, so some query work is
  likely done twice unless feature 24 reuses `listOpsCounts`.

**Neutral**:
- The `Follow-up` list carries the three carried over items this spec deliberately leaves out
  (benchmarks read only, TOTP, refunds), so the scope's carried over note stays honest.
- One new email template joins the eight already on the rail; the two assignment emails from spec
  0013 are reused unchanged.

## Migration plan

**Strategy**: no migration needed beyond one additive schema change. No live data is transformed
and no backfill runs, because all four columns are nullable and every existing row keeps its
current status.

**Phases**:
1. The schema change lands in `supabase/schemas/41_orders.sql` and is diffed with
   `pnpm db:diff`: four nullable columns, the widened `status` check, the two partial indexes and
   the added edges in `private.check_order_transition()`. Existing rows are untouched and every
   current transition still passes, so a deploy of this migration alone leaves the running app
   working.
2. The application code ships after, reading and writing the new columns. Because the columns are
   nullable and the old statuses are unchanged, the code and the migration may deploy in either
   order without breaking the other, which matters because previews share staging.

**Rollback**: revert the application commit. The migration itself needs no revert: nullable columns
and unused status values are inert to code that ignores them. Only if the widened check must
actually be narrowed again would rows in the three new states have to be moved back to `paid`
first, and that is not expected.

**Risks**:
- The declarative diff drops a table level `REVOKE ALL` column grant and rewrites a view body from
  `select *` to a column list; `AGENTS.md` names both. This migration touches neither a view nor a
  column grant, but the generated file must still be read before commit, because the `orders`
  revoke is the invariant holding invariant 3.
- Three worktrees have shared one local Supabase stack in the past, so `db:reset` can silently skip
  a migration. Confirm the four columns exist after the reset before running pgTAP.

## Follow-up

- [ ] Benchmarks read only view with the provisional flags, plus a per company snapshot list with a
  recompute action, carried from spec 0008 and needed by feature 25 before launch. Deliberately out
  of this spec; it is a read only surface with no state machine and belongs with the peer data
  curation work.
- [ ] TOTP enrollment with an `aal2` check in the proxy for `/admin`, and an inactivity cutoff for
  ops sessions, carried from spec 0005. The `[auth.mfa]` block in `supabase/config.toml` is pushed
  on every deploy, so the switch lives there. Out of this spec because it is an auth decision, not
  an ops surface one.
- [ ] The client facing refund path deferred by spec 0011: a real refund needs credit note
  numbering against the gapless invoice sequence and a QR bill reversal, which is its own decision.
  Ops refund in Stripe by hand and the `delivered -> refunded` edge records it.
- [ ] Splitting delivery off `orders.status` into its own column, if a delivered order ever needs
  to re open or a refund must coexist with a delivery state.
- [ ] Ops notes on a company, the equivalent of `expert_ops_notes` from spec 0013, if ops ask for
  it once they use the company detail page.
