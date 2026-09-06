"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALE_CODE, type Locale, resolveLocale } from "@/i18n/routing";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { log } from "@/lib/logger";
import { stripe, stripeConfigured } from "@/lib/stripe/client";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { parseWith } from "@/lib/validation";
import { classifyOrderInsertError } from "./errors";
import { computeAmounts } from "./money";
import { orderReference } from "./reference";
import { checkoutSchema } from "./schema";

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
  return { supabase, userId: claims.sub, organizationId };
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
    log.error("checkout: order insert failed", { error: classified });
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

  const client = stripe();
  if (!client) return { ok: false, error: "stripe_unavailable" };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  let session: { id: string; url: string | null };
  try {
    session = await client.checkout.sessions.create(
      {
        mode: "payment",
        // The return page is the order's own detail page, so the return is a normal read of a row
        // the client already owns and the session_id Stripe appends is ignored entirely.
        success_url: `${appUrl}/${locale}/app/orders/${order.id}`,
        cancel_url: `${appUrl}/${locale}/app/orders/${order.id}`,
        client_reference_id: order.id,
        locale: order.locale === "de" ? "de" : "en",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "chf",
              // Stripe's minor unit for CHF is the Rappen, so the integer passes unchanged: the
              // gross already includes the VAT we computed, which is why automatic_tax is off.
              unit_amount: Number(order.gross_rappen),
              product_data: { name: order.package_name_snapshot },
            },
          },
        ],
        metadata: { order_id: order.id, reference: order.reference },
      },
      // One session per order, whatever happens to the request.
      { idempotencyKey: `checkout/${order.id}` },
    );
  } catch (error) {
    Sentry.captureException(error);
    log.error("checkout: stripe session creation failed", { orderId: order.id });
    // The pending order stays with a null session id; the sweep expires it in an hour (AC-6).
    return { ok: false, error: "stripe_unavailable" };
  }

  const { error: updateError } = await actor.supabase
    .from("orders")
    .update({ stripe_checkout_session_id: session.id } as never)
    .eq("id", order.id);
  if (updateError) {
    // The session exists and the buyer can still pay; the webhook finds the order by its
    // client_reference_id, so the missing id is a reconciliation problem, not a lost payment.
    Sentry.captureException(updateError);
    log.error("checkout: could not store the stripe session id", { orderId: order.id });
  }

  if (!session.url) {
    log.error("checkout: stripe returned no session url", { orderId: order.id });
    return { ok: false, error: "stripe_unavailable" };
  }

  log.info("checkout started", { orderId: order.id, reference: order.reference });
  return {
    ok: true,
    data: { checkoutUrl: session.url, orderId: order.id, reference: order.reference },
  };
}
