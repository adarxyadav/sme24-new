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
 * The catalog files of the public site (spec 0009, AC-6, AC-17): every package has its messages
 * in both languages, the order and the VAT note are fixed, the site facts are never empty, and
 * the owner's facts (the three prices, the address, the phone, the profiles) are no longer the
 * build's placeholders. The last two tests stay red until the owner replaces them (Follow-up).
 */
type Catalog = typeof de;

function packageMessages(catalog: Catalog, key: string) {
  return (
    catalog.marketing.packages as Record<
      string,
      { name: string; promise: string; included: Record<string, string> }
    >
  )[key];
}

describe("PACKAGES and the catalogs (AC-6)", () => {
  it("lists the four packages in the fixed order with the retainer last", () => {
    expect(sortedPackages().map((entry) => entry.key)).toEqual([
      "compliance",
      "sms",
      "culture",
      "retainer",
    ]);
    expect([...PACKAGE_KEYS]).toEqual(PACKAGES.map((entry) => entry.key));
    expect(fixedPricePackages().map((entry) => entry.key)).toEqual([
      "compliance",
      "sms",
      "culture",
    ]);
  });

  it("carries a name, a promise and every included point in both catalogs", () => {
    for (const entry of PACKAGES) {
      for (const catalog of [de, en]) {
        const messages = packageMessages(catalog, entry.key);
        expect(messages?.name, `${entry.key}.name`).toBeTruthy();
        expect(messages?.promise, `${entry.key}.promise`).toBeTruthy();
        for (const point of entry.included) {
          expect(messages?.included[point], `${entry.key}.included.${point}`).toBeTruthy();
        }
      }
    }
  });

  it("carries no price on the retainer and the Swiss VAT rate for the note", () => {
    expect(PACKAGES.find((entry) => entry.key === "retainer")?.priceChf).toBeNull();
    expect(VAT_RATE).toBe(0.081);
    expect(de.marketing.pricing.vatNote).toBe("exkl. 8.1% MWST");
    expect(en.marketing.pricing.vatNote).toBe("excl. 8.1% VAT");
    expect(de.marketing.pricing.priceOnRequest).toBe("Preis auf Anfrage");
    expect(en.marketing.pricing.priceOnRequest).toBe("Price on request");
  });

  it("carries a positive price on every fixed price package (red until the owner replaces the placeholders)", () => {
    for (const entry of fixedPricePackages()) {
      expect(entry.priceChf, `${entry.key} still carries the placeholder price`).toBeGreaterThan(0);
    }
  });
});

describe("SITE (AC-17)", () => {
  it("has no empty field and joins the address on one line", () => {
    for (const [key, value] of Object.entries(SITE)) {
      if (typeof value === "string") expect(value.trim(), key).not.toBe("");
      else expect(value.length, key).toBeGreaterThan(0);
    }
    expect(
      postalAddress({ ...SITE, street: "Bahnhofstrasse 1", postalCode: "8001", city: "Zürich" }),
    ).toBe("Bahnhofstrasse 1, 8001 Zürich");
  });

  it("carries the owner's facts, not the build's placeholders (red until the owner replaces them)", () => {
    expect(
      SITE_PLACEHOLDERS,
      "fields still marked as placeholders in src/features/marketing/site.ts",
    ).toEqual([]);
  });
});
