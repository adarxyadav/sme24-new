import "./instrumentation";

import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { SELLER_PLACEHOLDERS } from "@/features/checkout/seller-facts";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { renderInvoiceTask } from "./render-invoice";

/**
 * Issues the invoice for a bank transfer order (spec 0011, AC-8). The card path issues at payment,
 * inside `settleOrder`; this path issues at **creation**, because the buyer cannot pay a QR bill
 * they have not been given. The order stays `pending` until ops confirm the money arrived, so a
 * bank transfer order is a pending order that already has an unpaid invoice (invariant 11).
 *
 * Runs on the service role: a client may never write an `invoices` row, and the number has to be
 * drawn inside the small issuing transaction that keeps the series gapless (invariant 3).
 */

export const issueInvoicePayloadSchema = z.object({ orderId: z.uuid() });
export type IssueInvoicePayload = z.infer<typeof issueInvoicePayloadSchema>;

export const issueInvoiceTask = schemaTask({
  id: "issue-invoice",
  schema: issueInvoicePayloadSchema,
  retry: { maxAttempts: 3 },
  run: async ({ orderId }: IssueInvoicePayload) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

    const { data: order, error } = await supabase
      .from("orders")
      .select("id, organization_id, status, payment_method")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw queryError(error);
    if (!order) {
      logger.error("issue invoice: no such order", { orderId });
      return { issued: false as const, reason: "order_not_found" as const };
    }
    if (order.payment_method !== "bank_transfer") {
      // The card path issues inside settleOrder; issuing here too would draw a second number.
      logger.warn("issue invoice: not a bank transfer order", { orderId });
      return { issued: false as const, reason: "not_bank_transfer" as const };
    }

    // Resumable: an order that already has its invoice needs nothing (invariant 4 guards it too).
    const { data: existing } = await supabase
      .from("invoices")
      .select("id, number")
      .eq("order_id", orderId)
      .maybeSingle();
    if (existing) {
      await queueRender(existing.id);
      return { issued: false as const, reason: "already_issued" as const, invoiceId: existing.id };
    }

    const seller = {
      name: env.SELLER_NAME || SELLER_PLACEHOLDERS.name,
      address: env.SELLER_ADDRESS || SELLER_PLACEHOLDERS.address,
      uid: env.SELLER_UID || SELLER_PLACEHOLDERS.uid,
      iban: env.SELLER_IBAN || SELLER_PLACEHOLDERS.iban,
    };

    // `issue_invoice` draws the number in the same small transaction that inserts the row, the
    // way `settle_order` does, but leaves the order pending.
    const { data: issued, error: issueError } = await supabase
      .rpc("issue_invoice", {
        order_id: orderId,
        seller_name: seller.name,
        seller_address: seller.address,
        seller_uid: seller.uid,
        seller_iban: seller.iban,
        due_days: env.INVOICE_DUE_DAYS,
      })
      .single();
    if (issueError) throw queryError(issueError);
    if (!issued) throw new Error(`issue invoice returned no row for ${orderId}`);

    await queueRender(issued.invoice_id);
    log.info("invoice issued for a bank transfer", {
      orderId,
      invoiceNumber: issued.invoice_number,
    });
    return { issued: true as const, invoiceId: issued.invoice_id };
  },
});

/** Queues the PDF render, keyed on the invoice so a retry renders once. */
async function queueRender(invoiceId: string): Promise<void> {
  await renderInvoiceTask.trigger({ invoiceId }, { idempotencyKey: `invoice-render/${invoiceId}` });
}
