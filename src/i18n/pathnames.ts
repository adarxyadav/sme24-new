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
  "/how-it-works": { "de-CH": "/so-funktionierts", "en-CH": "/how-it-works" },
  "/expert-network": { "de-CH": "/expertennetzwerk", "en-CH": "/expert-network" },
  "/expert-network/directory": {
    "de-CH": "/expertennetzwerk/verzeichnis",
    "en-CH": "/expert-network/directory",
  },
  "/about": { "de-CH": "/ueber-uns", "en-CH": "/about" },
  "/contact": { "de-CH": "/kontakt", "en-CH": "/contact" },
  "/privacy": { "de-CH": "/datenschutz", "en-CH": "/privacy" },
  "/terms": { "de-CH": "/agb", "en-CH": "/terms" },
  "/imprint": { "de-CH": "/impressum", "en-CH": "/imprint" },
  "/cookies": { "de-CH": "/cookies", "en-CH": "/cookies" },
  "/sign-in": "/sign-in",
  "/sign-up": "/sign-up",
  "/verify-code": "/verify-code",
  "/forgot-password": "/forgot-password",
  "/reset-password": "/reset-password",
  "/forbidden": "/forbidden",
  "/app": "/app",
  "/app/onboarding": "/app/onboarding",
  "/app/checkout": { "de-CH": "/app/kasse", "en-CH": "/app/checkout" },
  "/app/orders": { "de-CH": "/app/bestellungen", "en-CH": "/app/orders" },
  "/app/orders/[id]": { "de-CH": "/app/bestellungen/[id]", "en-CH": "/app/orders/[id]" },
  "/expert": "/expert",
  "/expert/onboarding": "/expert/onboarding",
  "/expert/profile": { "de-CH": "/expert/profil", "en-CH": "/expert/profile" },
  "/expert/clients/[organizationId]": {
    "de-CH": "/expert/kunden/[organizationId]",
    "en-CH": "/expert/clients/[organizationId]",
  },
  "/admin": "/admin",
  "/admin/design": "/admin/design",
  "/admin/emails": "/admin/emails",
  "/admin/emails/[id]": "/admin/emails/[id]",
  "/admin/enquiries": "/admin/enquiries",
  "/admin/enquiries/[id]": "/admin/enquiries/[id]",
  "/admin/orders": "/admin/orders",
  "/admin/companies": "/admin/companies",
  "/admin/companies/[companyId]": "/admin/companies/[companyId]",
  "/admin/experts": "/admin/experts",
  "/admin/experts/new": "/admin/experts/new",
  "/admin/experts/[expertId]": "/admin/experts/[expertId]",
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
export const MARKETING_ROUTES: readonly StaticPathname[] = [
  "/",
  "/how-it-works",
  "/expert-network",
  "/expert-network/directory",
  "/pricing",
  "/about",
  "/contact",
  // The four legal pages (spec 0015, AC-6). They joined this list only once their pages existed:
  // a route here is a URL in the sitemap, and a sitemap that points at a 404 is worse than one
  // that is a page short.
  "/privacy",
  "/terms",
  "/imprint",
  "/cookies",
];
