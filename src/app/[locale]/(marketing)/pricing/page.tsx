import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { pricingJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { sortedPackages } from "@/features/marketing/packages";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { Faq } from "@/features/marketing/ui/faq";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { PackagesGrid } from "@/features/marketing/ui/packages-grid";
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

      <section className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6 md:py-24">
          <p className="eyebrow text-muted-foreground">{t("eyebrow")}</p>
          <Statement
            as="h1"
            text={t("title")}
            className="max-w-4xl text-display-sm md:text-display"
          />
          <p className="max-w-prose text-lg text-muted-foreground">{t("lead")}</p>
        </div>
      </section>

      <section aria-label={t("packagesLabel")} className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <PackagesGrid variant="full" />
        </div>
      </section>

      <section aria-labelledby="included-heading" className="border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Statement
            as="h2"
            id="included-heading"
            text={t("included.title")}
            className="text-display-sm md:text-display"
          />
          <ul className="grid gap-6 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex flex-col gap-2 border-t pt-4">
                <p className="text-sm">{t(`included.items.${item}`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Statement
            as="h2"
            id="faq-heading"
            text={t("faq.title")}
            className="text-display-sm md:text-display"
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
