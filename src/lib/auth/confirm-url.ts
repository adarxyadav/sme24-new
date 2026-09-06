/**
 * The absolute destination an auth email carries as `next` (spec 0005): the app URL plus the
 * locale prefix plus the path. Without a path it is the bare locale root (`https://…/de`), which
 * `nextWithinLocale` rejects, so a sign in link keeps its locale and lands on the role home
 * (AC-5, AC-13). Plain function without imports so the invite script (plain Node, no path
 * aliases) and `src/features/auth/session.ts` build the same string. Pure, runs anywhere.
 */
export function buildConfirmRedirectUrl(
  appUrl: string,
  localeCode: string,
  path: "/reset-password" | "" = "",
): string {
  return `${appUrl.replace(/\/$/, "")}/${localeCode}${path}`;
}
