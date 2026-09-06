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
  readonly phone: string;
  /** Profile URLs for the organization's `sameAs` (LinkedIn first). */
  readonly sameAs: readonly string[];
};

export const SITE: Site = {
  legalName: "SME24 AG",
  street: "Musterstrasse 1",
  postalCode: "8000",
  city: "Zürich",
  email: "service@sme24.ch",
  phone: "+41 44 000 00 00",
  sameAs: ["https://www.linkedin.com/company/sme24"],
};

/**
 * The fields still carrying a placeholder from the build (spec 0009, Follow-up): the owner
 * replaces the values above and empties this list. The site facts test (AC-17) fails while it is
 * not empty, so a placeholder can never reach production unnoticed.
 */
export const SITE_PLACEHOLDERS: readonly (keyof Site)[] = [
  "legalName",
  "street",
  "postalCode",
  "city",
  "phone",
  "sameAs",
];

/** The postal address on one line, as the structured data and the email footer show it. Pure. */
export function postalAddress(site: Site = SITE): string {
  return `${site.street}, ${site.postalCode} ${site.city}`;
}
