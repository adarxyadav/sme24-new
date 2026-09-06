import { createTranslator } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKETING_PAGES, marketingMetadata, openGraphLocale } from "@/features/marketing/metadata";
import { OG_CONTENT_TYPE, OG_SIZE, ogImageMetadata } from "@/features/marketing/og-image";
import { formats } from "@/i18n/formats";
import { MARKETING_ROUTES } from "@/i18n/pathnames";
import { resetEnvCache } from "@/lib/env";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

/**
 * The metadata of the marketing pages (spec 0009, AC-1, AC-2): the localized title and
 * description, the canonical URL with the German slug, the language alternates, the Open Graph
 * locale pair and the Twitter card; the social card's `alt` is the page's statement and falls
 * back to the site name when the key is missing. next-intl's request translator and the image
 * renderer are the boundaries: the translator is built from the real catalogs (a test may
 * swap in a trimmed one), the renderer is never called here.
 */
const state = vi.hoisted(() => ({
  messages: {} as Record<string, unknown>,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({
      locale: locale as "de-CH" | "en-CH",
      messages: state.messages[locale] as never,
      namespace: namespace as never,
      formats,
    }),
}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor() {
      throw new Error("the image renderer is not exercised here");
    }
  },
}));

beforeEach(() => {
  state.messages = { "de-CH": de, "en-CH": en };
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sme24.ch");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("MARKETING_PAGES (AC-1)", () => {
  it("names exactly the routes the sitemap and the budget script list", () => {
    expect(Object.values(MARKETING_PAGES).sort()).toEqual([...MARKETING_ROUTES].sort());
  });
});

describe("openGraphLocale (AC-2)", () => {
  it("turns the app locale into the Open Graph tag", () => {
    expect(openGraphLocale("de-CH")).toBe("de_CH");
    expect(openGraphLocale("en-CH")).toBe("en_CH");
  });
});

describe("marketingMetadata (AC-1, AC-2)", () => {
  it("builds the English pricing page from the catalog with its canonical, alternates and social fields", async () => {
    const metadata = await marketingMetadata("pricing", "en-CH");
    expect(metadata.title).toBe(en.marketing.pricing.meta.title);
    expect(metadata.description).toBe(en.marketing.pricing.meta.description);
    expect(metadata.alternates).toEqual({
      canonical: "https://sme24.ch/en/pricing",
      languages: {
        "de-CH": "https://sme24.ch/de/preise",
        "en-CH": "https://sme24.ch/en/pricing",
        "x-default": "https://sme24.ch/en/pricing",
      },
    });
    expect(metadata.openGraph).toEqual({
      type: "website",
      siteName: en.common.appName,
      locale: "en_CH",
      alternateLocale: ["de_CH"],
      url: "https://sme24.ch/en/pricing",
      title: en.marketing.pricing.meta.title,
      description: en.marketing.pricing.meta.description,
    });
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      title: en.marketing.pricing.meta.title,
      description: en.marketing.pricing.meta.description,
    });
  });

  it("builds the German contact page on its German slug with the locale pair swapped", async () => {
    const metadata = await marketingMetadata("contact", "de-CH");
    expect(metadata.title).toBe(de.marketing.contact.meta.title);
    expect(metadata.alternates?.canonical).toBe("https://sme24.ch/de/kontakt");
    expect(metadata.openGraph).toMatchObject({
      locale: "de_CH",
      alternateLocale: ["en_CH"],
      url: "https://sme24.ch/de/kontakt",
    });
  });

  it("gives the landing page the bare locale URL", async () => {
    const metadata = await marketingMetadata("landing", "en-CH");
    expect(metadata.alternates?.canonical).toBe("https://sme24.ch/en");
    expect(metadata.openGraph).toMatchObject({ url: "https://sme24.ch/en" });
  });
});

describe("ogImageMetadata (AC-2)", () => {
  it("describes one 1200 by 630 PNG per locale whose alt is the page's localized statement", async () => {
    const [image] = await ogImageMetadata("pricing", { params: { locale: "de-CH" } });
    expect(image).toEqual({
      id: "card",
      alt: de.marketing.pricing.og.statement,
      size: OG_SIZE,
      contentType: OG_CONTENT_TYPE,
    });
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    expect(OG_CONTENT_TYPE).toBe("image/png");
  });

  it("falls back to the site name when a page has no statement key", async () => {
    const { og: _dropped, ...pricingWithoutOg } = en.marketing.pricing;
    state.messages = {
      ...state.messages,
      "en-CH": { ...en, marketing: { ...en.marketing, pricing: pricingWithoutOg } },
    };
    const [image] = await ogImageMetadata("pricing", { params: { locale: "en-CH" } });
    expect(image?.alt).toBe(en.common.appName);
  });

  it("resolves an unknown locale segment to the default language", async () => {
    const [image] = await ogImageMetadata("about", { params: { locale: "fr-CH" } });
    expect(image?.alt).toBe(en.marketing.about.og.statement);
  });
});
