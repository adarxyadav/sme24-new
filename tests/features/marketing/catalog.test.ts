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
        /** The one word trade name that heads the card since 2026-09-10. */
        shortName: string;
        promise: string;
        /** Only the two middle rungs of the ladder carry one. */
        buildsOn?: string;
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
          "shortName",
          "promise",
          "bestFor",
          "delivery",
          "output",
          "outcome",
        ] as const) {
          expect(messages?.[field], `${entry.key}.${field}`).toBeTruthy();
        }
        // The trade name is the card's heading, so it has to stay short enough to set on one
        // line in this column: the whole point of the 2026-09-10 rename was that the full
        // catalogue name did not (47 characters, two lines, at body copy size).
        expect(
          messages?.shortName.length,
          `${entry.key}.shortName is too long to head a card`,
        ).toBeLessThanOrEqual(12);
        expect(entry.included, `${entry.key}.included`).toHaveLength(3);
        for (const point of entry.included) {
          expect(messages?.included[point], `${entry.key}.included.${point}`).toBeTruthy();
        }
      }
    }
  });

  it("carries the ladder line on the two middle rungs only, each naming the rung below", () => {
    // The three snapshots are cumulative, so each rung above the first says what it builds on
    // (owner decision of 2026-09-10). `culture` is the first rung and `retainer` sits outside
    // the ladder, so both leave the slot empty -- the card reads the key through `t.has`, and a
    // key added here without a rung below it would render on a card that has nothing to point at.
    for (const catalog of [de, en]) {
      const rung = (key: string) => {
        const messages = packageMessages(catalog, key);
        if (!messages) throw new Error(`the catalog is missing the ${key} package`);
        return messages;
      };
      expect(rung("culture")).not.toHaveProperty("buildsOn");
      expect(rung("retainer")).not.toHaveProperty("buildsOn");
      expect(rung("sms").buildsOn, "sms.buildsOn").toContain(rung("culture").shortName);
      expect(rung("compliance").buildsOn, "compliance.buildsOn").toContain(rung("sms").shortName);
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
