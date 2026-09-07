/**
 * The seller facts printed on every invoice (spec 0011, AC-17) and the guard that keeps a
 * placeholder off a real document. Pure: no environment, no I/O, so the guard test runs anywhere.
 * `seller()` in `seller.ts` reads the configured values; this file holds the shape and the rule.
 */

export type Seller = {
  readonly name: string;
  readonly address: string;
  /** The Swiss UID with its MWST suffix, e.g. `CHE-101.654.423 MWST`. */
  readonly uid: string;
  /** The IBAN the QR bill pays into. */
  readonly iban: string;
};

/** The order the guard reports fields in. */
export const SELLER_FIELDS = ["name", "address", "uid", "iban"] as const;

/**
 * The values used while the real facts are not configured. They are deliberately obvious rather
 * than plausible, so a placeholder invoice can never be mistaken for a real one, and the guard
 * below keeps them out of production.
 */
export const SELLER_PLACEHOLDERS: Seller = {
  name: "PLACEHOLDER Seller AG",
  address: "PLACEHOLDER street 1, 0000 PLACEHOLDER",
  uid: "CHE-000.000.000 MWST",
  iban: "CH0000000000000000000",
};

/** True when the value is a placeholder rather than a configured fact. Pure. */
export function isSellerPlaceholder(field: keyof Seller, value: string): boolean {
  return value.trim() === "" || value.trim() === SELLER_PLACEHOLDERS[field];
}

/**
 * The fields still carrying a placeholder, in order. Empty means every seller fact is configured.
 * The guard test (AC-17) fails while this is not empty, mirroring `SITE_PLACEHOLDERS`. Pure.
 */
export function sellerPlaceholders(seller: Seller): readonly (keyof Seller)[] {
  return SELLER_FIELDS.filter((field) => isSellerPlaceholder(field, seller[field]));
}
