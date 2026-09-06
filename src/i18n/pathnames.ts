/**
 * The typed route map (spec 0004, AC-13): one entry per route, so `Link`, `redirect`, `useRouter`
 * and `getPathname` are typed and an unknown href fails `pnpm typecheck`. Marketing routes
 * localise the German slug (`"/contact": { "de-CH": "/kontakt", "en-CH": "/contact" }`); the
 * signed in areas, the auth pages (spec 0005) and forbidden stay identical in both languages. Dynamic routes use
 * next-intl templates (`"/app/companies/[id]"`) and a link with parameters is an object. Pure data.
 */
export const PATHNAMES = {
  "/": "/",
  "/pricing": { "de-CH": "/preise", "en-CH": "/pricing" },
  "/about": { "de-CH": "/ueber-uns", "en-CH": "/about" },
  "/contact": { "de-CH": "/kontakt", "en-CH": "/contact" },
  "/sign-in": "/sign-in",
  "/sign-up": "/sign-up",
  "/verify-code": "/verify-code",
  "/forgot-password": "/forgot-password",
  "/reset-password": "/reset-password",
  "/forbidden": "/forbidden",
  "/app": "/app",
  "/app/onboarding": "/app/onboarding",
  "/expert": "/expert",
  "/admin": "/admin",
  "/admin/design": "/admin/design",
  "/admin/emails": "/admin/emails",
  "/admin/emails/[id]": "/admin/emails/[id]",
  "/admin/enquiries": "/admin/enquiries",
  "/admin/enquiries/[id]": "/admin/enquiries/[id]",
} as const;

/** A route key of the typed map: what `Link` and `redirect` accept as `href`. */
export type Pathname = keyof typeof PATHNAMES;

/** A route without parameters: the only kind `getPathname` can resolve without `params`. */
export type StaticPathname = Pathname extends infer P
  ? P extends `${string}[${string}`
    ? never
    : P
  : never;

/**
 * The public routes the sitemap and the alternates helper iterate (spec 0009, AC-4): every
 * marketing page, with its German slug resolved through `PATHNAMES`. Static routes only: a
 * template route (`/foo/[id]`) has no single URL, so listing one fails `pnpm typecheck`.
 */
export const MARKETING_ROUTES: readonly StaticPathname[] = ["/", "/pricing", "/about", "/contact"];
