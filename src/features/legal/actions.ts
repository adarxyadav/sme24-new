"use server";

import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  type ConsentChoice,
  consentCookieValue,
  isConsentChoice,
} from "./consent";
import { CURRENT_TERMS_VERSION } from "./terms";

/**
 * The legal server actions (spec 0015). `setConsent` is the only write path for the consent
 * cookie: a POST writes it with the app's own `cookies()`, never client script, so the value
 * stays out of a third party script's reach and the reject path works without JavaScript.
 * `acceptTerms` is the only write path for the two consent columns on the profile.
 */

export type SetConsentResult = { ok: true } | { ok: false; error: "validation" };

/**
 * Stores the visitor's answer to the cookie bar (AC-3). First party, `SameSite=Lax`, readable by
 * the bar after mount (so not `HttpOnly`), `Secure` only in production so `pnpm dev` over plain
 * HTTP keeps working, one year. Server action, public: a visitor has no session.
 */
export async function setConsent(choice: ConsentChoice): Promise<SetConsentResult> {
  if (!isConsentChoice(choice)) return { ok: false, error: "validation" };

  const cookieStore = await cookies();
  cookieStore.set(CONSENT_COOKIE, consentCookieValue(choice), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CONSENT_MAX_AGE_SECONDS,
  });
  return { ok: true };
}

/**
 * Forgets the stored answer so the bar opens again (AC-8b), for the control on `/cookies`. The
 * cookie is deleted server side like every other write to it, so nothing in the browser ever
 * assigns `document.cookie`. Server action, public.
 */
export async function clearConsent(): Promise<SetConsentResult> {
  const cookieStore = await cookies();
  cookieStore.delete(CONSENT_COOKIE);
  return { ok: true };
}

export type AcceptTermsResult =
  | { ok: true; data: { version: string } }
  | { ok: false; error: "forbidden" | "unexpected" };

/**
 * Records the caller's acceptance of the current terms (AC-10), the one way out of the re consent
 * dialog. The version is `CURRENT_TERMS_VERSION`, never a form field: the client is being asked to
 * accept what this build shows them, so letting the browser name the version would let it accept a
 * version it never rendered.
 *
 * Writes through `accept_terms()` on the caller's own client, because both columns sit outside the
 * authenticated column grant and the definer function's `auth.uid()` check is what keeps the write
 * to the caller's own row. Idempotent: accepting a version already stored changes nothing.
 *
 * Returns a typed result and never throws for an expected failure. Server action, any signed in
 * role.
 */
export async function acceptTerms(): Promise<AcceptTermsResult> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return { ok: false, error: "forbidden" };

  const { error } = await supabase.rpc("accept_terms", { version: CURRENT_TERMS_VERSION });
  if (error) {
    log.error("accept_terms failed", { reason: error.message });
    Sentry.captureException(new Error(`accept_terms failed: ${error.message}`), {
      tags: { source: "legal" },
    });
    return { ok: false, error: "unexpected" };
  }
  return { ok: true, data: { version: CURRENT_TERMS_VERSION } };
}
