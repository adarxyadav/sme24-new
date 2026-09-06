import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import type { StaticPathname } from "@/i18n/pathnames";
import { LOCALES, localeFromCode, routing } from "@/i18n/routing";
import { localizedPath, roleHomePath } from "@/lib/auth/redirects";
import {
  AREA_ROLE,
  areaFromPathname,
  organizationIdFromClaims,
  roleFromClaims,
} from "@/lib/auth/roles";
import { createProxyClient } from "@/lib/supabase/proxy";

/**
 * Request proxy (spec 0001, spec 0005, spec 0009). Runs on the Node runtime. Order:
 * 0. The generated social card routes pass through under their internal locale segment.
 * 1. next-intl: `/` -> `/en`, locale prefix always, locale cookie on explicit switch.
 * 2. Supabase: refresh the session cookies on the response we are about to return.
 * 3. A signed in user on a sign in, sign up, code or forgot password page goes to their role home
 *    (`/reset-password` is left alone: a recovery session is signed in on purpose).
 * 4. Area gate: `/app` needs client, `/expert` needs expert, `/admin` needs ops, read from the
 *    access token claims. The proxy only gates areas; RLS remains the real boundary.
 * 5. Onboarding: a client without an organization claim may open only `/app/onboarding`; a client
 *    with one is sent from `/app/onboarding` to `/app`.
 */
const handleI18n = createIntlMiddleware(routing);

/**
 * The generated social card routes (spec 0009, AC-2): Next builds their URLs from the internal
 * locale segment (`/en-CH/pricing/opengraph-image-<hash>/card`), which next-intl would otherwise
 * treat as an unprefixed path and redirect into a 404. Only these image routes pass through
 * under the full tag; every other `/de-CH/...` path still lands on the not found page.
 */
const METADATA_IMAGE_PATH = new RegExp(
  `^/(?:${LOCALES.join("|")})/(?:.+/)?(?:opengraph|twitter)-image[^/]*(?:/.*)?$`,
);

/** The auth pages a signed in user is bounced from (spec 0005, AC-8). */
const AUTH_PAGES: readonly StaticPathname[] = [
  "/sign-in",
  "/sign-up",
  "/verify-code",
  "/forgot-password",
];

/**
 * A redirect that keeps the cookies Supabase refreshed on the page response: with refresh token
 * rotation, dropping them would leave the browser holding a token that was just used up.
 */
function redirectKeepingCookies(path: string, request: NextRequest, response: NextResponse) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export async function proxy(request: NextRequest) {
  if (METADATA_IMAGE_PATH.test(request.nextUrl.pathname)) return NextResponse.next();

  const response = handleI18n(request);

  // A redirect or rewrite from next-intl (for example `/` -> `/en`) needs no auth work.
  if (response.headers.has("location")) return response;

  const supabase = createProxyClient(request, response);
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname } = request.nextUrl;
  // The prefix is the short code (spec 0004), so it maps straight to the locale.
  const locale = localeFromCode(pathname.split("/")[1]);
  const role = roleFromClaims(claims);
  const redirectTo = (path: string) => redirectKeepingCookies(path, request, response);

  if (claims && AUTH_PAGES.some((page) => pathname === localizedPath(locale, page))) {
    return redirectTo(roleHomePath(role, locale));
  }

  const area = areaFromPathname(pathname);
  if (!area) return response;

  if (!claims) {
    const signInUrl = new URL(localizedPath(locale, "/sign-in"), request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (role !== AREA_ROLE[area]) {
    return redirectTo(localizedPath(locale, "/forbidden"));
  }

  if (area === "app") {
    const onboarding = localizedPath(locale, "/app/onboarding");
    const onOnboarding = pathname === onboarding || pathname.startsWith(`${onboarding}/`);
    const hasOrganization = organizationIdFromClaims(claims) !== null;
    if (!hasOrganization && !onOnboarding) return redirectTo(onboarding);
    if (hasOrganization && onOnboarding) return redirectTo(localizedPath(locale, "/app"));
  }

  return response;
}

export const config = {
  // Skip machine endpoints, Next internals, Vercel internals and any path with a file extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
