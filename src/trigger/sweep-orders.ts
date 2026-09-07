import "./instrumentation";

import { logger, schedules } from "@trigger.dev/sdk";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The abandoned checkout sweep (spec 0011, AC-6), mirroring `sweep-research-runs`.
 *
 * It distinguishes two cases by the Stripe session id, which is why the insert ordering in
 * `startCheckout` is fixed:
 *
 * - a `pending` **card** order with a **null** `stripe_checkout_session_id` older than an hour
 *   never reached Stripe (the action crashed between the insert and the session creation), so it
 *   is expired outright: nobody can pay it, because no session exists;
 * - one **with** a session id is left alone. Stripe's own session lifetime governs it and
 *   `checkout.session.expired` is what closes it, so expiring it here would race a payment that
 *   is still legitimately in flight.
 *
 * A bank transfer order is never swept: it has a real invoice with a due date, and only ops decide
 * it will not be paid.
 */

/** A pending card order with no Stripe session older than this never reached Stripe (AC-6). */
export const STALE_UNSTARTED_MINUTES = 60;

export const sweepOrdersTask = schedules.task({
  id: "sweep-orders",
  cron: "*/15 * * * *",
  run: async () => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const cutoff = new Date(Date.now() - STALE_UNSTARTED_MINUTES * 60_000).toISOString();

    const { data: stale, error } = await supabase
      .from("orders")
      .select("id, organization_id, reference")
      .eq("status", "pending")
      .eq("payment_method", "card")
      .is("stripe_checkout_session_id", null)
      .lt("created_at", cutoff);
    if (error) throw queryError(error);
    if (!stale || stale.length === 0) {
      log.info("sweep orders: nothing to expire");
      return { expired: 0 };
    }

    let expired = 0;
    for (const order of stale) {
      // Guarded on the current status and the null session, so an order that reached Stripe
      // between the read and the write is left alone.
      const { data, error: updateError } = await supabase
        .from("orders")
        .update({ status: "expired", expires_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", "pending")
        .is("stripe_checkout_session_id", null)
        .select("id")
        .maybeSingle();
      if (updateError) {
        logger.error("sweep orders: could not expire an order", {
          orderId: order.id,
          message: updateError.message,
        });
        continue;
      }
      if (!data) continue;

      await supabase.from("order_events").insert({
        organization_id: order.organization_id,
        order_id: order.id,
        from_status: "pending",
        to_status: "expired",
        actor_role: "service",
        reason: "The checkout never reached Stripe and was expired by the sweep.",
      });
      expired += 1;
    }

    log.info("sweep orders finished", { expired, candidates: stale.length });
    return { expired };
  },
});
