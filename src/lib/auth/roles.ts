/**
 * The three user types (spec 0001). The role lives in `app_metadata.role`, is copied into the
 * access token by the custom access token hook, and the request proxy reads it from the claims.
 *
 * Why not a top level `role` claim: Supabase and PostgREST already use the JWT `role` claim for
 * the Postgres role (`authenticated`). Overwriting it would break every query, so the app role
 * stays under `app_metadata`, which is also where authorization claims belong.
 */
export const APP_ROLES = ["client", "expert", "ops"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Path segment (after the locale) of each protected area and the role it requires. */
export const AREA_ROLE: Record<"app" | "expert" | "admin", AppRole> = {
  app: "client",
  expert: "expert",
  admin: "ops",
};

export type Area = keyof typeof AREA_ROLE;

export const ROLE_HOME: Record<AppRole, `/${Area}`> = {
  client: "/app",
  expert: "/expert",
  ops: "/admin",
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** Reads the app role from decoded JWT claims, or null when absent or unknown. */
export function roleFromClaims(claims: unknown): AppRole | null {
  if (!claims || typeof claims !== "object") return null;
  const appMetadata = (claims as { app_metadata?: unknown }).app_metadata;
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const role = (appMetadata as { role?: unknown }).role;
  return isAppRole(role) ? role : null;
}

/** Matches `/de/admin/...` style paths and returns the protected area, or null for public paths. */
export function areaFromPathname(pathname: string): Area | null {
  const match = pathname.match(/^\/[a-z]{2}(?:\/(app|expert|admin))(?:\/|$)/);
  const area = match?.[1];
  return area && area in AREA_ROLE ? (area as Area) : null;
}
