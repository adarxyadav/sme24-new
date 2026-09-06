import { describe, expect, it } from "vitest";
import {
  aboutPageJsonLd,
  contactPageJsonLd,
  organizationJsonLd,
  pricingJsonLd,
  serializeJsonLd,
  webSiteJsonLd,
} from "@/features/marketing/json-ld";

/**
 * The structured data builders (spec 0009, AC-3): one per page type with the schema.org context,
 * the pricing list with an offer in CHF per product and no price on the retainer, and a
 * serializer that escapes every `<` so a message can never close the script element.
 */
describe("JSON-LD builders (AC-3)", () => {
  it("builds the organization with its contact point and profiles", () => {
    expect(
      organizationJsonLd({
        name: "SME24",
        url: "https://sme24.ch",
        logo: "https://sme24.ch/icon.svg",
        email: "service@sme24.ch",
        sameAs: ["https://www.linkedin.com/company/sme24"],
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "SME24",
      url: "https://sme24.ch",
      logo: "https://sme24.ch/icon.svg",
      contactPoint: { "@type": "ContactPoint", contactType: "sales", email: "service@sme24.ch" },
      sameAs: ["https://www.linkedin.com/company/sme24"],
    });
  });

  it("omits the profiles key while no profile exists", () => {
    const organization = organizationJsonLd({
      name: "SME24",
      url: "https://sme24.ch",
      logo: "https://sme24.ch/icon.svg",
      email: "service@sme24.ch",
      sameAs: [],
    });
    expect("sameAs" in organization).toBe(false);
    expect(JSON.parse(serializeJsonLd(organization))).toMatchObject({
      contactPoint: { "@type": "ContactPoint", contactType: "sales", email: "service@sme24.ch" },
    });
  });

  it("builds the three page types with their language", () => {
    const page = {
      name: "About",
      url: "https://sme24.ch/en/about",
      description: "Why.",
      inLanguage: "en-CH",
    };
    expect(webSiteJsonLd(page)["@type"]).toBe("WebSite");
    expect(aboutPageJsonLd(page)["@type"]).toBe("AboutPage");
    expect(contactPageJsonLd(page)).toMatchObject({ "@type": "ContactPage", inLanguage: "en-CH" });
  });

  it("lists four products with a CHF offer each, the retainer without a price", () => {
    const list = pricingJsonLd([
      {
        name: "Compliance",
        description: "A",
        priceChf: 4900,
        url: "https://sme24.ch/en/pricing#compliance",
      },
      {
        name: "Retainer",
        description: "B",
        priceChf: null,
        url: "https://sme24.ch/en/pricing#retainer",
      },
    ]);
    expect(list["@type"]).toBe("ItemList");
    const items = list.itemListElement as ReadonlyArray<{
      position: number;
      item: { offers: Record<string, unknown> };
    }>;
    expect(items.map((entry) => entry.position)).toEqual([1, 2]);
    expect(items[0]?.item.offers).toMatchObject({
      "@type": "Offer",
      priceCurrency: "CHF",
      price: 4900,
      availability: "https://schema.org/InStock",
      businessFunction: { "@id": "http://purl.org/goodrelations/v1#ProvideService" },
    });
    expect(items[1]?.item.offers).not.toHaveProperty("price");
    expect(items[1]?.item.offers).toMatchObject({ priceCurrency: "CHF" });
  });

  it("escapes every < in the serialized JSON and nothing else", () => {
    const html = serializeJsonLd(
      contactPageJsonLd({
        name: "</script><script>alert(1)</script>",
        url: "https://sme24.ch/en/contact",
        description: 'Quotes "stay" & so do ampersands',
        inLanguage: "en-CH",
      }),
    );
    expect(html).not.toContain("<");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain('Quotes \\"stay\\" & so do ampersands');
    expect(JSON.parse(html)).toMatchObject({ name: "</script><script>alert(1)</script>" });
  });
});
