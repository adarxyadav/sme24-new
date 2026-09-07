import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { collectionPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

const STANDARD = ["years", "accountable", "sector", "swiss"] as const;
const VETTING = ["record", "shadow", "review", "ongoing"] as const;

/** Title, description, alternates and social fields of the expert network page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/expert-network">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("expertNetwork", resolveLocale(locale));
}

/**
 * The expert network page (spec 0009, page composition): the statement, the four things "senior"
 * has to mean, how someone is vetted into the network, how an expert is matched to a company,
 * where the network reaches and the closing call to action; `CollectionPage` structured data.
 * Client facing: it describes the people who visit, and does not recruit. Prerendered in both
 * languages.
 */
export default async function ExpertNetworkPage({ params }: PageProps<"/[locale]/expert-network">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta] = await Promise.all([
    getTranslations("marketing.expertNetwork"),
    getTranslations("marketing.expertNetwork.meta"),
  ]);

  return (
    <>
      <JsonLd
        data={collectionPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/expert-network", resolved),
          inLanguage: resolved,
        })}
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

      <section aria-labelledby="standard-heading" className="border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex flex-col gap-4">
            <Statement
              as="h2"
              id="standard-heading"
              text={t("standard.title")}
              className="text-display-sm md:text-display"
            />
            <p className="max-w-prose text-muted-foreground">{t("standard.intro")}</p>
          </div>
          <ul className="grid gap-px border bg-border sm:grid-cols-2">
            {STANDARD.map((item) => (
              <li key={item} className="flex flex-col gap-3 bg-background px-6 py-8">
                <Statement
                  as="h3"
                  text={t(`standard.items.${item}.title`)}
                  className="font-bold text-xl tracking-headline"
                />
                <p className="max-w-prose text-muted-foreground text-sm">
                  {t(`standard.items.${item}.body`)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="vetting-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-24">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-muted-foreground">{t("vetting.eyebrow")}</p>
            <Statement
              as="h2"
              id="vetting-heading"
              text={t("vetting.title")}
              className="text-display-sm md:text-display"
            />
          </div>
          <ol className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {VETTING.map((step, index) => (
              <li key={step} className="flex flex-col gap-4 bg-background px-6 py-8">
                <span className="font-mono text-muted-foreground text-xs tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Statement
                  as="h3"
                  text={t(`vetting.steps.${step}.title`)}
                  className="font-bold text-xl tracking-headline"
                />
                <p className="max-w-prose text-muted-foreground text-sm">
                  {t(`vetting.steps.${step}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="matching-heading coverage-heading" className="border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <p className="eyebrow text-muted-foreground">{t("matching.eyebrow")}</p>
            <Statement
              as="h2"
              id="matching-heading"
              text={t("matching.title")}
              className="text-display-sm md:text-display"
            />
            <p className="max-w-prose text-base leading-relaxed">{t("matching.lead")}</p>
          </div>
          <div className="flex flex-col gap-4">
            <p className="eyebrow text-muted-foreground">{t("coverage.eyebrow")}</p>
            <Statement
              as="h2"
              id="coverage-heading"
              text={t("coverage.title")}
              className="text-display-sm md:text-display"
            />
            <p className="max-w-prose text-base leading-relaxed">{t("coverage.lead")}</p>
            <p className="text-muted-foreground text-sm">{t("coverage.note")}</p>
            <p className="text-sm">
              <Link href="/expert-network/directory" className="underline underline-offset-4">
                {t("coverage.directory")}
              </Link>
            </p>
          </div>
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
