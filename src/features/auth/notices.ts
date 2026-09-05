import type { AuthErrorKey } from "./errors";

/**
 * What the sign in page shows on arrival (spec 0005, AC-12), read from the query string the
 * handlers and actions redirect with. Plain data shared by the server page and the client form.
 */

/** The failed link types the confirm handler reports (value sourcing `link_expired`). */
export const LINK_EXPIRED_TYPES = ["signup", "magiclink", "email", "recovery", "invite"] as const;
export type LinkExpiredType = (typeof LINK_EXPIRED_TYPES)[number];

export type SignInNotice =
  | { readonly kind: "linkExpired"; readonly type: LinkExpiredType }
  | { readonly kind: "error"; readonly error: AuthErrorKey };

/** True for one of the link types a template can produce. Pure. */
export function isLinkExpiredType(value: unknown): value is LinkExpiredType {
  return typeof value === "string" && (LINK_EXPIRED_TYPES as readonly string[]).includes(value);
}
