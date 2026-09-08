"use server";

import { cookies } from "next/headers";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  type ConsentChoice,
  consentCookieValue,
  isConsentChoice,
} from "./consent";

/**
 * The legal server actions (spec 0015). `setConsent` is the only write path for the consent
 * cookie: a POST writes it with the app's own `cookies()`, never client script, so the value
 * stays out of a third party script's reach and the reject path works without JavaScript.
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
