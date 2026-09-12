"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALE_CODE, type Locale, resolveLocale } from "@/i18n/routing";
import { captureServerEvent } from "@/lib/analytics/server";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { stripeConfigured } from "@/lib/stripe/client";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { classifyOrderInsertError } from "./errors";
import { computeAmounts } from "./money";
import { checkoutSchema } from "./schema";
import { invoiceDueDays } from "./seller";
import { openCheckoutSession } from "./stripe-session";

/**
 * The checkout server actions (spec 0011, AC-1, AC-8, AC-11, AC-19). `startCheckout` opens a
 * Stripe Checkout Session for a card payment; `requestInvoice` (slice 3) issues an invoice for a
 * bank transfer. Both freeze the price, the VAT rate and the billing address onto the order, so a
 * later price change never rewrites a past invoice.
 *
 * Neither ever writes `paid`: that is `settleOrder`'s alone, reached from the webhook task or an
 * ops action (invariant 13). Both return the typed result shape and never throw for an expected
 * failure.
 */

type Client = SupabaseClient<Database>;

export type CheckoutError =
  | "validation"
  | "forbidden"
  | "package_not_found"
  | "package_inactive"
  | "package_not_purchasable"
  | "company_not_found"
  | "invalid_billing_address"
  | "stripe_unavailable"
  | "unexpected";

export type CheckoutResult<Data> = { ok: true; data: Data } | { ok: false; error: CheckoutError };

export type StartCheckoutData = { checkoutUrl: string; orderId: string; reference: string };

type Actor = {
  readonly supabase: Client;
  readonly userId: string;
  readonly organizationId: string;
  /**
   * The RLS bypassing client, minted only after this actor was authorized, the same way
   * `requireOps` in `ops-actions.ts` mints its own. Lazy, so the plain paths never construct one.
   */
  readonly service: () => Client;
};

/** A signed in client with an organization claim; authorization lives here, not only in the proxy. */
async function requireClient(): Promise<Actor | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const organizationId = organizationIdFromClaims(claims);
  if (roleFromClaims(claims) !== "client" || typeof claims?.sub !== "string" || !organizationId) {
    return null;
  }
  const service = () => {
    const env = serverEnv();
    return createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
  };
  return { supabase, userId: claims.sub, organizationId, service };
}

function localeOf(input: unknown): Locale {
  return resolveLocale((input as { locale?: unknown } | null)?.locale);
}

/**
 * The order the checkout is about to create: the package read at action time with its price and
 * rate frozen, the amounts derived by `computeAmounts`, and the reference drawn from the
 * sequence. Returns a typed error rather than throwing, so an unpurchasable package never reaches
 * an insert and never surfaces as an opaque database error (AC-19).
 */
async function prepareOrder(
  actor: Actor,
  input: ReturnType<typeof checkoutSchema.parse>,
  locale: Locale,
  paymentMethod: "card" | "bank_transfer",
): Promise<
  | { ok: true; data: Record<string, unknown> & { reference: string } }
  | { ok: false; error: CheckoutError }
> {
  const { data: pkg, error: packageError } = await actor.supabase
    .from("packages")
    .select("*")
    .eq("key", input.packageKey)
    .maybeSingle();
  if (packageError) {
    log.error("checkout: package read failed", { message: packageError.message });
    return { ok: false, error: "unexpected" };
  }
  if (!pkg) return { ok: false, error: "package_not_found" };
  // Two independent gates, in the spec's order: a package with no price is never purchasable,
  // and an inactive one cannot start a new checkout.
  if (pkg.price_rappen === null) return { ok: false, error: "package_not_purchasable" };
  if (!pkg.is_active) return { ok: false, error: "package_inactive" };

  const { data: company, error: companyError } = await actor.supabase
    .from("companies")
    .select("id")
    .eq("id", input.companyId)
    .maybeSingle();
  if (companyError) {
    log.error("checkout: company read failed", { message: companyError.message });
    return { ok: false, error: "unexpected" };
  }
  if (!company) return { ok: false, error: "company_not_found" };

  let amounts: ReturnType<typeof computeAmounts>;
  try {
    amounts = computeAmounts(Number(pkg.price_rappen), Number(pkg.vat_rate));
  } catch (error) {
    // A price the database holds that the pure function refuses is a data problem, not a user one.
    Sentry.captureException(error);
    log.error("checkout: package price is not usable", { packageKey: input.packageKey });
    return { ok: false, error: "unexpected" };
  }

  const { data: counter, error: sequenceError } = await actor.supabase.rpc("next_order_reference");
  if (sequenceError || typeof counter !== "string") {
    log.error("checkout: order reference could not be drawn", { message: sequenceError?.message });
    return { ok: false, error: "unexpected" };
  }

  // The package name in the buyer's language at purchase, for the invoice line item.
  const t = await getTranslations({ locale, namespace: "marketing.packages" });
  const packageName = t(`${input.packageKey}.name` as never);

  return {
    ok: true,
    data: {
      organization_id: actor.organizationId,
      company_id: input.companyId,
      package_key: input.packageKey,
      reference: counter,
      payment_method: paymentMethod,
      net_rappen: amounts.netRappen,
      vat_rate: amounts.vatRate,
      vat_rappen: amounts.vatRappen,
      gross_rappen: amounts.grossRappen,
      package_name_snapshot: packageName,
      billing_name: input.billingName,
      billing_street: input.billingStreet,
      billing_postcode: input.billingPostcode,
      billing_town: input.billingTown,
      billing_country: input.billingCountry,
      billing_uid: input.billingUid,
      locale: LOCALE_CODE[locale],
      created_by: actor.userId,
    },
  };
}

/**
 * Opens a Stripe Checkout Session for a card payment (AC-1, AC-11, AC-19).
 *
 * The ordering is load bearing (spec 0011, Value sourcing): the `pending` order is inserted
 * first, committing its reference and its frozen amounts, **then** the Stripe session is created,
 * **then** the session id is stored. A Stripe failure therefore leaves a `pending` card order
 * with a null `stripe_checkout_session_id`, which is exactly what the sweep keys on to expire it
 * an hour later. Doing it the other way round would leave a paid session with no order.
 *
 * Server action, client member of the organization.
 */
export async function startCheckout(
  _previous: CheckoutResult<StartCheckoutData> | null,
  input: unknown,
): Promise<CheckoutResult<StartCheckoutData>> {
  const locale = localeOf(input) ?? (await getLocale());
  const actor = await requireClient();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(checkoutSchema, input, locale);
  if (!parsed.success) {
    // The billing address rules and the package key share one schema, so a UID that fails its
    // check digit surfaces as the address error the form shows under the field.
    return { ok: false, error: "invalid_billing_address" };
  }

  if (!stripeConfigured()) {
    log.warn("checkout: Stripe is not configured in this environment");
    return { ok: false, error: "stripe_unavailable" };
  }

  const prepared = await prepareOrder(actor, parsed.data, locale, "card");
  if (!prepared.ok) return prepared;

  const { data: order, error: insertError } = await actor.supabase
    .from("orders")
    .insert(prepared.data as never)
    .select("id, reference, gross_rappen, package_name_snapshot, locale")
    .single();
  if (insertError || !order) {
    const classified = classifyOrderInsertError(insertError);
    log.error("checkout: order insert failed", {
      error: classified,
      code: insertError?.code,
      message: insertError?.message,
      details: insertError?.details,
    });
    if (classified === "forbidden") return { ok: false, error: "forbidden" };
    return { ok: false, error: "unexpected" };
  }

  // The client's own creation event; every later transition is written by the webhook or ops.
  const { error: eventError } = await actor.supabase.from("order_events").insert({
    organization_id: actor.organizationId,
    order_id: order.id,
    to_status: "pending",
    actor_id: actor.userId,
    actor_role: "client",
  });
  if (eventError) {
    // The order exists and is valid, so the purchase continues; the missing history row is
    // reported rather than failing a payment over an audit row.
    Sentry.captureException(eventError);
    log.error("checkout: order event insert failed", { orderId: order.id });
  }

  // The session and the id write, shared with the expert credit checkout (spec 0018) so the
  // load bearing ordering lives in one place; the write is scoped to the buyer's organization.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const returnUrl = `${appUrl}/${LOCALE_CODE[locale]}/app/orders/${order.id}`;
  const session = await openCheckoutSession({
    order,
    successUrl: returnUrl,
    cancelUrl: returnUrl,
    service: actor.service,
    scope: { column: "organization_id", value: actor.organizationId },
    context: "checkout",
  });
  if (!session.ok) return { ok: false, error: session.error };

  log.info("checkout started", { orderId: order.id, reference: order.reference });
  // After the session id write is confirmed (AC-8), which is the point the checkout is real: an
  // order whose session id never persisted is one nobody can pay, and the sweep expires it.
  await captureServerEvent({
    distinctId: actor.userId,
    event: "checkout.started",
    properties: {
      organizationId: actor.organizationId,
      locale: LOCALE_CODE[locale],
      orderId: order.id,
      packageKey: parsed.data.packageKey,
      grossRappen: Number(order.gross_rappen),
    },
  });
  return {
    ok: true,
    data: { checkoutUrl: session.url, orderId: order.id, reference: order.reference },
  };
}

export type RequestInvoiceData = { orderId: string; reference: string };

/**
 * Buys a package by bank transfer (AC-8, AC-19). Same validation and freezing as `startCheckout`,
 * but the invoice is issued **at creation** rather than at payment: the buyer needs the document
 * with its QR bill before they can pay it. So the order is `pending` with an invoice, which is
 * simply an unpaid invoice (invariant 11), and ops mark it paid when the money lands.
 *
 * Server action, client member of the organization.
 */
export async function requestInvoice(
  _previous: CheckoutResult<RequestInvoiceData> | null,
  input: unknown,
): Promise<CheckoutResult<RequestInvoiceData>> {
  const locale = localeOf(input) ?? (await getLocale());
  const actor = await requireClient();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(checkoutSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalid_billing_address" };

  const prepared = await prepareOrder(actor, parsed.data, locale, "bank_transfer");
  if (!prepared.ok) return prepared;

  // The due date is written with the order rather than waiting for the issuing task, so the order
  // page can state when payment is due the moment the client lands on it. The task writes the same
  // date onto the invoice it issues, from the same INVOICE_DUE_DAYS.
  const dueDate = new Date();
  dueDate.setUTCDate(dueDate.getUTCDate() + invoiceDueDays());

  const { data: order, error: insertError } = await actor.supabase
    .from("orders")
    .insert({ ...prepared.data, due_date: dueDate.toISOString().slice(0, 10) } as never)
    .select("id, reference")
    .single();
  if (insertError || !order) {
    const classified = classifyOrderInsertError(insertError);
    log.error("request invoice: order insert failed", {
      error: classified,
      code: insertError?.code,
      message: insertError?.message,
      details: insertError?.details,
    });
    if (classified === "forbidden") return { ok: false, error: "forbidden" };
    return { ok: false, error: "unexpected" };
  }

  await actor.supabase.from("order_events").insert({
    organization_id: actor.organizationId,
    order_id: order.id,
    to_status: "pending",
    actor_id: actor.userId,
    actor_role: "client",
  });

  // Issuing the invoice and rendering it needs the service role, so it runs in a task: the client
  // may not write an invoice row (AC-12), and the number must be drawn in the small transaction.
  const { error: issueError } = await issueInvoiceForTransfer(order.id);
  if (issueError) {
    // The order exists and ops can still issue the invoice by hand; the client sees the order.
    Sentry.captureException(issueError);
    log.error("request invoice: the invoice could not be issued", { orderId: order.id });
  }

  log.info("invoice requested", { orderId: order.id, reference: order.reference });
  return { ok: true, data: { orderId: order.id, reference: order.reference } };
}

/** Enqueues the task that issues and renders a bank transfer invoice. Server action helper. */
async function issueInvoiceForTransfer(orderId: string): Promise<{ error: unknown }> {
  try {
    const { issueInvoiceTask } = await import("@/trigger/issue-invoice");
    await issueInvoiceTask.trigger({ orderId }, { idempotencyKey: `invoice-issue/${orderId}` });
    return { error: null };
  } catch (error) {
    return { error };
  }
}
