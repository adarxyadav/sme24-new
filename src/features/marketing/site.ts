/**
 * The contact facts of the public site (spec 0009, AC-8): shown on the contact page with
 * `address` markup, in the organization structured data and in the rate limit message. One
 * place, so a change is a one line edit. Pure data.
 */
export type Site = {
  readonly legalName: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly email: string;
  /** The phone number in international form, or null while the company has none (the page omits the row). */
  readonly phone: string | null;
  /** Profile URLs for the organization's `sameAs` (LinkedIn first); empty while none exists (the key is omitted). */
  readonly sameAs: readonly string[];
};

export const SITE: Site = {
  legalName: "IC Hotz GmbH",
  street: "Obermühle 5",
  postalCode: "6340",
  city: "Baar",
  email: "service@sme24.ch",
  phone: null,
  sameAs: [],
};

/**
 * The fields still carrying a placeholder from the build (spec 0009, Follow-up): empty since the
 * owner's facts of 2026-09-06. A future placeholder goes on this list, and the site facts test
 * (AC-17) fails while it is not empty, so a placeholder can never reach production unnoticed.
 */
export const SITE_PLACEHOLDERS: readonly (keyof Site)[] = [];

/** The postal address on one line, as the structured data and the email footer show it. Pure. */
export function postalAddress(site: Site = SITE): string {
  return `${site.street}, ${site.postalCode} ${site.city}`;
}
