import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";
import type { Seller } from "./seller-facts";

/**
 * The single shared core that settles a payment (spec 0011, invariants 13 and 14). Both arrows
 * into `paid` run this: the Stripe webhook task passes the event's own timestamp with the actor
 * role `service`, and the ops action passes `now()` with the acting user and the role `ops`. There
 * is no second confirmation path and no branch on payment method inside it.
 *
 * It is **resumable**, not merely idempotent (AC-18). The atomic part lives in the
 * `public.settle_order` database function, which takes an advisory lock on the order, and whose
 * transaction holds only three local writes so invoice numbers stay gapless (invariant 3). This
 * wrapper then enqueues the follow up work. Called again after a crash at any point it reads the
 * order's current state, draws no second invoice number and enqueues only what is missing.
 *
 * Server only: it needs the service client, which bypasses RLS, so it runs in a task or a server
 * action that has already authorised its caller.
 */

type Service = SupabaseClient<Database>;

/** Who is settling: the webhook task, or the ops user who confirmed the transfer arrived. */
export type SettleActor =
  | { readonly role: "service"; readonly userId?: undefined }
  | { readonly role: "ops"; readonly userId: string };

export type SettleResult = {
  readonly orderId: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly qrReference: string;
  /** True when the order was already paid, so this call was a retry and issued nothing new. */
  readonly alreadySettled: boolean;
};

export type SettleError = "order_not_found" | "order_not_pending" | "unexpected";

export type SettleOutcome =
  | { readonly ok: true; readonly data: SettleResult }
  | { readonly ok: false; readonly error: SettleError };

/** The SQLSTATE codes `public.settle_order` raises, mirroring `public.create_organization`. */
const NOT_FOUND = "SM404";
const NOT_PENDING = "SM409";

/**
 * Runs the atomic settlement: order to `paid`, its `order_events` row, and the invoice with its
 * gapless number, all in one small transaction. Returns the invoice either way, so a retry after
 * a crash reports what already exists rather than failing. Never throws for an expected failure.
 * Server only.
 */
export async function settleOrder(
  service: Service,
  orderId: string,
  paidAt: Date,
  actor: SettleActor,
  seller: Seller,
  dueDays: number,
): Promise<SettleOutcome> {
  const { data, error } = await service
    .rpc("settle_order", {
      order_id: orderId,
      paid_at: paidAt.toISOString(),
      // Null on the webhook path: no human confirmed it, the trail records the service role.
      // The generated type is non nullable because the SQL parameter has no default, but the
      // column is nullable and the function takes null.
      actor_id: actor.role === "ops" ? actor.userId : (null as unknown as string),
      actor_role: actor.role,
      seller_name: seller.name,
      seller_address: seller.address,
      seller_uid: seller.uid,
      seller_iban: seller.iban,
      due_days: dueDays,
    })
    .single();

  if (error) {
    if (error.code === NOT_FOUND) {
      log.warn("settle order: no such order", { orderId });
      return { ok: false, error: "order_not_found" };
    }
    if (error.code === NOT_PENDING) {
      // Cancelled, expired or refunded: a real state conflict, not a duplicate. A duplicate is
      // handled inside the function, which returns the existing invoice with alreadySettled.
      log.warn("settle order: the order is not pending", { orderId, code: error.code });
      return { ok: false, error: "order_not_pending" };
    }
    log.error("settle order failed", { orderId, code: error.code, message: error.message });
    return { ok: false, error: "unexpected" };
  }

  if (!data) {
    log.error("settle order returned no row", { orderId });
    return { ok: false, error: "unexpected" };
  }

  log.info("order settled", {
    orderId,
    invoiceNumber: data.invoice_number,
    alreadySettled: data.already_settled,
    actorRole: actor.role,
  });

  return {
    ok: true,
    data: {
      orderId,
      invoiceId: data.invoice_id,
      invoiceNumber: data.invoice_number,
      qrReference: data.qr_reference,
      alreadySettled: data.already_settled,
    },
  };
}
