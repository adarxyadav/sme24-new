import "./instrumentation";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger, schemaTask } from "@trigger.dev/sdk";
import { localeForUser } from "@/features/localization/queries";
import { LOCALE_CODE } from "@/i18n/routing";
import { EMAIL_TEMPLATES, isEmailTemplateName } from "@/lib/email/registry";
import { renderEmail } from "@/lib/email/render";
import {
  type DeliveryStatus,
  type EmailRecipient,
  type NewSendPayload,
  type SendEmailPayload,
  sendEmailPayloadSchema,
} from "@/lib/email/schema";
import {
  chooseTransport,
  isAllowedRecipient,
  LOCAL_EMAIL_FROM,
  sendViaResend,
  sendViaSmtp,
} from "@/lib/email/transport";
import { taskEnv } from "@/lib/env";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { raiseAlertFromTask } from "./ops-alert";

type Service = SupabaseClient<Database>;
type DeliveryRow = Tables<"email_deliveries">;

/** The statuses the webhook may have written before the task's `sent` update lands (AC-5). */
const WEBHOOK_STATUSES = "(delivered,bounced,complained)";

/** Postgres: unique violation. */
const UNIQUE_VIOLATION = "23505";

type Resolved = {
  readonly email: string;
  readonly locale: "de" | "en";
  readonly recipientId: string | null;
  readonly firstName: string | null;
};

/**
 * The one email task (spec 0006, AC-3 to AC-7): creates or reuses the delivery row before any
 * render, writes the notification row for a known recipient, validates the data against the
 * template's schema, renders in the recipient's language and hands the message to Resend or SMTP.
 * A permanent provider failure marks the row failed; a transient one throws so Trigger.dev
 * retries; the last failure is recorded by `onFailure`. Runs in the Trigger.dev EU environment
 * with the service client and explicit ids.
 */
export const sendEmailTask = schemaTask({
  id: "send-email",
  schema: sendEmailPayloadSchema,
  run: async (payload, { ctx }) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

    const prepared =
      payload.kind === "new"
        ? await prepareNewDelivery(supabase, payload, ctx.run.id)
        : await loadRetry(supabase, payload.deliveryId);
    if (prepared.kind === "done") return prepared.result;

    return processDelivery(supabase, prepared.row, ctx.run.id, env);
  },
  onFailure: async ({ payload, ctx, error }) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const row = await deliveryOf(supabase, payload);
    if (!row) return;
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("email_deliveries")
      .update({ status: "failed", error: message, failed_at: new Date().toISOString() })
      .eq("id", row.id)
      .in("status", ["queued", "sending"]);
    logger.error("email delivery failed after the last attempt", {
      deliveryId: row.id,
      runId: ctx.run.id,
      reason: message,
    });
    await raiseEmailFailedAlert(row, message);
  },
});

type Prepared =
  | { readonly kind: "row"; readonly row: DeliveryRow }
  | { readonly kind: "done"; readonly result: { deliveryId: string; status: DeliveryStatus } };

/**
 * Creates the delivery row for a new send, or returns the existing one when the key was seen
 * before (AC-4). Resolves the recipient first so the row carries the address; a recipient that
 * cannot be resolved still gets a row (empty address, `skipped`, `recipient_missing`). Makes sure
 * the notification row sits next to the delivery on both paths (AC-3), so an attempt that died
 * between the two inserts is completed by the next one.
 */
async function prepareNewDelivery(
  supabase: Service,
  payload: NewSendPayload,
  runId: string,
): Promise<Prepared> {
  const existing = await findByKey(supabase, payload.idempotencyKey);
  if (existing && existing.last_run_id !== runId && existing.last_run_id !== null) {
    logger.info("email already handled for this key", {
      deliveryId: existing.id,
      status: existing.status,
    });
    return { kind: "done", result: { deliveryId: existing.id, status: statusOf(existing) } };
  }
  if (existing) {
    await ensureNotification(supabase, existing);
    return { kind: "row", row: existing };
  }

  const resolved = await resolveRecipient(supabase, payload.recipient);
  const data =
    resolved.firstName && !("firstName" in payload.data)
      ? { ...payload.data, firstName: resolved.firstName }
      : payload.data;

  const { data: inserted, error } = await supabase
    .from("email_deliveries")
    .insert({
      idempotency_key: payload.idempotencyKey,
      source_event: payload.sourceEvent,
      template: payload.template,
      locale: resolved.locale,
      recipient_email: resolved.email,
      recipient_id: resolved.recipientId,
      organization_id: payload.organizationId ?? null,
      data: data as Database["public"]["Tables"]["email_deliveries"]["Insert"]["data"],
      status: "queued",
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findByKey(supabase, payload.idempotencyKey);
      if (raced) {
        return { kind: "done", result: { deliveryId: raced.id, status: statusOf(raced) } };
      }
    }
    throw error;
  }

  const notify = await ensureNotification(supabase, inserted);

  logger.info("email delivery row created", {
    deliveryId: inserted.id,
    template: payload.template,
    sourceEvent: payload.sourceEvent,
    locale: resolved.locale,
    notify,
  });
  return { kind: "row", row: inserted };
}

/**
 * The notification row next to a delivery to a known user (AC-3), written once whatever the email
 * outcome: looked up by delivery id first, so a run that resumes a row left by a dead attempt
 * completes the pair without a duplicate. Ops events and templates that do not notify write none.
 * Returns whether a notification exists for the row.
 */
async function ensureNotification(supabase: Service, row: DeliveryRow): Promise<boolean> {
  if (row.recipient_id === null || row.source_event.startsWith("ops.")) return false;
  if (!isEmailTemplateName(row.template)) return false;
  const entry = EMAIL_TEMPLATES[row.template];
  if (!entry.notify) return false;

  const { data: existing, error: lookupError } = await supabase
    .from("notifications")
    .select("id")
    .eq("delivery_id", row.id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return true;

  const { error } = await supabase.from("notifications").insert({
    recipient_id: row.recipient_id,
    organization_id: row.organization_id,
    kind: row.template,
    data: row.data,
    link: entry.link,
    delivery_id: row.id,
  });
  if (error) throw error;
  return true;
}

/** A retry rerenders from the stored row (AC-4, AC-10); only a `failed` row is retried. */
async function loadRetry(supabase: Service, deliveryId: string): Promise<Prepared> {
  const { data: row, error } = await supabase
    .from("email_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error(`delivery ${deliveryId} not found`);
  if (row.status !== "failed" && row.status !== "sending") {
    logger.warn("retry refused: the delivery is not failed", { deliveryId, status: row.status });
    return { kind: "done", result: { deliveryId, status: statusOf(row) } };
  }
  return { kind: "row", row };
}

/** One attempt on a row: transport, allowlist, recipient, render, send, outcome (AC-5 to AC-7). */
async function processDelivery(
  supabase: Service,
  row: DeliveryRow,
  runId: string,
  env: ReturnType<typeof taskEnv>,
): Promise<{ deliveryId: string; status: DeliveryStatus }> {
  const attempts = row.attempts + 1;
  await update(supabase, row.id, { status: "sending", attempts, last_run_id: runId });

  const transport = chooseTransport(env);
  if (!transport) {
    logger.warn("email skipped: no transport configured", { deliveryId: row.id });
    return skip(supabase, row.id, "no_transport");
  }

  const recipient = await recipientOf(supabase, row);
  if (!recipient.email) return skip(supabase, row.id, "recipient_missing");
  if (!isAllowedRecipient(recipient.email, env.EMAIL_ALLOWED_RECIPIENTS)) {
    logger.info("email skipped: recipient not on the allowlist", { deliveryId: row.id });
    return skip(supabase, row.id, "not_allowlisted");
  }

  if (!isEmailTemplateName(row.template)) return fail(supabase, row.id, "invalid_data");
  const validation = EMAIL_TEMPLATES[row.template].schema.safeParse(row.data);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((issue) => `${issue.path.join(".") || "data"}: ${issue.message}`)
      .join("; ");
    return fail(supabase, row.id, `invalid_data: ${issues}`);
  }

  const from = env.EMAIL_FROM ?? (transport === "smtp" ? LOCAL_EMAIL_FROM : null);
  if (!from) return fail(supabase, row.id, "email_from_unset");

  const rendered = await renderEmail({
    template: row.template,
    locale: recipient.locale,
    data: isRecord(row.data) ? row.data : {},
    appUrl: env.NEXT_PUBLIC_APP_URL,
  }).catch((error: unknown) => {
    logger.error("email render failed", { deliveryId: row.id, reason: String(error) });
    return null;
  });
  if (!rendered) return fail(supabase, row.id, "render_failed");
  await update(supabase, row.id, { subject: rendered.subject, transport });

  const message = {
    from,
    to: recipient.email,
    replyTo: env.EMAIL_REPLY_TO,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `${row.id}/${attempts}`,
    template: row.template,
  };
  const outcome =
    transport === "resend"
      ? await sendViaResend(env.RESEND_API_KEY ?? "", message)
      : await sendViaSmtp(env.EMAIL_SMTP_URL ?? "", message);

  if (outcome.ok) {
    // The webhook may already have moved the row on; never step backwards (AC-5).
    const { error } = await supabase
      .from("email_deliveries")
      .update({
        status: "sent",
        provider_message_id: outcome.providerMessageId,
        sent_at: new Date().toISOString(),
        attempts,
        error: null,
      })
      .eq("id", row.id)
      .not("status", "in", WEBHOOK_STATUSES);
    if (error) throw error;
    logger.info("email sent", { deliveryId: row.id, transport, attempts });
    return { deliveryId: row.id, status: "sent" };
  }

  if (outcome.kind === "permanent") {
    logger.error("email rejected by the provider", {
      deliveryId: row.id,
      status: outcome.status,
      reason: outcome.message,
    });
    await fail(supabase, row.id, outcome.message);
    await raiseEmailFailedAlert({ ...row, attempts }, outcome.message);
    return { deliveryId: row.id, status: "failed" };
  }
  throw new Error(`email transport failure (${outcome.status ?? "network"}): ${outcome.message}`);
}

/** The address and language of a payload recipient: the auth admin API and `localeForUser` for a user, the raw values otherwise. */
async function resolveRecipient(supabase: Service, recipient: EmailRecipient): Promise<Resolved> {
  if ("email" in recipient) {
    return { email: recipient.email, locale: recipient.locale, recipientId: null, firstName: null };
  }
  const user = await lookupUser(supabase, recipient.userId);
  return { ...user, recipientId: recipient.userId };
}

/** A stored row's recipient: the stored address and locale, resolved again only when the address is empty (AC-4). */
async function recipientOf(
  supabase: Service,
  row: DeliveryRow,
): Promise<{ email: string; locale: "de" | "en" }> {
  const locale = row.locale === "en" ? "en" : "de";
  if (row.recipient_email !== "") return { email: row.recipient_email, locale };
  if (!row.recipient_id) return { email: "", locale };
  const user = await lookupUser(supabase, row.recipient_id);
  if (user.email) {
    await update(supabase, row.id, { recipient_email: user.email, locale: user.locale });
  }
  return { email: user.email, locale: user.locale };
}

async function lookupUser(
  supabase: Service,
  userId: string,
): Promise<{ email: string; locale: "de" | "en"; firstName: string | null }> {
  const [{ data: userData, error: userError }, locale, { data: profile, error: profileError }] =
    await Promise.all([
      supabase.auth.admin.getUserById(userId),
      localeForUser(supabase, userId),
      supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    ]);
  if (userError && userError.status !== 404) throw userError;
  if (profileError) throw profileError;
  const fullName = profile?.full_name ?? "";
  const firstName = fullName.trim().split(/\s+/)[0] ?? "";
  return {
    email: userData?.user?.email ?? "",
    locale: LOCALE_CODE[locale],
    firstName: firstName === "" ? null : firstName,
  };
}

async function findByKey(supabase: Service, key: string): Promise<DeliveryRow | null> {
  const { data, error } = await supabase
    .from("email_deliveries")
    .select("*")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function deliveryOf(
  supabase: Service,
  payload: SendEmailPayload,
): Promise<DeliveryRow | null> {
  const { data } = await supabase
    .from("email_deliveries")
    .select("*")
    .eq(
      payload.kind === "retry" ? "id" : "idempotency_key",
      payload.kind === "retry" ? payload.deliveryId : payload.idempotencyKey,
    )
    .maybeSingle();
  return data;
}

async function update(
  supabase: Service,
  id: string,
  patch: Database["public"]["Tables"]["email_deliveries"]["Update"],
): Promise<void> {
  const { error } = await supabase.from("email_deliveries").update(patch).eq("id", id);
  if (error) throw error;
}

async function skip(
  supabase: Service,
  id: string,
  reason: "no_transport" | "recipient_missing" | "not_allowlisted",
): Promise<{ deliveryId: string; status: DeliveryStatus }> {
  await update(supabase, id, { status: "skipped", error: reason });
  return { deliveryId: id, status: "skipped" };
}

async function fail(
  supabase: Service,
  id: string,
  reason: string,
): Promise<{ deliveryId: string; status: DeliveryStatus }> {
  await update(supabase, id, {
    status: "failed",
    error: reason,
    failed_at: new Date().toISOString(),
  });
  return { deliveryId: id, status: "failed" };
}

/** The `email.failed` alert (AC-7), linking to the delivery; keyed per delivery and attempt so a retry that fails again alerts again. */
async function raiseEmailFailedAlert(
  row: Pick<DeliveryRow, "id" | "template" | "attempts">,
  reason: string,
): Promise<void> {
  await raiseAlertFromTask({
    kind: "email.failed",
    fields: { deliveryId: row.id, template: row.template, reason: reason.slice(0, 500) },
    link: `/admin/emails/${row.id}`,
    idempotencyKey: `email-failed/${row.id}/${row.attempts}`,
  });
}

function statusOf(row: DeliveryRow): DeliveryStatus {
  return row.status as DeliveryStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
