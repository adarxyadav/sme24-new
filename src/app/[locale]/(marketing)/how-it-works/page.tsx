import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { howToJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { StepsSection } from "@/features/marketing/ui/steps-section";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

const STEPS = ["lookup", "benchmark", "package", "expert"] as const;
const YOURS = ["name", "access", "decide"] as const;
const OURS = ["research", "visit", "write"] as const;
const TIMING = ["benchmark", "visit", "report"] as const;

/** Title, description, alternates and social fields of the how it works page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/how-it-works">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("howItWorks", resolveLocale(locale));
}

/**
 * The how it works page (spec 0009, page composition): the statement, the four steps the landing
 * page summarises, the division of labour between the client and us, how long each stage takes
 * and the closing call to action; `HowTo` structured data. Prerendered in both languages.
 */
export default async function HowItWorksPage({ params }: PageProps<"/[locale]/how-it-works">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta] = await Promise.all([
    getTranslations("marketing.howItWorks"),
    getTranslations("marketing.howItWorks.meta"),
  ]);

  return (
    <>
      <JsonLd
        data={howToJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/how-it-works", resolved),
          inLanguage: resolved,
          steps: STEPS.map((step) => ({
            name: t(`steps.items.${step}.title`),
            text: t(`steps.items.${step}.body`),
          })),
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

      <StepsSection
        eyebrow={t("steps.eyebrow")}
        title={t("steps.title")}
        steps={STEPS.map((step) => ({
          key: step,
          title: t(`steps.items.${step}.title`),
          body: t(`steps.items.${step}.body`),
        }))}
      />

      <section aria-labelledby="split-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-24">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-muted-foreground">{t("split.eyebrow")}</p>
            <Statement
              as="h2"
              id="split-heading"
              text={t("split.title")}
              className="text-display-sm md:text-display"
            />
          </div>
          <div className="grid gap-px border bg-border md:grid-cols-2">
            {[
              {
                key: "yours",
                title: t("split.yours.title"),
                items: YOURS.map((item) => ({ key: item, text: t(`split.yours.items.${item}`) })),
              },
              {
                key: "ours",
                title: t("split.ours.title"),
                items: OURS.map((item) => ({ key: item, text: t(`split.ours.items.${item}`) })),
              },
            ].map((column) => (
              <div key={column.key} className="flex flex-col gap-5 bg-background px-6 py-8">
                <Statement
                  as="h3"
                  text={column.title}
                  className="font-bold text-xl tracking-headline"
                />
                <ul className="flex flex-col gap-3">
                  {column.items.map((item) => (
                    <li key={item.key} className="max-w-prose text-muted-foreground text-sm">
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="timing-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-24">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-muted-foreground">{t("timing.eyebrow")}</p>
            <Statement
              as="h2"
              id="timing-heading"
              text={t("timing.title")}
              className="text-display-sm md:text-display"
            />
            <p className="max-w-prose text-lg text-muted-foreground">{t("timing.lead")}</p>
          </div>
          <ul className="grid gap-px border bg-border sm:grid-cols-3">
            {TIMING.map((item) => (
              <li key={item} className="flex flex-col gap-3 bg-background px-6 py-8">
                <Statement
                  as="h3"
                  text={t(`timing.items.${item}.title`)}
                  className="font-bold text-xl tracking-headline"
                />
                <p className="max-w-prose text-muted-foreground text-sm">
                  {t(`timing.items.${item}.body`)}
                </p>
              </li>
            ))}
          </ul>
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
