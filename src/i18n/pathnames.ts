/**
 * The typed route map (spec 0004, AC-13): one entry per route, so `Link`, `redirect`, `useRouter`
 * and `getPathname` are typed and an unknown href fails `pnpm typecheck`. Marketing routes may
 * localise the German slug (`"/pricing": { "de-CH": "/preise", "en-CH": "/pricing" }`); the
 * signed in areas, sign in and forbidden stay identical in both languages. Dynamic routes use
 * next-intl templates (`"/app/companies/[id]"`) and a link with parameters is an object. Pure data.
 */
export const PATHNAMES = {
  "/": "/",
  "/sign-in": "/sign-in",
  "/forbidden": "/forbidden",
  "/app": "/app",
  "/expert": "/expert",
  "/admin": "/admin",
  "/admin/design": "/admin/design",
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
 * The public routes the sitemap and the alternates helper iterate. Feature 13 adds its pages and
 * their German slugs here after adding them to `PATHNAMES`. Static routes only: a template route
 * (`/foo/[id]`) has no single URL, so listing one fails `pnpm typecheck`.
 */
export const MARKETING_ROUTES: readonly StaticPathname[] = ["/"];
