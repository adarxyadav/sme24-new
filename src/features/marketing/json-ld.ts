import type {
  AboutPage,
  ContactPage,
  ItemList,
  Offer,
  Organization,
  Product,
  Thing,
  WebSite,
  WithContext,
} from "schema-dts";

/**
 * The structured data of the marketing pages (spec 0009, AC-3): one typed builder per page type,
 * serialized by `serializeJsonLd` for the `JsonLd` component. Pure, runs anywhere.
 */

/**
 * Serializes a JSON-LD object for a script element, replacing every `<` with `\u003c` so a
 * message can never close the script tag. Escaping only `<` is deliberate and enough for a
 * script element (the browser reads the body as JSON, not HTML). Pure.
 */
export function serializeJsonLd(data: WithContext<Thing>): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

export type OrganizationInput = {
  readonly name: string;
  readonly url: string;
  readonly logo: string;
  readonly email: string;
  readonly sameAs: readonly string[];
};

/**
 * `Organization` for every marketing page (from the layout): name, url, logo, contact point and
 * profiles; the `sameAs` key is omitted while no profile exists (an empty list would only draw a
 * validator warning). Pure.
 */
export function organizationJsonLd(input: OrganizationInput): WithContext<Organization> {
  const organization: WithContext<Organization> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: input.url,
    logo: input.logo,
    contactPoint: { "@type": "ContactPoint", contactType: "sales", email: input.email },
  };
  return input.sameAs.length > 0 ? { ...organization, sameAs: [...input.sameAs] } : organization;
}

export type PageInput = {
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly inLanguage: string;
};

/** `WebSite` for the landing page. Pure. */
export function webSiteJsonLd(input: PageInput): WithContext<WebSite> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: input.name,
    url: input.url,
    description: input.description,
    inLanguage: input.inLanguage,
  };
}

/** `AboutPage` for the about page. Pure. */
export function aboutPageJsonLd(input: PageInput): WithContext<AboutPage> {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: input.name,
    url: input.url,
    description: input.description,
    inLanguage: input.inLanguage,
  };
}

/** `ContactPage` for the contact page. Pure. */
export function contactPageJsonLd(input: PageInput): WithContext<ContactPage> {
  return {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: input.name,
    url: input.url,
    description: input.description,
    inLanguage: input.inLanguage,
  };
}

export type PricingItem = {
  readonly name: string;
  readonly description: string;
  /** The fixed price in CHF, or null for the retainer (no price in the offer). */
  readonly priceChf: number | null;
  readonly url: string;
};

/**
 * `ItemList` of the four packages for the pricing page, each a `Product` with an `Offer` in
 * CHF: the fixed price packages carry their price, the retainer carries none; every offer is in
 * stock and provides a service. Pure.
 */
export function pricingJsonLd(items: readonly PricingItem[]): WithContext<ItemList> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: productJsonLd(item),
    })),
  };
}

function productJsonLd(item: PricingItem): Product {
  const offer: Offer = {
    "@type": "Offer",
    priceCurrency: "CHF",
    availability: "https://schema.org/InStock",
    businessFunction: { "@id": "http://purl.org/goodrelations/v1#ProvideService" },
    url: item.url,
  };
  return {
    "@type": "Product",
    name: item.name,
    description: item.description,
    url: item.url,
    offers: item.priceChf === null ? offer : { ...offer, price: item.priceChf },
  };
}
