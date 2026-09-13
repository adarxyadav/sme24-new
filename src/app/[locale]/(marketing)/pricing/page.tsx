import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { pricingJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { sortedPackages } from "@/features/marketing/packages";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { Faq } from "@/features/marketing/ui/faq";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { PackagesCompare } from "@/features/marketing/ui/packages-compare";
import { PackagesGrid } from "@/features/marketing/ui/packages-grid";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

const INCLUDED = ["expert", "fixedPrice", "onSite", "report"] as const;
const FAQ = ["vat", "afterPayment", "date", "cancellation"] as const;

/** Title, description, alternates and social fields of the pricing page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/pricing">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("pricing", resolveLocale(locale));
}

/**
 * The pricing page (spec 0009, AC-6): the four packages from the catalog with their prices, what
 * every package includes, a short FAQ and the closing call to action; the `ItemList` structured
 * data lists the four products with their CHF offers. Prerendered in both languages.
 */
export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, packages] = await Promise.all([
    getTranslations("marketing.pricing"),
    getTranslations("marketing.packages"),
  ]);
  const pricingUrl = absoluteUrl("/pricing", resolved);

  return (
    <>
      <JsonLd
        data={pricingJsonLd(
          sortedPackages().map((entry) => ({
            name: packages(`${entry.key}.name`),
            description: packages(`${entry.key}.promise`),
            priceChf: entry.priceChf,
            url: `${pricingUrl}#${entry.key}`,
          })),
        )}
      />

      {/*
        The anchor opener stands alone in its own band, at the `py-24 md:py-40` every other
        marketing page gives its opener. It shared a band with the packages until 2026-09-10,
        which cost the opener its clearance and left the packages -- the one thing this page is
        for -- as the only major section on the site with no heading of its own: the h1 was doing
        both jobs, so the prices arrived with nothing said about how they relate.
      */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-40">
          <SectionHeader
            tier="anchor"
            as="h1"
            eyebrow={t("eyebrow")}
            title={t("title")}
            lead={t("lead")}
          />
        </div>
      </section>

      <section aria-labelledby="packages-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
          <SectionHeader
            tier="major"
            id="packages-heading"
            eyebrow={t("packagesHeading.eyebrow")}
            title={t("packagesHeading.title")}
            lead={t("packagesHeading.lead")}
          />
          <PackagesGrid variant="full" />
        </div>
      </section>

      {/*
        The comparison table is a minor band under the packages major, not a second major: it
        re-presents the facts the cards above it already carry, in a shape that reads across the
        four rather than down one. A major heading over it would claim the cards' weight twice.
      */}
      <section aria-labelledby="compare-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 md:py-20">
          {/*
            Stacked rather than the minor tier's own inline row (heading left, lead right): the
            lead here names the table's columns ("scope, output, and price"), so it reads as the
            table's caption and belongs directly above it rather than off to one side. The
            override is one section's layout, not a change to the tier -- every other minor band
            on the site keeps the inline shape.
          */}
          <SectionHeader
            tier="minor"
            id="compare-heading"
            title={t("compare.heading")}
            lead={t("compare.lead")}
            className="flex flex-col gap-3 md:grid-cols-none md:gap-3"
          />
          <PackagesCompare />
        </div>
      </section>

      <section aria-labelledby="included-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 md:py-20">
          <SectionHeader tier="minor" id="included-heading" title={t("included.title")} />
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {INCLUDED.map((item) => (
              <li key={item} className="flex flex-col gap-2 border-t pt-4">
                <p className="text-sm">{t(`included.items.${item}`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="faq-heading">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <SectionHeader
            tier="minor"
            id="faq-heading"
            title={t("faq.title")}
            className="border-0 pt-0"
          />
          <Faq
            items={FAQ.map((item) => ({
              id: item,
              question: t(`faq.items.${item}.question`),
              answer: t(`faq.items.${item}.answer`),
            }))}
          />
        </div>
      </section>

      <ClosingCta title={t("closing.title")}>
        <Button asChild size="lg">
          <Link href="/sign-up">{t("closing.cta")}</Link>
        </Button>
      </ClosingCta>
    </>
  );
}
