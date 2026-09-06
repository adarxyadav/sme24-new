import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chfToRappen } from "@/features/checkout/money";
import { PACKAGES, VAT_RATE } from "@/features/marketing/packages";

/**
 * The pricing page and the checkout must never disagree on a price (spec 0011, AC-14). The
 * `packages` table is seeded by a data migration from PACKAGES, so this test reads that migration
 * and asserts the rows it writes equal the catalogue on key, price and sort order. Reading the
 * migration rather than the live database keeps the test pure, so it runs in CI without a stack.
 */

const SEED_MIGRATION = "20260906204219_packages_seed.sql";

type SeedRow = { key: string; priceRappen: number | null; sortOrder: number };

/** Parses the seeded package rows out of the data migration. */
function seededPackages(): SeedRow[] {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations", SEED_MIGRATION), "utf8");
  const values = /\(\s*'([a-z]+)',\s*(null|\d+),\s*([\d.]+),\s*(\d+),\s*(true|false)\s*\)/g;
  const rows: SeedRow[] = [];
  for (const match of sql.matchAll(values)) {
    rows.push({
      key: match[1] as string,
      priceRappen: match[2] === "null" ? null : Number(match[2]),
      sortOrder: Number(match[4]),
    });
  }
  return rows;
}

describe("packages table matches the marketing catalogue (spec 0011 AC-14)", () => {
  it("seeds exactly the catalogue's keys", () => {
    const seeded = seededPackages()
      .map((row) => row.key)
      .sort();
    const catalogue = PACKAGES.map((entry) => entry.key).sort();
    expect(seeded).toEqual(catalogue);
  });

  it("seeds every price as the catalogue's CHF price in whole Rappen", () => {
    const seeded = new Map(seededPackages().map((row) => [row.key, row]));
    for (const entry of PACKAGES) {
      const row = seeded.get(entry.key);
      expect(row, `no seeded row for ${entry.key}`).toBeDefined();
      const expected = entry.priceChf === null ? null : chfToRappen(entry.priceChf);
      expect(row?.priceRappen, `price of ${entry.key}`).toBe(expected);
    }
  });

  it("seeds every sort order as the catalogue's", () => {
    const seeded = new Map(seededPackages().map((row) => [row.key, row]));
    for (const entry of PACKAGES) {
      expect(seeded.get(entry.key)?.sortOrder, `sort order of ${entry.key}`).toBe(entry.sortOrder);
    }
  });

  it("seeds the catalogue's VAT rate on every row", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations", SEED_MIGRATION), "utf8");
    const rates = [...sql.matchAll(/'[a-z]+',\s*(?:null|\d+),\s*([\d.]+),/g)].map((m) =>
      Number(m[1]),
    );
    expect(rates.length).toBe(PACKAGES.length);
    for (const rate of rates) expect(rate).toBe(VAT_RATE);
  });

  it("leaves exactly the unpurchasable packages without a price", () => {
    const withoutPrice = seededPackages()
      .filter((row) => row.priceRappen === null)
      .map((row) => row.key);
    const catalogueWithoutPrice = PACKAGES.filter((entry) => entry.priceChf === null).map(
      (entry) => entry.key,
    );
    expect(withoutPrice.sort()).toEqual(catalogueWithoutPrice.sort());
  });
});
