import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { pricingJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { sortedPackages } from "@/features/marketing/packages";
import { Faq } from "@/features/marketing/ui/faq";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { PackagesCompare } from "@/features/marketing/ui/packages-compare";
import { PackagesGrid } from "@/features/marketing/ui/packages-grid";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import { absoluteUrl } from "@/i18n/metadata";
import { resolveLocale } from "@/i18n/routing";

const FAQ = ["vat", "afterPayment", "date", "cancellation"] as const;

/** Title, description, alternates and social fields of the pricing page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/pricing">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("pricing", resolveLocale(locale));
}

/**
 * The pricing page (spec 0009, AC-6): the four packages from the catalog with their prices, a
 * comparison table across them and a short FAQ; the `ItemList` structured data lists the four
 * products with their CHF offers. It is the one marketing page with no closing call to action
 * (owner decision of 2026-09-14): the cards carry their own. Prerendered in both languages.
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
          {/*
            The one centred opener on the site besides the landing trust band (owner decision of
            2026-09-14, from the reference they brought). It earns the exception by being the
            shortest h1 on any marketing page -- two words and two words -- over a lead that names
            the page's whole promise in one line: centred, the four words sit as a plate over the
            prices rather than as the top left corner of a band that is otherwise empty to the
            right. The pill shape from the same reference is deliberately not taken, because
            "Fixed price. No surprises." is already the landing page's emphasis heading and the
            two pages would meet the reader with the same block twice.
          */}
          <SectionHeader
            tier="anchor"
            as="h1"
            align="center"
            eyebrow={t("eyebrow")}
            title={t("title")}
            lead={t("lead")}
          />
        </div>
      </section>

      {/*
        The packages carry no visible opener (owner decision of 2026-09-14). They had a major one
        from 2026-09-10, added because the h1 was then doing both jobs and the prices arrived with
        nothing said about how they relate; the centred h1 above and the comparison table below
        now carry that between them, and a display heading in between pushed the cards -- the one
        thing this page is for -- most of a screen further down. The heading stays as `sr-only`,
        so the landmark keeps its name and the heading hierarchy keeps its level.
      */}
      <section aria-labelledby="packages-heading">
        {/*
          The band keeps its tier's bottom padding and drops its top one. The tier sets the space a
          section needs around its own content, and with the opener gone there is no content up
          there to clear: the anchor's `md:py-40` bottom and this band's `md:py-28` top stacked to
          309px of empty white between the lead and the first card. The `gap` goes with it, since
          it now sits under an `sr-only` heading and spaces nothing a reader can see.
        */}
        <div className="mx-auto flex max-w-6xl flex-col px-4 pb-16 sm:px-6 md:pb-28">
          <h2 id="packages-heading" className="sr-only">
            {t("packagesHeading.title")}
          </h2>
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
    </>
  );
}
