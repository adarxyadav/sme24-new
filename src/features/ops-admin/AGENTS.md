# src/features/ops-admin

Moved out of the root `AGENTS.md` so it loads only when this area is touched. The root keeps a one line pointer here.

## Ops admin, orders and scheduling

The order is the delivery record: `scheduled_at`, `assigned_expert_id`, `delivered_at` and `scheduled_by` are four nullable columns on `orders`, and the three delivery states (`scheduled`, `in_progress`, `delivered`) ride the same `status` column as the payment states, extended additively. Every edge, the future date check on `paid -> scheduled` only, and the delivery column consistency guard live in the `private.check_order_transition` and `orders_check_delivery_columns` triggers in `supabase/schemas/41_orders.sql`, never in the app; the actions in `src/features/ops-admin/actions.ts` map the refusals through the pure `classifyScheduleError` in `errors.ts`, which matches the fragment each `raise exception` writes. `UPDATE` on `orders` is revoked from every app role, so each action authorises the caller itself and then writes through the service client `requireOps` mints, because the proxy never runs for a server action post. `scheduleOrder` also upserts the active `expert_assignments` row, which is what actually grants the expert access. Strings live in the `admin` namespace in both catalogs, and the `assessment_scheduled` email rides the rail in `docs/email.md`.
