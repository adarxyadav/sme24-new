// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_PACKS } from "@/features/directory/catalogue";
import { VAT_RATE } from "@/features/marketing/packages";

/**
 * The credit pack card and the checkout must never disagree on a price (spec 0018, AC-6). The
 * `packages` rows of the directory are seeded by their own data migration, so this test reads
 * that migration by name and asserts its rows equal `CREDIT_PACKS` on key, credits, price and
 * sort order. The spec 0011 `packages.test.ts` reads its own seed migration and is untouched.
 */

const SEED_MIGRATION = "20260912032600_directory_credit_pack_seed.sql";

type SeedRow = {
  key: string;
  kind: string;
  credits: number;
  priceRappen: number;
  vatRate: number;
  sortOrder: number;
};

/** Parses the seeded credit pack rows out of the data migration. */
function seededPacks(): SeedRow[] {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations", SEED_MIGRATION), "utf8");
  const values =
    /\(\s*'([a-z0-9_]+)',\s*'([a-z_]+)',\s*(\d+),\s*(\d+),\s*([\d.]+),\s*(\d+),\s*(true|false)\s*\)/g;
  return [...sql.matchAll(values)].map((match) => ({
    key: match[1] as string,
    kind: match[2] as string,
    credits: Number(match[3]),
    priceRappen: Number(match[4]),
    vatRate: Number(match[5]),
    sortOrder: Number(match[6]),
  }));
}

describe("the credit pack seed matches the directory catalogue (spec 0018, AC-6)", () => {
  it("seeds exactly the catalogue's packs, all of the directory_credits kind", () => {
    const seeded = seededPacks();
    expect(seeded.map((row) => row.key).sort()).toEqual(
      CREDIT_PACKS.map((pack) => pack.key).sort(),
    );
    for (const row of seeded) expect(row.kind).toBe("directory_credits");
  });

  it("seeds every pack's credits, price and sort order as the catalogue's", () => {
    const seeded = new Map(seededPacks().map((row) => [row.key, row]));
    for (const pack of CREDIT_PACKS) {
      const row = seeded.get(pack.key);
      expect(row, `no seeded row for ${pack.key}`).toBeDefined();
      expect(row?.credits, `credits of ${pack.key}`).toBe(pack.credits);
      expect(row?.priceRappen, `price of ${pack.key}`).toBe(pack.priceRappen);
      expect(row?.sortOrder, `sort order of ${pack.key}`).toBe(pack.sortOrder);
      expect(row?.vatRate, `vat rate of ${pack.key}`).toBe(VAT_RATE);
    }
  });
});
