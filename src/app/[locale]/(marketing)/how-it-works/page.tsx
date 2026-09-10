import { CheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { howToJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { SectionHeader } from "@/features/marketing/ui/section-header";
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
            name: t(`steps.items.${step}.label`),
            text: t(`steps.items.${step}.body`),
          })),
        })}
      />

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

      <StepsSection
        eyebrow={t("steps.eyebrow")}
        title={t("steps.title")}
        steps={STEPS.map((step) => ({
          key: step,
          label: t(`steps.items.${step}.label`),
          body: t(`steps.items.${step}.body`),
        }))}
      />

      <section aria-labelledby="split-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-28">
          <SectionHeader
            tier="major"
            id="split-heading"
            eyebrow={t("split.eyebrow")}
            title={t("split.title")}
          />
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
                  className="font-semibold text-xl tracking-headline"
                />
                {/*
                  Marked, not bare. Three grey sentences stacked on their own read as a paragraph
                  that lost its leading, so the panel showed no sign of being a list of three
                  things -- the one item list on the site without a marker, directly under the
                  steps grid where every cell is numbered. The marker is the checked list from
                  `PackageCard`, unchanged: these are contents of the engagement (what each side
                  brings) exactly as the included points are contents of a package, so the same
                  content takes the same shape rather than a second one.
                */}
                <ul className="flex flex-col gap-2.5">
                  {column.items.map((item) => (
                    <li
                      key={item.key}
                      className="flex max-w-prose items-start gap-2 text-muted-foreground text-sm"
                    >
                      <CheckIcon
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="timing-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 md:py-20">
          <SectionHeader
            tier="minor"
            id="timing-heading"
            title={t("timing.title")}
            lead={t("timing.lead")}
          />
          <ul className="grid gap-px border bg-border sm:grid-cols-3">
            {TIMING.map((item) => (
              <li key={item} className="flex flex-col gap-3 bg-background px-6 py-8">
                <Statement
                  as="h3"
                  text={t(`timing.items.${item}.title`)}
                  className="font-semibold text-xl tracking-headline"
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
