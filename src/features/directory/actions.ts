"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale } from "next-intl/server";
import { LOCALE_CODE, type Locale, resolveLocale } from "@/i18n/routing";
import { captureServerEvent } from "@/lib/analytics/server";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { revealContactSchema } from "./schema";

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
