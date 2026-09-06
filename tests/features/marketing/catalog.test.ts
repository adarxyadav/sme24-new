import { describe, expect, it } from "vitest";
import {
  fixedPricePackages,
  PACKAGE_KEYS,
  PACKAGES,
  sortedPackages,
  VAT_RATE,
} from "@/features/marketing/packages";
import { postalAddress, SITE, SITE_PLACEHOLDERS } from "@/features/marketing/site";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

/**
 * The catalog files of the public site (spec 0009, AC-6 as amended on 2026-09-06, AC-17): every
 * package has its messages in both languages, the order by price and the VAT note are fixed, the
 * site facts are never empty (the phone and the profiles may be absent), and no field is marked
 * as a placeholder.
 */
type Catalog = typeof de;

function packageMessages(catalog: Catalog, key: string) {
  return (
    catalog.marketing.packages as Record<
      string,
      {
        name: string;
        promise: string;
        bestFor: string;
        delivery: string;
        output: string;
        outcome: string;
        included: Record<string, string>;
      }
    >
  )[key];
}

describe("PACKAGES and the catalogs (AC-6)", () => {
  it("lists the four packages by price ascending with the implementation partner last", () => {
    expect(sortedPackages().map((entry) => entry.key)).toEqual([
      "culture",
      "sms",
      "compliance",
      "retainer",
    ]);
    expect(sortedPackages().map((entry) => entry.priceChf)).toEqual([2000, 5000, 10000, null]);
    expect([...PACKAGE_KEYS].sort()).toEqual(PACKAGES.map((entry) => entry.key).sort());
    expect(fixedPricePackages().map((entry) => entry.key)).toEqual([
      "culture",
      "sms",
      "compliance",
    ]);
  });

  it("carries every card string and every included point in both catalogs", () => {
    for (const entry of PACKAGES) {
      for (const catalog of [de, en]) {
        const messages = packageMessages(catalog, entry.key);
        for (const field of [
          "name",
          "promise",
          "bestFor",
          "delivery",
          "output",
          "outcome",
        ] as const) {
          expect(messages?.[field], `${entry.key}.${field}`).toBeTruthy();
        }
        expect(entry.included, `${entry.key}.included`).toHaveLength(3);
        for (const point of entry.included) {
          expect(messages?.included[point], `${entry.key}.included.${point}`).toBeTruthy();
        }
      }
    }
  });

  it("carries no price on the implementation partner and the Swiss VAT rate for the note", () => {
    expect(PACKAGES.find((entry) => entry.key === "retainer")?.priceChf).toBeNull();
    expect(VAT_RATE).toBe(0.081);
    expect(de.marketing.pricing.vatNote).toBe("exkl. 8.1% MWST");
    expect(en.marketing.pricing.vatNote).toBe("excl. 8.1% VAT");
    expect(de.marketing.pricing.onDemand).toBe("Auf Anfrage");
    expect(en.marketing.pricing.onDemand).toBe("On demand");
  });

  it("carries a positive price on every fixed price package", () => {
    for (const entry of fixedPricePackages()) {
      expect(entry.priceChf, `${entry.key} still carries the placeholder price`).toBeGreaterThan(0);
    }
  });
});

describe("SITE (AC-17)", () => {
  it("has no empty field (the phone and the profiles may be absent) and joins the address on one line", () => {
    for (const [key, value] of Object.entries(SITE)) {
      if (typeof value === "string") expect(value.trim(), key).not.toBe("");
      else if (key === "phone") expect(value).toBeNull();
      else expect(Array.isArray(value), key).toBe(true);
    }
    expect(SITE.sameAs.every((url) => url.startsWith("https://"))).toBe(true);
    expect(
      postalAddress({ ...SITE, street: "Bahnhofstrasse 1", postalCode: "8001", city: "Zürich" }),
    ).toBe("Bahnhofstrasse 1, 8001 Zürich");
  });

  it("carries the owner's facts, not the build's placeholders", () => {
    expect(
      SITE_PLACEHOLDERS,
      "fields still marked as placeholders in src/features/marketing/site.ts",
    ).toEqual([]);
  });
});
