import "./instrumentation";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { rappenToChf } from "@/features/checkout/money";
import { SELLER_PLACEHOLDERS, type Seller } from "@/features/checkout/seller-facts";
import { settleOrder } from "@/features/checkout/settle";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { raiseAlertFromTask } from "./ops-alert";
import { sendEmailTask } from "./send-email";

/**
 * The confirmation task (spec 0011, AC-5, AC-7, AC-10, AC-18). The Stripe webhook enqueues it
 * under the idempotency key `order/confirm/<eventId>`, so a redelivered event runs it once.
 *
 * It is **resumable, not merely idempotent**. Every step reads the current state and does only
 * what is missing, so a crash at any point leaves the client with a paid order, an invoice, a
 * confirmation email and an ops alert once the retries settle:
 *
 *   1. `settleOrder` (atomic, in the database): order to `paid`, its event row, the invoice with
 *      its gapless number. Calling it again returns the existing invoice and draws no new number.
 *   2. the confirmation email, keyed on the order so a retry sends one email.
 *   3. the `payment.received` ops alert, keyed the same way.
 *
 * Throws so Trigger.dev retries; the retries are what make the "committed but not yet enqueued"
 * window safe.
 */

type Service = SupabaseClient<Database>;
type OrderRow = Tables<"orders">;

export const confirmOrderPayloadSchema = z.object({
  /** Stripe's event id, for the log and the `stripe_events` row this run closes. */
  eventId: z.string().min(1),
  orderId: z.uuid(),
  /**
   * When Stripe created the event, in epoch seconds. This, not our clock, is what `paid_at`
   * records (spec 0011, Value sourcing), so a delivery delayed by an outage still says when the
   * payment actually happened. Optional only so an older queued payload still runs.
   */
  eventCreated: z.number().int().positive().optional(),
});
export type ConfirmOrderPayload = z.infer<typeof confirmOrderPayloadSchema>;

/** The seller facts a task issues an invoice with; tasks read their own environment. */
function taskSeller(): Seller {
  const env = taskEnv();
  return {
    name: env.SELLER_NAME || SELLER_PLACEHOLDERS.name,
    address: env.SELLER_ADDRESS || SELLER_PLACEHOLDERS.address,
    uid: env.SELLER_UID || SELLER_PLACEHOLDERS.uid,
    iban: env.SELLER_IBAN || SELLER_PLACEHOLDERS.iban,
  };
}

export const confirmOrderTask = schemaTask({
  id: "confirm-order",
  schema: confirmOrderPayloadSchema,
  // Money: retry generously, because the alternative to a retry is a paid client with no order.
  retry: { maxAttempts: 5 },
  run: async ({ eventId, orderId, eventCreated }: ConfirmOrderPayload) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw queryError(error);
    if (!order) {
      // Nothing to retry towards: the event names an order that does not exist.
      logger.error("confirm order: no such order", { orderId, eventId });
      await markEventProcessed(supabase, eventId, "order_not_found");
      return { settled: false, reason: "order_not_found" as const };
    }

    // Step 1: the atomic settlement. Resumable: a retry returns the existing invoice.
    const settled = await settleOrder(
      supabase,
      orderId,
      // Stripe's own event timestamp, not our clock, so a delayed delivery records when the
      // payment actually happened. A payload without one falls back to now.
      eventCreated ? new Date(eventCreated * 1000) : new Date(),
      { role: "service" },
      taskSeller(),
      env.INVOICE_DUE_DAYS,
    );
    if (!settled.ok) {
      if (settled.error === "order_not_pending") {
        // Cancelled or expired before the webhook landed: a real conflict for ops, not a retry.
        logger.warn("confirm order: the order is no longer pending", { orderId, eventId });
        await markEventProcessed(supabase, eventId, "order_not_pending");
        return { settled: false, reason: "order_not_pending" as const };
      }
      // Anything else is worth retrying.
      throw new Error(`settle order failed: ${settled.error}`);
    }

    // Step 2 and 3 are keyed on the order, so a retry after a crash sends one email and raises
    // one alert however many times this task runs.
    await sendConfirmation(supabase, order, settled.data.invoiceNumber);
    await raiseAlertFromTask({
      kind: "payment.received",
      idempotencyKey: `payment-received/${orderId}`,
      fields: {
        organizationName: await organizationName(supabase, order.organization_id),
        amountChf: rappenToChf(Number(order.gross_rappen)),
        reference: order.reference,
      },
    });

    await markEventProcessed(supabase, eventId, null);
    log.info("order confirmed", {
      orderId,
      eventId,
      invoiceNumber: settled.data.invoiceNumber,
      alreadySettled: settled.data.alreadySettled,
    });
    return { settled: true, invoiceNumber: settled.data.invoiceNumber };
  },
});

/** The organization's name for the ops alert. */
async function organizationName(supabase: Service, organizationId: string): Promise<string> {
  const { data } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  return data?.name ?? "Unknown organization";
}

/** Sends the confirmation to the buyer, keyed on the order so a retry sends one email. */
async function sendConfirmation(
  supabase: Service,
  order: OrderRow,
  invoiceNumber: string,
): Promise<void> {
  if (!order.created_by) {
    logger.warn("confirm order: the order has no buyer to email", { orderId: order.id });
    return;
  }
  await sendEmailTask.trigger(
    {
      kind: "new",
      template: "order_confirmed",
      recipient: { userId: order.created_by },
      sourceEvent: "order.confirmed",
      organizationId: order.organization_id,
      idempotencyKey: `order-confirmed/${order.id}`,
      data: {
        packageName: order.package_name_snapshot,
        reference: order.reference,
        invoiceNumber,
        netChf: rappenToChf(Number(order.net_rappen)),
        vatChf: rappenToChf(Number(order.vat_rappen)),
        grossChf: rappenToChf(Number(order.gross_rappen)),
        vatRatePercent: Number(order.vat_rate) * 100,
        // Slice 2 attaches the rendered PDF; until then the email points at the order.
        invoiceAttached: false,
      },
    },
    { idempotencyKey: `order-confirmed-send/${order.id}` },
  );
}

/** Closes the `stripe_events` row, so an unprocessed one stands out for reconciliation. */
async function markEventProcessed(
  supabase: Service,
  eventId: string,
  error: string | null,
): Promise<void> {
  await supabase
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString(), error })
    .eq("event_id", eventId);
}
