import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { finalizeSignIn } from "@/features/auth/session";
import { localeFromCode } from "@/i18n/routing";
import { localizedPath, nextWithinLocale, roleHomePath } from "@/lib/auth/redirects";
import { roleFromClaims } from "@/lib/auth/roles";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";

/**
 * Where Google and Microsoft return (spec 0005, AC-5): exchanges the PKCE code for a session on
 * the action client (the verifier cookie was set by `signInWithProvider`) and lands the user
 * through `finalizeSignIn` (`next` when requested, else the role home). A failed exchange, including a link opened in another browser, goes to
 * sign in with the provider error. Route handler, anonymous.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  // `signInWithProvider` sends the locale code on its own parameter and `next` only when the
  // user asked for one; an unknown or missing code falls back to the default locale.
  const locale = localeFromCode(params.get("locale"));
  const next = nextWithinLocale(params.get("next"), locale);
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const providerError = () => redirectTo(`${localizedPath(locale, "/sign-in")}?error=provider`);

  if (!code) {
    log.info("provider callback without a code", { error: params.get("error") ?? "" });
    return providerError();
  }

  const supabase = await createActionClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    log.info("provider code exchange failed", { reason: error.code ?? error.message });
    return providerError();
  }

  try {
    return redirectTo(await finalizeSignIn(supabase, locale, next));
  } catch (cause) {
    Sentry.captureException(cause, { tags: { source: "auth-callback" } });
    const { data } = await supabase.auth.getClaims();
    const role = roleFromClaims(data?.claims);
    return redirectTo(
      role === "client" ? localizedPath(locale, "/app/onboarding") : roleHomePath(role, locale),
    );
  }
}
