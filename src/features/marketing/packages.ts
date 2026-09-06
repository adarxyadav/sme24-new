/**
 * The four packages of the pricing page (spec 0009, AC-6, second amendment of 2026-09-06): one
 * entry per package, in display order by price. Names, promises, best for lines, delivery lines,
 * included points, outputs and outcomes live in the catalogs under `marketing.packages.<key>.*`;
 * only the price, the order and the point keys live here, so a price change is a one line edit.
 * Feature 11 promotes this list into the `packages` table and keeps the two equal with a test.
 * Pure data.
 */

export const PACKAGE_KEYS = ["compliance", "sms", "culture", "retainer"] as const;
export type PackageKey = (typeof PACKAGE_KEYS)[number];

export type Package = {
  readonly key: PackageKey;
  /** The fixed price in CHF excluding VAT, or null for the implementation partner (on demand). */
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

export const PACKAGES: readonly Package[] = [
  {
    key: "culture",
    priceChf: 2_000,
    sortOrder: 1,
    included: ["categories", "levels", "report"],
  },
  {
    key: "sms",
    priceChf: 5_000,
    sortOrder: 2,
    included: ["cultureSnapshot", "iso", "interviews"],
  },
  {
    key: "compliance",
    priceChf: 10_000,
    sortOrder: 3,
    included: ["systemSnapshot", "standards", "roadmap"],
  },
  {
    key: "retainer",
    priceChf: null,
    sortOrder: 4,
    included: ["implementation", "pmo", "coaching"],
  },
];

/** The packages in display order. Pure. */
export function sortedPackages(): readonly Package[] {
  return [...PACKAGES].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The three fixed price packages, in order; the implementation partner is sold by conversation. Pure. */
export function fixedPricePackages(): readonly Package[] {
  return sortedPackages().filter((entry) => entry.key !== "retainer");
}
