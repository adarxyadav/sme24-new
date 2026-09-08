# 0014. Ops admin: orders, companies and scheduling, rationale

Reasoning and options behind [index.md](index.md). `/develop` does not need this file.

## Context

The ops area is not empty. `/admin/emails` and `/admin/enquiries` arrived with specs 0006 and 0009,
`/admin/orders` with spec 0011 as the minimal list that spec asked for, `/admin/experts` with spec
0013, and the shared `AreaShell` with its sidebar came from spec 0003. So the shell this feature was
once expected to build already stands, and the sidebar already has five entries.

Two real gaps remain. First, ops cannot see a company at all. There is no `/admin/companies`, so
when a client questions a figure, the only way to see the research run, the extracted KPIs and the
benchmark snapshot behind it is to open the database. Every table needed is already there and
already readable by ops through an `is_ops()` policy; nothing surfaces them.

Second, and larger: the app records that an order was paid and then stops. `orders.status` runs
`pending` to `paid` to `cancelled`, `expired` or `refunded`, which is a payment state machine and
nothing more. The product sells an on site assessment by a named expert on an agreed date, and
neither the date nor the expert exists anywhere. The client pays and the dashboard goes quiet. The
`expert_assignments` table from spec 0002 grants an expert access to an organization, and spec 0013
made ops able to invite and deactivate experts, but nothing connects an expert to a particular
order or a particular day.

The forces shaping the choice: `orders` is a money table with a deliberately tight write model
(spec 0011 revoked `UPDATE` from `authenticated` with no column granted back, and routes ops writes
through the service client because ops and clients share the `authenticated` role); migrations must
stay backward compatible because previews share staging; and features 17 and 18 will introduce
structured assessment forms and a gap report, which will want a delivery record of their own, so
whatever is built now should not block that or pre empt its shape.

## Options considered

### Option 1: Delivery columns and states on `orders`

Add `scheduled_at`, `assigned_expert_id`, `delivered_at` and `scheduled_by` to `orders`, and extend
`orders.status` with `scheduled`, `in_progress` and `delivered` after `paid`. Ops write through the
service client after authorizing ops in the action, the pattern spec 0011 established for this
table.

**Pros**:
- The order is the thing bought, so the delivery commitment sits on the row that records the
  purchase; the client dashboard reads one row.
- Additive migration: four nullable columns, a widened check constraint and new trigger edges.
  Nothing existing changes meaning, so it is backward compatible for the shared staging database.
- The status badge already rendered everywhere tells the whole story from `pending` to `delivered`
  with no second concept to teach.
- Reuses the existing transition trigger, so the invariants live where the other order invariants
  already live.

**Cons**:
- `orders.status` then carries two concerns, payment and delivery, on one column. A refund of a
  delivered order, or a delivery that must re open, strains it, and splitting later is a migration
  across live rows.
- An order with several visits, if that ever exists, has nowhere to put the second date.

### Option 2: Scheduling on `expert_assignments`

Add `scheduled_at` to the existing bridge table and treat an assignment as the delivery record.

**Pros**:
- No change at all to the money table, so spec 0011's tight write model is untouched.
- Expert access and the booking live in one place, so they cannot drift apart.

**Cons**:
- `expert_assignments` grants access to an *organization*, not to an order. An organization with two
  orders gets one ambiguous row, and the unique index on `(organization_id, expert_id) where status
  = 'active'` actively prevents a second booking for the same expert.
- The client dashboard would have to join order to organization to assignment to find the date for
  a specific purchase, and could not tell which order the date belongs to.
- Conflates an access grant with a commercial commitment, so ending access would appear to cancel a
  visit.

### Option 3: A new `assessments` table

A dedicated delivery record with its own id, linking order, company, expert, date and state.

**Pros**:
- Cleanest separation: payment on `orders`, delivery on `assessments`, each with its own lifecycle
  and no shared column.
- The natural home for features 17 and 18, which attach forms and a gap report to a visit.
- Several visits per order become trivial.

**Cons**:
- Introduces a table before the features that would define its shape exist, so its columns would be
  guessed now and reworked when the assessment forms land.
- A new kind T tenant table means the full contract from spec 0002: policies, the audit trigger, a
  pgTAP file, and the client read path, for a feature whose acceptance criteria need one date and
  one expert.
- The client dashboard gains a join for what is currently one row.

## Rationale

Option 1 wins on the specific forces in Context, chiefly that the acceptance criteria need exactly
one date and one expert per order, and every other option pays for flexibility nothing has asked
for. The order is what the client bought, so the commitment about that purchase belongs on it, and
the additive migration keeps the shared staging database safe.

Option 3 is the better long term shape and will very likely be right eventually, which is why it is
in Follow-up rather than dismissed. Building it now would mean inventing the columns that features
17 and 18 are supposed to decide, and the usual result is a table reworked once its real users
arrive. The strangler instinct applies in reverse here: add the smallest honest thing to the live
system, and let the dedicated table arrive when its shape is known, with the four columns on
`orders` being a cheap thing to migrate off.

Option 2 was rejected on a hard fact rather than a preference: the partial unique index on
`expert_assignments` makes one active row per organization and expert, so it structurally cannot
hold two bookings, and the table's meaning (access) is not the meaning wanted (a commitment).

Two engineer answers were corrected during the design conversation, both because the codebase
contradicted the premise of the question, and both corrections were put back to the engineer rather
than silently applied:

The write path was first chosen as an ops `UPDATE` policy with a column grant on the new columns,
citing the spec 0013 precedent where `expert_profiles` keeps `status` and `photo_path` outside the
profile action's grant. That precedent does not transfer. Postgres column grants attach to the
*role*, and ops and clients are both `authenticated`, so granting `UPDATE (scheduled_at, ...)`
hands clients the same grant and leaves only the RLS policy standing between a client and a money
row. Spec 0011 considered and rejected exactly that for `orders`, and its schema comment says so.
The service client after an ops check is what that spec chose and what this one reuses.

The notification set was first chosen as two new emails. Spec 0013 already ships both assignment
emails: `assignment_received` to the expert and `expert_assigned` to the client organization, fired
when ops assign an expert. Only the scheduling notice is genuinely new, so this spec adds one
template rather than three.

One further refinement was applied to the future date rule. A table level check that
`scheduled_at > now()` would block ops recording a visit after the fact, which is real work, and
would also fire on an unrelated update to an old row. The check binds to the `paid -> scheduled`
edge inside the transition trigger instead, so scheduling ahead is guarded while a later correction
stays possible. This is stricter than "no constraint" and more honest than a table constraint that
would have to be worked around.

## What the cross check changed

An independent read of the draft on a different model found four load bearing gaps, all closed
above, and one factual error. Recorded here because each was a decision, not a wording fix.

1. **The correction path had no database guard.** `orders_check_transition` is declared
   `before update of status`, so it does not fire when only `scheduled_at` or `assigned_expert_id`
   changes. The draft deliberately allowed correcting a date on an `in_progress` order, which meant
   invariant 1 had no enforcement on exactly that path. Closed with a second trigger,
   `orders_check_delivery_columns`, and a named `rescheduleOrder` action. The alternative, making
   `scheduled_at` write once so the existing trigger covers everything, was rejected because ops
   fixing a wrong date should not have to unschedule and reschedule.
2. **Re assignment leaked expert access.** Rescheduling an order to a different expert left the
   first expert's `expert_assignments` row active for ever. Closed by ending the superseded row,
   conditional on no other live order of that organization naming that expert, since one expert may
   legitimately hold two orders for the same client. Ending it unconditionally would have revoked
   access the expert still needed.
3. **The client dashboard was ambiguous with several orders.** `assigned_expert_summaries` is
   organization scoped with no order id, so an organization with two scheduled orders would get two
   rows and no rule for pairing them. Closed by matching each order's own `assigned_expert_id`
   against the view.
4. **The concurrency scenario named the wrong error and the wrong AC.** The transition trigger
   raises `orders status is already scheduled`, which was not in `scheduleOrder`'s error list. The
   mapping is now explicit, and the scenario points at AC-3 rather than AC-6.
5. **Factual error**: the draft cited `profiles.language`. The column is `profiles.locale`, not
   null with default `'en'`, so the "member with no language set" case the review probed cannot
   occur. Corrected.

The cross check also raised a variant of Option 1 worth recording: a separate `delivery_status`
column on `orders` rather than widening the `status` check. It keeps one row for the dashboard
while avoiding the shared state machine, which is the tradeoff the Consequences name as this
design's largest. It was not adopted, because two status columns mean two triggers and two badges
and an ordering question between them for every reader, and because the widened single column is
the cheaper thing to migrate away from if the dedicated `assessments` table in Follow-up ever
arrives. The tradeoff is real and stays documented rather than resolved.

## References

**Project sources** (verifiable, in this repo):
- `supabase/schemas/41_orders.sql`, the `UPDATE` revoke with no column grant back and the comment
  explaining that ops share the `authenticated` grant, which settled the write path.
- `supabase/schemas/12_expert_assignments.sql`, the partial unique index on
  `(organization_id, expert_id) where status = 'active'`, which ruled out Option 2.
- Spec 0011, the `Actor.service()` ops write pattern and the state machine trigger this spec extends.
- Spec 0013, `check_expert_assignable` as the database side assignability guard, the
  `assigned_expert_summaries` view, the signed `photoUrl` read path, and the two assignment emails
  already on the rail.
- Spec 0008, `SNAPSHOT_SCHEMAS` in `snapshot.ts` as the only way to read a stored snapshot.
- Spec 0006 and `docs/email.md`, the `sendEmail` rail every product email rides.
- `AGENTS.md`, the functional style rule, the typed result rule for server actions, the four client
  factories, and the backward compatible migration rule.
- `docs/scope/commerce.md`, feature 12's intent and its carried over items from specs 0005, 0006,
  0008, 0009 and 0011.

**Practices & standards**:
- Additive, backward compatible migrations for a database shared by preview deployments: add
  nullable, widen the constraint, never rewrite live rows.
- Keeping a state machine's invariants in the database trigger rather than the application, so a
  second write path cannot bypass them.
- Deferring a dedicated table until the features that define its shape exist, rather than guessing
  its columns and reworking it.
