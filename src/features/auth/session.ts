import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCALE_CODE, type Locale } from "@/i18n/routing";
import { buildConfirmRedirectUrl } from "@/lib/auth/confirm-url";
import { landingPath, localizedPath } from "@/lib/auth/redirects";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { clientEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * The absolute destination `signUp`, `requestCode`, `resendConfirmation` and
 * `requestPasswordReset` pass as `emailRedirectTo`; the template puts it into `next` and the
 * confirm handler reads the locale from it (spec 0005, AC-13). Server actions and the invite script.
 */
export function confirmRedirectUrl(locale: Locale, path: "/app" | "/reset-password"): string {
  return buildConfirmRedirectUrl(clientEnv().NEXT_PUBLIC_APP_URL, LOCALE_CODE[locale], path);
}

export type EnsureOrganizationResult =
  | { ok: true }
  | { ok: false; error: "not_a_client" | "failed" };

/**
 * The only caller of `create_organization` (spec 0005, key invariants): creates the caller's
 * organization, treats `already_member` as success, then refreshes the session so the access token
 * hook writes the organization claim. Runs on the action client in server actions and route
 * handlers, so the refreshed cookies reach the response.
 */
export async function ensureOrganization(
  supabase: Client,
  name: string,
): Promise<EnsureOrganizationResult> {
  const { error } = await supabase.rpc("create_organization", { name });
  if (error && !error.message.includes("already_member")) {
    if (error.message.includes("not_a_client")) return { ok: false, error: "not_a_client" };
    log.warn("create_organization failed", { reason: error.message });
    return { ok: false, error: "failed" };
  }

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    log.warn("session refresh after create_organization failed", { reason: refreshError.message });
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}

/**
 * Where a freshly signed in session lands (spec 0005): an unverified provider email is signed out
 * again; staff go to `next` or their role home; a client with an organization claim goes to `next`
 * or `/app`; a client without one gets the organization from the sign up metadata (name plus
 * consent) or is sent to `/app/onboarding`. Returns a locale prefixed path. Server actions and the
 * `/api/auth` route handlers, on the action client.
 */
export async function finalizeSignIn(
  supabase: Client,
  locale: Locale,
  next: unknown,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return `${localizedPath(locale, "/sign-in")}?error=session`;

  if (!user.email_confirmed_at) {
    await supabase.auth.signOut({ scope: "local" });
    log.info("sign in refused: provider did not verify the email", { userId: user.id });
    return `${localizedPath(locale, "/sign-in")}?error=email_unverified`;
  }

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const role = roleFromClaims(claims);
  if (role !== "client" || organizationIdFromClaims(claims)) {
    return landingPath(next, role, locale);
  }

  const metadata: Record<string, unknown> = user.user_metadata ?? {};
  const organizationName =
    typeof metadata.organization_name === "string" ? metadata.organization_name.trim() : "";
  const consented =
    typeof metadata.terms_accepted_at === "string" && metadata.terms_accepted_at !== "";
  if (organizationName && consented) {
    const result = await ensureOrganization(supabase, organizationName);
    if (result.ok) return landingPath(next, role, locale);
  }
  return localizedPath(locale, "/app/onboarding");
}
