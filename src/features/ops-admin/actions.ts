"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/routing";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { classifyScheduleError } from "./errors";
import { scheduleOrderSchema } from "./schema";

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
 * The `assessment_scheduled` email is milestone 4 of the build plan and is not sent here yet.
 * Server action, ops only.
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
    .select("id, status, organization_id")
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
): Promise<{ ok: true } | { ok: false; error: ScheduleOrderError }> {
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
  const classified = classifyScheduleError(error);
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
