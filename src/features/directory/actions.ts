"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale, getTranslations } from "next-intl/server";
import { classifyOrderInsertError } from "@/features/checkout/errors";
import { computeAmounts } from "@/features/checkout/money";
import { invoiceDueDays } from "@/features/checkout/seller";
import { openCheckoutSession } from "@/features/checkout/stripe-session";
import { getPathname } from "@/i18n/navigation";
import { LOCALE_CODE, type Locale, resolveLocale } from "@/i18n/routing";
import { captureServerEvent } from "@/lib/analytics/server";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { stripeConfigured } from "@/lib/stripe/client";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { CREDIT_BILLING_COUNTRY, creditCheckoutSchema, revealContactSchema } from "./schema";

/**
 * The directory's server actions (spec 0018, AC-12). Every one authorises the caller here, not
 * only in the proxy, which never runs for a server action post: `requireActiveExpert` reads the
 * claims and the caller's own `expert_profiles` row, and the definer functions check again in
 * the database. Each answers the typed result shape and never throws for an expected failure.
 */

type Client = SupabaseClient<Database>;

export type Actor = {
  readonly supabase: Client;
  readonly userId: string;
  /**
   * The RLS bypassing client, minted only after this actor was authorised and only when a write
   * outside the expert's grants is needed (the Stripe session id on their order, spec 0011's
   * shape). Lazy, the way `requireClient` in the checkout mints its own, so the plain paths never
   * construct one.
   */
  readonly service: () => Client;
};

/** A signed in expert whose profile is `active`; the only caller the directory serves. */
async function requireActiveExpert(): Promise<Actor | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "expert" || typeof claims?.sub !== "string") return null;
  const { data: profile } = await supabase
    .from("expert_profiles")
    .select("status")
    .eq("expert_id", claims.sub)
    .maybeSingle();
  if (profile?.status !== "active") return null;
  const service = () => {
    const env = serverEnv();
    return createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
  };
  return { supabase, userId: claims.sub, service };
}

/** The locale a form posts as its hidden field, falling back to the request's. */
async function localeOf(input: unknown): Promise<Locale> {
  const posted = (input as { locale?: unknown } | null)?.locale;
  return typeof posted === "string" ? resolveLocale(posted) : resolveLocale(await getLocale());
}

/** The SQLSTATE codes the definer functions raise, mapped to the typed errors. */
const INSUFFICIENT_CREDITS = "SM402";
const FORBIDDEN = "SM403";
const NOT_FOUND = "SM404";

export type RevealContactError =
  | "insufficient_credits"
  | "not_found"
  | "forbidden"
  | "validation"
  | "unexpected";

/** A revealed contact: the full row, raw values included. */
export type RevealedContact = {
  readonly contactId: string;
  readonly companyName: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly mobile: string | null;
  readonly unlockedAt: string;
};

export type RevealContactData = {
  readonly contact: RevealedContact;
  /** The caller's balance after this call. */
  readonly balance: number;
  /** True when the caller had already paid for this row, so nothing was debited. */
  readonly alreadyUnlocked: boolean;
};

export type RevealContactResult =
  | { ok: true; data: RevealContactData }
  | { ok: false; error: RevealContactError };

/**
 * Reveals one contact for one credit (AC-12): calls `directory_reveal` on the caller's own
 * client, which checks the role, the balance and the unlock and debits in one transaction, and
 * maps its codes to the typed errors. Fires `directory.unlocked` after the RPC succeeds, ids
 * only. Server action, active experts only.
 */
export async function revealContact(
  _previous: RevealContactResult | null,
  input: unknown,
): Promise<RevealContactResult> {
  const locale = await localeOf(input);
  const actor = await requireActiveExpert();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(revealContactSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };

  const { data, error } = await actor.supabase
    .rpc("directory_reveal", { contact_id: parsed.data.contactId })
    .single();
  if (error) {
    if (error.code === INSUFFICIENT_CREDITS) return { ok: false, error: "insufficient_credits" };
    if (error.code === NOT_FOUND) return { ok: false, error: "not_found" };
    if (error.code === FORBIDDEN) return { ok: false, error: "forbidden" };
    Sentry.captureException(error);
    log.error("directory reveal failed", { code: error.code, message: error.message });
    return { ok: false, error: "unexpected" };
  }

  // Never a name, an email or a company here: the event carries the opaque contact id only.
  await captureServerEvent({
    distinctId: actor.userId,
    event: "directory.unlocked",
    properties: {
      locale: LOCALE_CODE[locale],
      contactId: parsed.data.contactId,
      alreadyUnlocked: data.already_unlocked,
      balanceAfter: data.balance,
    },
  });

  return {
    ok: true,
    data: {
      contact: {
        contactId: data.id,
        companyName: data.company_name,
        firstName: data.first_name ?? null,
        lastName: data.last_name ?? null,
        title: data.contact_title ?? null,
        email: data.email,
        phone: data.phone ?? null,
        mobile: data.mobile ?? null,
        unlockedAt: data.unlocked_at,
      },
      balance: data.balance,
      alreadyUnlocked: data.already_unlocked,
    },
  };
}

/** The spec 0011 error set, answered by both credit actions the way the client checkout does. */
export type CreditCheckoutError =
  | "validation"
  | "forbidden"
  | "package_not_found"
  | "package_inactive"
  | "package_not_purchasable"
  | "invalid_billing_address"
  | "stripe_unavailable"
  | "unexpected";

export type CreditCheckoutResult<Data> =
  | { ok: true; data: Data }
  | { ok: false; error: CreditCheckoutError };

export type StartCreditCheckoutData = { checkoutUrl: string; orderId: string; reference: string };
export type RequestCreditInvoiceData = { orderId: string; reference: string };

/**
 * The order a credit purchase is about to create (AC-9): the pack read at action time with its
 * price, rate and credits frozen, the amounts from `computeAmounts`, the reference from the
 * sequence and the pack name in the buyer's language from `directory.packs.<key>.name`. Never
 * `prepareOrder` of the client checkout, which reads `marketing.packages` and would throw on a
 * credit pack. Answers a typed error rather than throwing.
 */
async function prepareCreditOrder(
  actor: Actor,
  input: import("./schema").CreditCheckoutInput,
  locale: Locale,
): Promise<
  | { ok: true; data: Record<string, unknown> & { reference: string } }
  | { ok: false; error: CreditCheckoutError }
> {
  const { data: pack, error: packError } = await actor.supabase
    .from("packages")
    .select("*")
    .eq("key", input.packKey)
    .maybeSingle();
  if (packError) {
    log.error("credit checkout: package read failed", { message: packError.message });
    return { ok: false, error: "unexpected" };
  }
  if (!pack || pack.kind !== "directory_credits" || pack.credits === null) {
    return { ok: false, error: "package_not_found" };
  }
  if (pack.price_rappen === null) return { ok: false, error: "package_not_purchasable" };
  if (!pack.is_active) return { ok: false, error: "package_inactive" };

  let amounts: ReturnType<typeof computeAmounts>;
  try {
    amounts = computeAmounts(Number(pack.price_rappen), Number(pack.vat_rate));
  } catch (error) {
    Sentry.captureException(error);
    log.error("credit checkout: package price is not usable", { packKey: input.packKey });
    return { ok: false, error: "unexpected" };
  }

  const { data: counter, error: sequenceError } = await actor.supabase.rpc("next_order_reference");
  if (sequenceError || typeof counter !== "string") {
    log.error("credit checkout: order reference could not be drawn", {
      message: sequenceError?.message,
    });
    return { ok: false, error: "unexpected" };
  }

  const packs = await getTranslations({ locale, namespace: "directory.packs" });
  const packageName = packs(`${input.packKey}.name` as never);

  return {
    ok: true,
    data: {
      buyer_expert_id: actor.userId,
      credits: pack.credits,
      package_key: input.packKey,
      reference: counter,
      payment_method: input.paymentMethod,
      net_rappen: amounts.netRappen,
      vat_rate: amounts.vatRate,
      vat_rappen: amounts.vatRappen,
      gross_rappen: amounts.grossRappen,
      package_name_snapshot: packageName,
      billing_name: input.billingName,
      billing_street: input.billingStreet,
      billing_postcode: input.billingPostcode,
      billing_town: input.billingTown,
      billing_country: CREDIT_BILLING_COUNTRY,
      billing_uid: input.billingUid,
      locale: LOCALE_CODE[locale],
      created_by: actor.userId,
    },
  };
}

/** The return page of a credit purchase, in the buyer's language, with the order to show. */
function creditsReturnUrl(locale: Locale, orderId: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${appUrl}${getPathname({
    locale,
    href: { pathname: "/expert/directory/credits", query: { order: orderId } },
  })}`;
}

/** Inserts the pending order and its creation event under the expert's own policies. */
async function insertCreditOrder(
  actor: Actor,
  row: Record<string, unknown>,
  context: string,
): Promise<
  { ok: true; order: SessionOrderRow } | { ok: false; error: "forbidden" | "unexpected" }
> {
  const { data: order, error: insertError } = await actor.supabase
    .from("orders")
    .insert(row as never)
    .select("id, reference, gross_rappen, package_name_snapshot, locale")
    .single();
  if (insertError || !order) {
    const classified = classifyOrderInsertError(insertError);
    log.error(`${context}: order insert failed`, {
      error: classified,
      code: insertError?.code,
      message: insertError?.message,
      details: insertError?.details,
    });
    return { ok: false, error: classified === "forbidden" ? "forbidden" : "unexpected" };
  }
  // The expert's own creation event; every later transition is written by the webhook or ops.
  const { error: eventError } = await actor.supabase.from("order_events").insert({
    order_id: order.id,
    to_status: "pending",
    actor_id: actor.userId,
    actor_role: "expert",
  });
  if (eventError) {
    Sentry.captureException(eventError);
    log.error(`${context}: order event insert failed`, { orderId: order.id });
  }
  return { ok: true, order };
}

type SessionOrderRow = {
  id: string;
  reference: string;
  gross_rappen: number;
  package_name_snapshot: string;
  locale: string;
};

/**
 * Opens a Stripe Checkout Session for a credit pack (AC-9): the pending order first, then the
 * session, then its id through the lazy service client scoped to the buyer, and the payable URL
 * only once that write is confirmed (spec 0011's rule, shared code). Server action, active
 * experts only.
 */
export async function startCreditCheckout(
  _previous: CreditCheckoutResult<StartCreditCheckoutData> | null,
  input: unknown,
): Promise<CreditCheckoutResult<StartCreditCheckoutData>> {
  const locale = await localeOf(input);
  const actor = await requireActiveExpert();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(creditCheckoutSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalid_billing_address" };
  if (!stripeConfigured()) {
    log.warn("credit checkout: Stripe is not configured in this environment");
    return { ok: false, error: "stripe_unavailable" };
  }

  const prepared = await prepareCreditOrder(
    actor,
    { ...parsed.data, paymentMethod: "card" },
    locale,
  );
  if (!prepared.ok) return prepared;
  const inserted = await insertCreditOrder(actor, prepared.data, "credit checkout");
  if (!inserted.ok) return inserted;

  const returnUrl = creditsReturnUrl(locale, inserted.order.id);
  const session = await openCheckoutSession({
    order: inserted.order,
    successUrl: returnUrl,
    cancelUrl: returnUrl,
    service: actor.service,
    scope: { column: "buyer_expert_id", value: actor.userId },
    context: "credit checkout",
  });
  if (!session.ok) return { ok: false, error: session.error };

  log.info("credit checkout started", {
    orderId: inserted.order.id,
    reference: inserted.order.reference,
  });
  return {
    ok: true,
    data: {
      checkoutUrl: session.url,
      orderId: inserted.order.id,
      reference: inserted.order.reference,
    },
  };
}

/**
 * Buys a credit pack by bank transfer (AC-9): the pending order with its due date, then the
 * `issue-invoice` task draws the invoice in its small transaction; the credits arrive when ops
 * mark the transfer paid, through the same `settle_order` grant. Server action, active experts
 * only.
 */
export async function requestCreditInvoice(
  _previous: CreditCheckoutResult<RequestCreditInvoiceData> | null,
  input: unknown,
): Promise<CreditCheckoutResult<RequestCreditInvoiceData>> {
  const locale = await localeOf(input);
  const actor = await requireActiveExpert();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(creditCheckoutSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalid_billing_address" };

  const prepared = await prepareCreditOrder(
    actor,
    { ...parsed.data, paymentMethod: "bank_transfer" },
    locale,
  );
  if (!prepared.ok) return prepared;

  const dueDate = new Date();
  dueDate.setUTCDate(dueDate.getUTCDate() + invoiceDueDays());
  const inserted = await insertCreditOrder(
    actor,
    { ...prepared.data, due_date: dueDate.toISOString().slice(0, 10) },
    "credit invoice",
  );
  if (!inserted.ok) return inserted;

  try {
    const { issueInvoiceTask } = await import("@/trigger/issue-invoice");
    await issueInvoiceTask.trigger(
      { orderId: inserted.order.id },
      { idempotencyKey: `invoice-issue/${inserted.order.id}` },
    );
  } catch (error) {
    // The order exists and ops can still issue the invoice by hand; the buyer sees the order.
    Sentry.captureException(error);
    log.error("credit invoice: the invoice could not be issued", { orderId: inserted.order.id });
  }

  log.info("credit invoice requested", {
    orderId: inserted.order.id,
    reference: inserted.order.reference,
  });
  return {
    ok: true,
    data: { orderId: inserted.order.id, reference: inserted.order.reference },
  };
}
