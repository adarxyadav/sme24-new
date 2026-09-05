"use server";

import { redirect as nextRedirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { redirect } from "@/i18n/navigation";
import { LOCALE_CODE, routing } from "@/i18n/routing";
import { ROLE_HOME, roleFromClaims } from "@/lib/auth/roles";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { parseWith } from "@/lib/validation";
import { signInSchema } from "./schema";

/**
 * Scaffold sign in (email + password) so the role gate can be exercised with the seeded users.
 * Feature 6 owns the real sign in methods and the organization model.
 */
export async function signIn(formData: FormData) {
  const requestedLocale = formData.get("locale");
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale;
  const next = formData.get("next");

  const parsed = parseWith(
    signInSchema,
    { email: formData.get("email"), password: formData.get("password") },
    locale,
  );
  if (!parsed.success) {
    return redirect({ href: { pathname: "/sign-in", query: { error: "invalid" } }, locale });
  }

  const supabase = await createActionClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    log.info("sign in rejected", { reason: error.code ?? error.message });
    return redirect({ href: { pathname: "/sign-in", query: { error: "invalid" } }, locale });
  }

  const { data } = await supabase.auth.getClaims();
  const role = roleFromClaims(data?.claims);

  // `next` is a full path from the proxy (`/de/admin`): the prefix is the short code, not the locale.
  const prefix = `/${LOCALE_CODE[locale]}`;
  if (typeof next === "string" && next.startsWith(`${prefix}/`)) {
    return nextRedirect(next);
  }
  return redirect({ href: role ? ROLE_HOME[role] : "/", locale });
}

export async function signOut(formData: FormData) {
  const requestedLocale = formData.get("locale");
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale;

  const supabase = await createActionClient();
  await supabase.auth.signOut();
  return redirect({ href: "/", locale });
}
