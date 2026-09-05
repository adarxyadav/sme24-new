import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend, type WebhookEventPayload } from "resend";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import type { DeliveryStatus } from "./schema";

/**
 * The forward only rule (spec 0006, AC-8): a webhook status applies only when its rank is higher
 * than the row's. Statuses outside this map (queued, sending, failed, skipped) rank zero, so a
 * delivery event that lands before the task's own `sent` write still applies.
 */
export const STATUS_RANK: Readonly<Partial<Record<DeliveryStatus, number>>> = {
  sent: 1,
  delivered: 2,
  bounced: 2,
  complained: 3,
};

type DeliveryPatch = Database["public"]["Tables"]["email_deliveries"]["Update"];

export type WebhookDecision =
  | { readonly kind: "apply"; readonly patch: DeliveryPatch }
  | { readonly kind: "ignore"; readonly reason: "rank" | "unhandled" | "delayed" };

/**
 * What one Resend event does to a row in `current` status (AC-8): delivered, bounced and
 * complained move the status forward by rank, delivery delayed is logged only, everything else
 * is ignored. Pure.
 */
export function decideWebhookEvent(current: string, event: WebhookEventPayload): WebhookDecision {
  const target = targetOf(event);
  if (target === "delayed") return { kind: "ignore", reason: "delayed" };
  if (target === null) return { kind: "ignore", reason: "unhandled" };
  const currentRank = STATUS_RANK[current as DeliveryStatus] ?? 0;
  const nextRank = STATUS_RANK[target.status] ?? 0;
  if (nextRank <= currentRank) return { kind: "ignore", reason: "rank" };
  return { kind: "apply", patch: target.patch };
}

function targetOf(
  event: WebhookEventPayload,
): { status: DeliveryStatus; patch: DeliveryPatch } | "delayed" | null {
  switch (event.type) {
    case "email.delivered":
      return {
        status: "delivered",
        patch: { status: "delivered", delivered_at: event.created_at },
      };
    case "email.bounced": {
      const { type, message } = event.data.bounce;
      return { status: "bounced", patch: { status: "bounced", error: `${type}: ${message}` } };
    }
    case "email.complained":
      return { status: "complained", patch: { status: "complained" } };
    case "email.delivery_delayed":
      return "delayed";
    default:
      return null;
  }
}

/** The service client is the only writer of a delivery; the route passes none, tests pass a fake. */
export type WebhookDeps = {
  readonly supabase?: SupabaseClient<Database>;
};

/**
 * `POST /api/webhooks/resend` (AC-8): verifies the Svix signature with `RESEND_WEBHOOK_SECRET`
 * (503 when the secret is unset, 401 on a bad signature), finds the row by `provider_message_id`
 * (an unknown id answers 200 and logs) and applies the forward only status rule. A repeated event
 * is a no op through the same rule. Route handler, service client, updates status columns only.
 */
export async function handleResendWebhook(
  request: Request,
  deps: WebhookDeps = {},
): Promise<Response> {
  const env = serverEnv();
  if (!env.RESEND_WEBHOOK_SECRET) {
    log.error("resend webhook refused: RESEND_WEBHOOK_SECRET is not set");
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const payload = await request.text();
  const headers = {
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  };
  const event = verify(payload, headers, env.RESEND_WEBHOOK_SECRET);
  if (!event) {
    log.warn("resend webhook refused: bad signature", { svixId: headers.id });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  if (!("email_id" in event.data)) return Response.json({ received: true });
  const emailId = event.data.email_id;
  const supabase =
    deps.supabase ?? createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
  const { data: row, error } = await supabase
    .from("email_deliveries")
    .select("id, status")
    .eq("provider_message_id", emailId)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    log.info("resend webhook for an unknown message id", { type: event.type, emailId });
    return Response.json({ received: true });
  }

  const decision = decideWebhookEvent(row.status, event);
  if (decision.kind === "ignore") {
    log.info("resend webhook ignored", {
      type: event.type,
      deliveryId: row.id,
      status: row.status,
      reason: decision.reason,
    });
    return Response.json({ received: true });
  }

  const { error: updateError } = await supabase
    .from("email_deliveries")
    .update(decision.patch)
    .eq("id", row.id)
    .eq("status", row.status);
  if (updateError) throw updateError;
  log.info("resend webhook applied", {
    type: event.type,
    deliveryId: row.id,
    from: row.status,
    to: decision.patch.status,
  });
  return Response.json({ received: true });
}

/**
 * Only the signature is checked here; the API key is not needed to verify, but the SDK's
 * constructor insists on one, so a placeholder that never reaches the network is passed.
 */
function verify(
  payload: string,
  headers: { id: string; timestamp: string; signature: string },
  webhookSecret: string,
): WebhookEventPayload | null {
  try {
    const resend = new Resend("re_webhook_verify_only");
    return resend.webhooks.verify({ payload, headers, webhookSecret });
  } catch {
    return null;
  }
}
