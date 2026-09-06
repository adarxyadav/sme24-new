/**
 * The four packages of the pricing page (spec 0009, AC-6): one entry per package, in display
 * order. Names, promises and included points live in the catalogs under
 * `marketing.packages.<key>.*`; only the price and the order live here, so a price change is a
 * one line edit. Feature 11 promotes this list into the `packages` table and keeps the two equal
 * with a test. Pure data.
 */

export const PACKAGE_KEYS = ["compliance", "sms", "culture", "retainer"] as const;
export type PackageKey = (typeof PACKAGE_KEYS)[number];

export type Package = {
  readonly key: PackageKey;
  /** The fixed price in CHF excluding VAT, or null for the retainer (price on request). */
  readonly priceChf: number | null;
  readonly sortOrder: number;
  /** The keys of the included points under `marketing.packages.<key>.included.<point>`. */
  readonly included: readonly string[];
};

/**
 * Swiss VAT, for the "excl. 8.1% VAT" note only (AC-6). Feature 11 computes the tax at checkout;
 * no marketing page multiplies with it.
 */
export const VAT_RATE = 0.081;

/**
 * Placeholder prices until the owner gives the three fixed prices (spec 0009, Follow-up): zero is
 * never a real price, so the catalog test (AC-6) fails until each is replaced with a positive
 * number, and the pages cannot go live half real.
 */
const PRICE_PLACEHOLDER = 0;

export const PACKAGES: readonly Package[] = [
  {
    key: "compliance",
    priceChf: PRICE_PLACEHOLDER,
    sortOrder: 1,
    included: ["gapReview", "onSite", "report", "actions"],
  },
  {
    key: "sms",
    priceChf: PRICE_PLACEHOLDER,
    sortOrder: 2,
    included: ["systemReview", "onSite", "report", "actions"],
  },
  {
    key: "culture",
    priceChf: PRICE_PLACEHOLDER,
    sortOrder: 3,
    included: ["interviews", "onSite", "report", "actions"],
  },
  {
    key: "retainer",
    priceChf: null,
    sortOrder: 4,
    included: ["namedExpert", "monthlyVisit", "hotline", "tracking"],
  },
];

/** The packages in display order. Pure. */
export function sortedPackages(): readonly Package[] {
  return [...PACKAGES].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The three fixed price packages, in order; the retainer is sold by conversation. Pure. */
export function fixedPricePackages(): readonly Package[] {
  return sortedPackages().filter((entry) => entry.key !== "retainer");
}
