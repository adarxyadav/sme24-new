import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { AREA_ROLE, areaFromPathname, roleFromClaims } from "@/lib/auth/roles";
import { createProxyClient } from "@/lib/supabase/proxy";

/**
 * Request proxy (spec 0001). Runs on the Node runtime. Order:
 * 1. next-intl: `/` -> `/de`, locale prefix always, locale cookie on explicit switch.
 * 2. Supabase: refresh the session cookies on the response we are about to return.
 * 3. Area gate: `/app` needs client, `/expert` needs expert, `/admin` needs ops, read from the
 *    access token claims. The proxy only gates areas; RLS remains the real boundary.
 */
const handleI18n = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const response = handleI18n(request);

  // A redirect or rewrite from next-intl (for example `/` -> `/de`) needs no auth work.
  if (response.headers.has("location")) return response;

  const supabase = createProxyClient(request, response);
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname } = request.nextUrl;
  const area = areaFromPathname(pathname);
  if (!area) return response;

  const locale = pathname.split("/")[1] ?? routing.defaultLocale;

  if (!claims) {
    const signInUrl = new URL(`/${locale}/sign-in`, request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (roleFromClaims(claims) !== AREA_ROLE[area]) {
    return NextResponse.redirect(new URL(`/${locale}/forbidden`, request.url));
  }

  return response;
}

export const config = {
  // Skip machine endpoints, Next internals, Vercel internals and any path with a file extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
