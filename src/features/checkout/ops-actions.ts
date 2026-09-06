"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { seller as configuredSeller, invoiceDueDays } from "@/features/checkout/seller";
import { settleOrder } from "@/features/checkout/settle";
import { resolveLocale } from "@/i18n/routing";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { cancelOrderSchema, orderIdSchema, retryInvoiceRenderSchema } from "./schema";

/**
 * The ops actions of the checkout (spec 0011, AC-9, AC-10, AC-13). `markOrderPaid` settles a bank
 * transfer through the **same** `settleOrder` core the webhook uses, differing only in its two
 * inputs (the moment, and the actor), so the card path and the transfer path can never drift
 * apart. `cancelOrder` closes a stale pending order without ever deleting its invoice.
 * `retryInvoiceRender` re runs a render that exhausted its retries.
 *
 * Every one authorises the caller as ops here, not only in the proxy, and returns the typed result
 * shape rather than throwing.
 */

export type OpsActionError =
  | "forbidden"
  | "validation"
  | "not_found"
  | "not_pending"
  | "already_rendered"
  | "unexpected";

export type OpsActionResult<Data = undefined> =
  | { ok: true; data: Data }
  | { ok: false; error: OpsActionError };

/** The ops caller with a service client, since these writes are outside every app role's grants. */
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
 * Ops confirm a bank transfer arrived (AC-9). Runs the same `settleOrder` core as a card payment
 * with `now()` and the acting ops user, so the order becomes paid, the invoice is issued if it was
 * not already, and the confirmation and the alert follow. Server action, ops only.
 */
export async function markOrderPaid(
  _previous: OpsActionResult | null,
  input: unknown,
): Promise<OpsActionResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(orderIdSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };

  const settled = await settleOrder(
    actor.service,
    parsed.data.orderId,
    // Ops assert the money arrived, not when; there is no Stripe event on this path.
    new Date(),
    { role: "ops", userId: actor.userId },
    configuredSeller(),
    invoiceDueDays(),
  );
  if (!settled.ok) {
    if (settled.error === "order_not_found") return { ok: false, error: "not_found" };
    if (settled.error === "order_not_pending") return { ok: false, error: "not_pending" };
    return { ok: false, error: "unexpected" };
  }

  log.info("ops marked an order paid", {
    orderId: parsed.data.orderId,
    invoiceNumber: settled.data.invoiceNumber,
    actorId: actor.userId,
  });
  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}

/**
 * Ops cancel a stale pending order (AC-9). The invoice row stays with `cancelled_at` set, never
 * deleted: a cancelled invoice is retained under Swiss bookkeeping rules, which is the whole
 * reason cancellation exists rather than deletion. Server action, ops only.
 */
export async function cancelOrder(
  _previous: OpsActionResult | null,
  input: unknown,
): Promise<OpsActionResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(cancelOrderSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };

  const { data: order, error } = await actor.service
    .from("orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", parsed.data.orderId)
    // Guarded on the current status, so a race with a landing payment changes nothing.
    .eq("status", "pending")
    .select("id, organization_id")
    .maybeSingle();
  if (error) {
    Sentry.captureException(error);
    log.error("cancel order failed", { orderId: parsed.data.orderId, message: error.message });
    return { ok: false, error: "unexpected" };
  }
  if (!order) return { ok: false, error: "not_pending" };

  await actor.service.from("order_events").insert({
    organization_id: order.organization_id,
    order_id: order.id,
    from_status: "pending",
    to_status: "cancelled",
    actor_id: actor.userId,
    actor_role: "ops",
    reason: parsed.data.reason,
  });
  // The invoice is kept and marked cancelled, never removed.
  await actor.service
    .from("invoices")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("order_id", order.id);

  log.info("ops cancelled an order", { orderId: order.id, actorId: actor.userId });
  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}

/**
 * Ops re run a render that exhausted its retries (AC-10). Only a row whose `pdf_failed_at` is set
 * and whose `pdf_path` is still null qualifies; a rendered invoice is never redrawn, because the
 * document a client already downloaded must not change. Server action, ops only.
 */
export async function retryInvoiceRender(
  _previous: OpsActionResult | null,
  input: unknown,
): Promise<OpsActionResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(retryInvoiceRenderSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };

  const { data: invoice, error } = await actor.service
    .from("invoices")
    .select("id, pdf_path, pdf_failed_at")
    .eq("id", parsed.data.invoiceId)
    .maybeSingle();
  if (error) {
    Sentry.captureException(error);
    return { ok: false, error: "unexpected" };
  }
  if (!invoice) return { ok: false, error: "not_found" };
  if (invoice.pdf_path) return { ok: false, error: "already_rendered" };

  const { renderInvoiceTask } = await import("@/trigger/render-invoice");
  await renderInvoiceTask.trigger(
    { invoiceId: invoice.id },
    // A new key per attempt, so a deliberate retry is not swallowed by the first run's key.
    { idempotencyKey: `invoice-render-retry/${invoice.id}/${Date.now()}` },
  );

  log.info("ops retried an invoice render", { invoiceId: invoice.id, actorId: actor.userId });
  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}
