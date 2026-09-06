import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCALE_CODE, type Locale } from "@/i18n/routing";
import { sendOpsAlert } from "@/lib/alerts/send";
import { buildConfirmRedirectUrl } from "@/lib/auth/confirm-url";
import { landingPath, localizedPath } from "@/lib/auth/redirects";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { ORGANIZATION_CREATED_EVENT } from "@/lib/email/schema";
import { sendEmail } from "@/lib/email/send";
import { clientEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** The SQLSTATE codes `create_organization` raises (`supabase/schemas/11_organization_members.sql`). */
const CREATE_ORGANIZATION_CODES = { notAClient: "SM403", alreadyMember: "SM409" } as const;

/**
 * The absolute destination `signUp`, `requestCode`, `resendConfirmation` and
 * `requestPasswordReset` pass as `emailRedirectTo`; the template puts it into `next` and the
 * confirm handler reads the locale from it (spec 0005, AC-13). Sign in and sign up links pass no
 * path (the bare locale root), so `finalizeSignIn` lands every role on its home instead of `/app`
 * (AC-5); only the password reset names its page. Server actions and the invite script.
 */
export function confirmRedirectUrl(locale: Locale, path: "/reset-password" | "" = ""): string {
  return buildConfirmRedirectUrl(clientEnv().NEXT_PUBLIC_APP_URL, LOCALE_CODE[locale], path);
}

export type EnsureOrganizationResult =
  | { ok: true; organizationId: string; created: true }
  | { ok: true; organizationId: string | null; created: false }
  | { ok: false; error: "not_a_client" | "failed" };

/**
 * The only caller of `create_organization` (spec 0005, key invariants): creates the caller's
 * organization, treats `already_member` as success (`created` false, the organization from the
 * refreshed claims, or null with a warning when the hook wrote no claim: a member is never refused
 * over a claim), then refreshes the session so the access token hook writes the organization
 * claim. On a fresh organization it fires the welcome email and the ops alert (spec 0006, AC-1,
 * AC-2); a failed trigger never fails the sign in (AC-15). Runs on the action client in server
 * actions and route handlers, so the refreshed cookies reach the response.
 */
export async function ensureOrganization(
  supabase: Client,
  name: string,
): Promise<EnsureOrganizationResult> {
  const { data: rpcData, error } = await supabase.rpc("create_organization", { name });
  if (error && error.code !== CREATE_ORGANIZATION_CODES.alreadyMember) {
    if (error.code === CREATE_ORGANIZATION_CODES.notAClient) {
      return { ok: false, error: "not_a_client" };
    }
    log.warn("create_organization failed", { code: error.code, reason: error.message });
    return { ok: false, error: "failed" };
  }
  const created = !error;

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    log.warn("session refresh after create_organization failed", { reason: refreshError.message });
    return { ok: false, error: "failed" };
  }

  // The organization claim is written by the access token hook, so it is read from the refreshed
  // token, not from the user's own metadata.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) {
    log.warn("subject missing after create_organization", { created });
    return { ok: false, error: "failed" };
  }

  if (!created) {
    // An existing member whose refreshed token carries no organization claim points at the access
    // token hook, not at the member: let them through and make the gap visible in the log.
    const organizationId = organizationIdFromClaims(claims) ?? null;
    if (!organizationId) {
      log.warn("organization claim missing for an existing member", { userId });
    }
    return { ok: true, organizationId, created: false };
  }

  if (typeof rpcData !== "string" || rpcData === "") {
    log.warn("organization id missing after create_organization", { userId });
    return { ok: false, error: "failed" };
  }
  await notifyOrganizationCreated(userId, rpcData, name);
  return { ok: true, organizationId: rpcData, created: true };
}

/**
 * The two sends of a new organization (spec 0006): the welcome email to the creator and the
 * `client.signed_up` alert. Both keyed on the organization id so a second trigger is a no op;
 * neither result can fail the caller.
 */
async function notifyOrganizationCreated(
  userId: string,
  organizationId: string,
  organizationName: string,
): Promise<void> {
  const email = await sendEmail({
    template: "welcome",
    data: { organizationName },
    recipient: { userId },
    sourceEvent: ORGANIZATION_CREATED_EVENT,
    organizationId,
    idempotencyKey: `welcome/${organizationId}`,
  });
  if (!email.ok) {
    log.warn("welcome email not triggered", { organizationId, reason: email.error });
  }
  const alert = await sendOpsAlert({
    kind: "client.signed_up",
    fields: { organizationName, userId },
    link: "/admin",
    idempotencyKey: `signup/${organizationId}`,
  });
  if (!alert.ok) {
    log.warn("sign up alert not triggered", { organizationId, reason: alert.error });
  }
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
