"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/routing";
import { roleFromClaims } from "@/lib/auth/roles";
import { ORDER_SCHEDULED_EVENT } from "@/lib/email/schema";
import { sendEmail } from "@/lib/email/send";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { classifyScheduleError } from "./errors";
import {
  orderDeliveryStateSchema,
  rescheduleOrderSchema,
  scheduleOrderSchema,
  unscheduleOrderSchema,
} from "./schema";

/**
 * The ops admin actions (spec 0014). Every one authorises the caller here, not only in the proxy:
 * the proxy never runs for a server action post, so an action trusting it would be reachable by
 * anyone with a session. Each answers a typed result and never throws for an expected failure.
 *
 * `UPDATE` on `orders` is revoked from every app role (spec 0011, invariant 3), so the writes go
 * through the service client that `requireOps` mints after the role check, the same shape the
 * checkout ops actions use.
 */

export type ScheduleOrderError =
  | "forbidden"
  | "validation"
  | "not_found"
  | "not_paid"
  | "not_deliverable"
  | "expert_not_assignable"
  | "date_not_future"
  | "invalid_transition"
  | "unexpected";

export type ScheduleOrderResult = { ok: true } | { ok: false; error: ScheduleOrderError };

/** The ops caller with a service client, since these writes sit outside every app role's grants. */
async function requireOps() {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "ops" || typeof claims?.sub !== "string") return null;
  const env = serverEnv();
  return {
    userId: claims.sub,
    service: createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL),
  };
}

/**
 * Ops book a paid order (AC-3): the agreed date and the assessor land on the order, it moves
 * `paid -> scheduled`, and the expert's `expert_assignments` row for that client organization is
 * made active so they can actually do the work (invariant 4).
 *
 * The assignment is written **first**, on purpose. It is the write that carries
 * `check_expert_assignable`, so an expert deactivated between the ops read and this moment is
 * refused before the order has moved (AC-4); doing it the other way round would leave an order
 * scheduled to someone who may not be booked. An assignment that exists and is already active
 * needs no write at all, and one left over from an earlier booking is what invariant 4 calls a
 * standing grant, so it is reused rather than duplicated.
 *
 * The order write is guarded on `status = 'paid'`, so a race with another ops user changes
 * nothing: one succeeds and the other reads no row and is told `invalid_transition`.
 *
 * The `assessment_scheduled` email goes to every member of the client organization once the order
 * has moved, never before: an email announcing a date that a refused write never wrote would be
 * the one failure the client cannot undo. Server action, ops only.
 */
export async function scheduleOrder(
  _previous: ScheduleOrderResult | null,
  input: unknown,
): Promise<ScheduleOrderResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(scheduleOrderSchema, input, locale);
  if (!parsed.success) {
    // The past date is the one validation failure ops can act on, so it keeps its own code rather
    // than hiding inside `validation`; the database checks it again on the edge (AC-5).
    const past = parsed.error.issues.some((issue) => issue.message === "scheduledAtPast");
    return { ok: false, error: past ? "date_not_future" : "validation" };
  }
  const { orderId, scheduledAt, expertId } = parsed.data;

  const { data: order, error: readError } = await actor.service
    .from("orders")
    .select("id, status, organization_id, buyer_expert_id, package_name_snapshot")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) {
    Sentry.captureException(readError);
    log.error("schedule order: the order could not be read", {
      orderId,
      message: readError.message,
    });
    return { ok: false, error: "unexpected" };
  }
  if (!order) return { ok: false, error: "not_found" };
  if (order.status !== "paid") return { ok: false, error: "not_paid" };
  // A credit pack order of the contact directory (spec 0018, AC-10) has nothing to schedule; the
  // database refuses the edge too, this answer just comes before any assignment is written.
  if (!order.organization_id) return { ok: false, error: "not_deliverable" };

  const assigned = await ensureAssignment(actor, order.organization_id, expertId);
  if (!assigned.ok) return { ok: false, error: assigned.error };

  const { data: updated, error: writeError } = await actor.service
    .from("orders")
    .update({
      status: "scheduled",
      scheduled_at: scheduledAt.toISOString(),
      assigned_expert_id: expertId,
      scheduled_by: actor.userId,
    })
    .eq("id", orderId)
    // Guarded on the status the read saw, so a concurrent schedule or refund is never overwritten.
    .eq("status", "paid")
    .select("id")
    .maybeSingle();
  if (writeError) {
    const classified = classifyScheduleError(writeError);
    if (classified === "unexpected") {
      Sentry.captureException(writeError);
      log.error("schedule order failed", { orderId, message: writeError.message });
    }
    return { ok: false, error: classified };
  }
  // No row came back: another ops user moved the order between the read and the write.
  if (!updated) return { ok: false, error: "invalid_transition" };

  await announceSchedule(actor.service, {
    orderId,
    organizationId: order.organization_id,
    packageName: order.package_name_snapshot,
    expertId,
    scheduledAt,
  });

  log.info("ops scheduled an order", {
    orderId,
    expertId,
    scheduledAt: scheduledAt.toISOString(),
    actorId: actor.userId,
  });
  revalidatePath("/admin/orders");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * Makes the expert's access to this organization active, reusing an existing active row rather
 * than inserting a second one (the partial unique index would refuse it anyway). An `ended` row is
 * never revived: a new row is inserted beside it, which is what the Value sourcing table asks for,
 * so the history of who held access when stays readable.
 *
 * The insert is what runs `check_expert_assignable`, so this is where a deactivated expert is
 * refused. Server action helper.
 */
async function ensureAssignment(
  actor: { readonly userId: string; readonly service: ReturnType<typeof createServiceClient> },
  organizationId: string,
  expertId: string,
): Promise<{ ok: true } | { ok: false; error: "expert_not_assignable" | "unexpected" }> {
  const { data: existing, error: readError } = await actor.service
    .from("expert_assignments")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("expert_id", expertId)
    .eq("status", "active")
    .maybeSingle();
  if (readError) {
    Sentry.captureException(readError);
    log.error("schedule order: the assignment could not be read", {
      organizationId,
      expertId,
      message: readError.message,
    });
    return { ok: false, error: "unexpected" };
  }
  if (existing) return { ok: true };

  const { error } = await actor.service.from("expert_assignments").insert({
    organization_id: organizationId,
    expert_id: expertId,
    status: "active",
    assigned_by: actor.userId,
  });
  if (!error) return { ok: true };

  // Another ops user inserting the same pair a moment earlier hits the active unique index; the
  // access exists either way, which is all this step was for.
  if (error.code === "23505") return { ok: true };
  // Only `expert_not_active` is expected here; the order's own edges cannot raise on this insert.
  const classified =
    classifyScheduleError(error) === "expert_not_assignable"
      ? "expert_not_assignable"
      : "unexpected";
  if (classified === "unexpected") {
    Sentry.captureException(error);
    log.error("schedule order: the assignment could not be written", {
      organizationId,
      expertId,
      message: error.message,
    });
  }
  return { ok: false, error: classified };
}

/**
 * The `assessment_scheduled` email to every member of the client organization (AC-9). The members
 * and the expert's name are read with the service client, after the ops check in the caller,
 * because `organization_members` is a tenant table the ops role does not read through RLS.
 *
 * The date travels as the stored instant, not as a formatted string: `sendEmail` renders one
 * delivery per recipient in that recipient's own stored language, and the template is the single
 * place that turns the instant into Swiss local time (spec 0014, Value sourcing).
 *
 * The order is already booked by the time this runs, so nothing here fails the action: a missing
 * expert name or an unreachable Trigger.dev is logged and the schedule stands. The key carries the
 * order and the member, so rescheduling the same order later is a new send rather than a
 * deduplicated one. Server action helper.
 */
async function announceSchedule(
  service: ReturnType<typeof createServiceClient>,
  booking: {
    readonly orderId: string;
    readonly organizationId: string;
    readonly packageName: string;
    readonly expertId: string;
    readonly scheduledAt: Date;
  },
): Promise<void> {
  const [{ data: expert }, { data: members }] = await Promise.all([
    service.from("profiles").select("full_name").eq("id", booking.expertId).maybeSingle(),
    service
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", booking.organizationId),
  ]);

  const expertName = expert?.full_name?.trim();
  if (!expertName) {
    log.warn("assessment scheduled emails skipped: the expert has no name", {
      orderId: booking.orderId,
      expertId: booking.expertId,
    });
    return;
  }

  for (const member of members ?? []) {
    await sendEmail({
      template: "assessment_scheduled",
      data: {
        scheduledAt: booking.scheduledAt.toISOString(),
        expertName,
        packageName: booking.packageName,
      },
      recipient: { userId: member.user_id },
      sourceEvent: ORDER_SCHEDULED_EVENT,
      organizationId: booking.organizationId,
      idempotencyKey: `assessment-scheduled/${booking.orderId}/${member.user_id}`,
    });
  }
}

/** The states a booked order can be corrected in, and the ones that keep an expert's access. */
const LIVE_DELIVERY_STATES = ["scheduled", "in_progress", "delivered"] as const;

export type RescheduleOrderError =
  | "forbidden"
  | "validation"
  | "not_found"
  | "not_scheduled"
  | "expert_not_assignable"
  | "invalid_transition"
  | "unexpected";

export type RescheduleOrderResult = { ok: true } | { ok: false; error: RescheduleOrderError };

/**
 * Ops correct the date or the assessor on an order already booked (AC-7a), without moving its
 * status. The status is deliberately untouched, so `orders_check_transition` never fires and the
 * second trigger, `orders_check_delivery_columns`, is the guard: it keeps invariant 1 on this path
 * and drops the future date check, because a visit recorded after the fact is legitimately past.
 *
 * A correction naming a different expert grants the new one access and then ends the superseded
 * one's, unless another live order of the same organization still names them (invariant 4), so
 * access neither accumulates silently nor is pulled from under an expert with work left to do.
 * The new grant is written first, for the reason `scheduleOrder` writes it first.
 * Server action, ops only.
 */
export async function rescheduleOrder(
  _previous: RescheduleOrderResult | null,
  input: unknown,
): Promise<RescheduleOrderResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(rescheduleOrderSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { orderId, scheduledAt, expertId } = parsed.data;

  const { data: order, error: readError } = await actor.service
    .from("orders")
    .select("id, status, organization_id, assigned_expert_id")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) {
    Sentry.captureException(readError);
    log.error("reschedule order: the order could not be read", {
      orderId,
      message: readError.message,
    });
    return { ok: false, error: "unexpected" };
  }
  if (!order) return { ok: false, error: "not_found" };
  if (!isLiveDeliveryState(order.status)) return { ok: false, error: "not_scheduled" };
  // Never true for a booked order (the trigger refuses the edge for an expert buyer, spec 0018),
  // kept so the organization is typed non null for the assignment writes below.
  if (!order.organization_id) return { ok: false, error: "invalid_transition" };

  const previousExpertId = order.assigned_expert_id;
  if (previousExpertId !== expertId) {
    const assigned = await ensureAssignment(actor, order.organization_id, expertId);
    if (!assigned.ok) return { ok: false, error: assigned.error };
  }

  const { data: updated, error: writeError } = await actor.service
    .from("orders")
    .update({
      scheduled_at: scheduledAt.toISOString(),
      assigned_expert_id: expertId,
      scheduled_by: actor.userId,
    })
    .eq("id", orderId)
    // Guarded on the states the read saw, so a concurrent unschedule or delivery is not overwritten.
    .in("status", [...LIVE_DELIVERY_STATES])
    .select("id")
    .maybeSingle();
  if (writeError) {
    const classified = classifyScheduleError(writeError);
    if (classified === "unexpected") {
      Sentry.captureException(writeError);
      log.error("reschedule order failed", { orderId, message: writeError.message });
    }
    return {
      ok: false,
      error:
        classified === "invalid_transition" || classified === "expert_not_assignable"
          ? classified
          : "unexpected",
    };
  }
  if (!updated) return { ok: false, error: "invalid_transition" };

  if (previousExpertId && previousExpertId !== expertId) {
    await endSupersededAssignment(actor, order.organization_id, previousExpertId);
  }

  log.info("ops rescheduled an order", {
    orderId,
    expertId,
    previousExpertId,
    scheduledAt: scheduledAt.toISOString(),
    actorId: actor.userId,
  });
  revalidatePath("/admin/orders");
  revalidatePath("/app");
  return { ok: true };
}

export type UnscheduleOrderError =
  | "forbidden"
  | "validation"
  | "not_found"
  | "not_scheduled"
  | "invalid_transition"
  | "unexpected";

export type UnscheduleOrderResult = { ok: true } | { ok: false; error: UnscheduleOrderError };

/**
 * Ops release a booked order back to `paid` (AC-7): the date and the assessor are cleared in the
 * same statement the status moves, which is what the unschedule edge requires so a `paid` order
 * never carries a stale date.
 *
 * The `expert_assignments` row is deliberately left active. The expert may still legitimately hold
 * access to that organization, and spec 0014 calls that standing grant the safer default; ending
 * it is ops work, not a side effect of freeing a date. Server action, ops only.
 */
export async function unscheduleOrder(
  _previous: UnscheduleOrderResult | null,
  input: unknown,
): Promise<UnscheduleOrderResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(unscheduleOrderSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { orderId } = parsed.data;

  const { data: order, error: readError } = await actor.service
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) {
    Sentry.captureException(readError);
    log.error("unschedule order: the order could not be read", {
      orderId,
      message: readError.message,
    });
    return { ok: false, error: "unexpected" };
  }
  if (!order) return { ok: false, error: "not_found" };
  // Only a scheduled order can be released: an in_progress or delivered one has work behind it.
  if (order.status !== "scheduled") return { ok: false, error: "not_scheduled" };

  const { data: updated, error: writeError } = await actor.service
    .from("orders")
    .update({ status: "paid", scheduled_at: null, assigned_expert_id: null })
    .eq("id", orderId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (writeError) {
    const classified = classifyScheduleError(writeError);
    if (classified === "unexpected") {
      Sentry.captureException(writeError);
      log.error("unschedule order failed", { orderId, message: writeError.message });
    }
    return { ok: false, error: classified === "invalid_transition" ? classified : "unexpected" };
  }
  if (!updated) return { ok: false, error: "invalid_transition" };

  log.info("ops unscheduled an order", { orderId, actorId: actor.userId });
  revalidatePath("/admin/orders");
  revalidatePath("/app");
  return { ok: true };
}

export type OrderDeliveryStateError =
  | "forbidden"
  | "validation"
  | "not_found"
  | "invalid_transition"
  | "unexpected";

export type OrderDeliveryStateResult = { ok: true } | { ok: false; error: OrderDeliveryStateError };

/**
 * Ops move a booked order along the delivery states (AC-6): `scheduled -> in_progress`, and
 * `in_progress -> delivered`, which stamps `delivered_at`. Every other transition raises in the
 * transition trigger and is reported as `invalid_transition`, so the app never decides which edges
 * exist; it only offers the two the row is standing on.
 *
 * `delivered_at` is taken in the action rather than the trigger, because the trigger only asserts
 * the column is set, per the Value sourcing table. Server action, ops only.
 */
export async function setOrderDeliveryState(
  _previous: OrderDeliveryStateResult | null,
  input: unknown,
): Promise<OrderDeliveryStateResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(orderDeliveryStateSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { orderId, next } = parsed.data;
  const from = next === "in_progress" ? "scheduled" : "in_progress";

  const { data: order, error: readError } = await actor.service
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) {
    Sentry.captureException(readError);
    log.error("order delivery state: the order could not be read", {
      orderId,
      message: readError.message,
    });
    return { ok: false, error: "unexpected" };
  }
  if (!order) return { ok: false, error: "not_found" };
  if (order.status !== from) return { ok: false, error: "invalid_transition" };

  const { data: updated, error: writeError } = await actor.service
    .from("orders")
    .update(
      next === "delivered"
        ? { status: next, delivered_at: new Date().toISOString() }
        : { status: next },
    )
    .eq("id", orderId)
    // Guarded on the state the read saw, so two ops advancing at once give one success and one
    // invalid_transition rather than a silent double move.
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (writeError) {
    const classified = classifyScheduleError(writeError);
    if (classified === "unexpected") {
      Sentry.captureException(writeError);
      log.error("order delivery state failed", { orderId, next, message: writeError.message });
    }
    return {
      ok: false,
      error: classified === "invalid_transition" ? classified : "unexpected",
    };
  }
  if (!updated) return { ok: false, error: "invalid_transition" };

  log.info("ops moved an order's delivery state", { orderId, next, actorId: actor.userId });
  revalidatePath("/admin/orders");
  revalidatePath("/app");
  return { ok: true };
}

/** Whether a status is one of the three states a booked order can be corrected in. Pure. */
function isLiveDeliveryState(status: string): boolean {
  return (LIVE_DELIVERY_STATES as readonly string[]).includes(status);
}

/**
 * Ends the superseded expert's access to this organization after a re assignment, unless another
 * order of the same organization in a live delivery state still names them (invariant 4). A read
 * then a write, rather than one statement, because the deciding fact lives in `orders` and the
 * write lands in `expert_assignments`.
 *
 * A failure here is logged rather than returned: the correction itself is already committed and
 * the caller has nothing to undo, so reporting it as a failed reschedule would be a lie. The
 * standing grant it leaves behind is the same one unscheduling leaves on purpose.
 * Server action helper.
 */
async function endSupersededAssignment(
  actor: { readonly userId: string; readonly service: ReturnType<typeof createServiceClient> },
  organizationId: string,
  expertId: string,
): Promise<void> {
  const { data: stillBooked, error: readError } = await actor.service
    .from("orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("assigned_expert_id", expertId)
    .in("status", [...LIVE_DELIVERY_STATES])
    .limit(1)
    .maybeSingle();
  if (readError) {
    Sentry.captureException(readError);
    log.error("reschedule order: the superseded expert's other orders could not be read", {
      organizationId,
      expertId,
      message: readError.message,
    });
    return;
  }
  if (stillBooked) return;

  const { error } = await actor.service
    .from("expert_assignments")
    .update({ status: "ended" })
    .eq("organization_id", organizationId)
    .eq("expert_id", expertId)
    .eq("status", "active");
  if (error) {
    Sentry.captureException(error);
    log.error("reschedule order: the superseded assignment could not be ended", {
      organizationId,
      expertId,
      message: error.message,
    });
    return;
  }
  log.info("ops ended a superseded expert assignment", {
    organizationId,
    expertId,
    actorId: actor.userId,
  });
}
