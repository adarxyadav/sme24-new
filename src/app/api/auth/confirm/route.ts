import * as Sentry from "@sentry/nextjs";
import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { finalizeSignIn } from "@/features/auth/session";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/routing";
import { localeOfPath, localizedPath, roleHomePath } from "@/lib/auth/redirects";
import { roleFromClaims } from "@/lib/auth/roles";
import { clientEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";

/** The link types the templates build (spec 0005, value sourcing "email templates"). */
const LINK_TYPES = ["signup", "magiclink", "email", "recovery", "invite"] as const;
type LinkType = (typeof LINK_TYPES)[number];

function isLinkType(value: string | null): value is LinkType {
  return value !== null && (LINK_TYPES as readonly string[]).includes(value);
}

/**
 * Validates `next` (the absolute destination the template copied from `emailRedirectTo`): it must
 * share the app's origin and carry a locale prefix. Otherwise the default locale and no `next`.
 */
function resolveNext(raw: string | null): { locale: Locale; next: string | null } {
  if (!raw) return { locale: DEFAULT_LOCALE, next: null };
  try {
    const url = new URL(raw);
    const app = new URL(clientEnv().NEXT_PUBLIC_APP_URL);
    const locale = localeOfPath(url.pathname);
    if (url.origin !== app.origin || !locale) return { locale: DEFAULT_LOCALE, next: null };
    return { locale, next: `${url.pathname}${url.search}` };
  } catch {
    return { locale: DEFAULT_LOCALE, next: null };
  }
}

/**
 * Verifies an emailed link by its token hash and redirects (spec 0005, AC-1, AC-3, AC-6, AC-10,
 * AC-12): sign up, magic link and email tokens finish through `finalizeSignIn`, recovery and invite
 * tokens open the set password page. Never renders, never answers 500 once a token was accepted:
 * a later failure sends a client to onboarding and staff to their role home. The token hash is the
 * credential, so the link works in any browser. Route handler, anonymous.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const { locale, next } = resolveNext(params.get("next"));
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const expired = (failedType: string) =>
    redirectTo(`${localizedPath(locale, "/sign-in")}?error=link_expired&type=${failedType}`);

  if (!tokenHash || !isLinkType(type)) return expired(type ?? "signup");

  const supabase = await createActionClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type satisfies EmailOtpType,
  });
  if (error) {
    log.info("email link rejected", { type, reason: error.code ?? error.message });
    return expired(type);
  }

  if (type === "recovery" || type === "invite") {
    return redirectTo(next ?? localizedPath(locale, "/reset-password"));
  }

  try {
    return redirectTo(await finalizeSignIn(supabase, locale, next));
  } catch (cause) {
    Sentry.captureException(cause, { tags: { source: "auth-confirm" } });
    const { data } = await supabase.auth.getClaims();
    const role = roleFromClaims(data?.claims);
    return redirectTo(
      role === "client" ? localizedPath(locale, "/app/onboarding") : roleHomePath(role, locale),
    );
  }
}
