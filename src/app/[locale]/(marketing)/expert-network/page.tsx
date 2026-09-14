import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RuledField } from "@/components/brand/ruled-field";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { collectionPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { ExpertProfiles } from "@/features/marketing/ui/expert-profiles";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { SectionHeader } from "@/features/marketing/ui/section-header";
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

      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-40">
          {/*
            The third centred opener on the site (owner decision of 2026-09-14), after the landing
            trust band and the pricing opener. It earns the exception the way pricing does and for
            that reason only: "Senior people. No juniors." is four words of display type, so left
            aligned it left most of a `py-24 md:py-40` band empty to the right. Unlike pricing the
            plate does not sit over cards -- the band under it is "the standard", which opens with
            a major of its own -- so the centring is justified by the heading's own length here,
            not by what follows it.

            The lead widens off the centred default of `max-w-136`, which was measured against the
            pricing lead: one sentence of 467px that sits on one line at desktop widths. This lead
            is two sentences (EN 1049px, DE 1128px unwrapped), so at 544px it turned twice and
            stranded a two word orphan on a third line in both catalogs. `max-w-2xl` (672px) is the
            widest step that still reads as a plate and the first that holds both languages to two
            balanced lines (second line 382px of 672 in English, 494px in German). Re-measure both
            catalogs if this copy changes.
          */}
          <SectionHeader
            tier="anchor"
            as="h1"
            align="center"
            eyebrow={t("eyebrow")}
            title={t("title")}
            lead={t("lead")}
            className="**:data-[slot=lead]:max-w-2xl"
          />
        </div>
      </section>

      <section aria-labelledby="standard-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-28">
          <SectionHeader
            tier="major"
            id="standard-heading"
            title={t("standard.title")}
            lead={t("standard.intro")}
          />
          <ul className="grid gap-px border bg-border sm:grid-cols-2">
            {STANDARD.map((item) => (
              <li key={item} className="flex flex-col gap-3 bg-background px-6 py-8">
                <Statement
                  as="h3"
                  text={t(`standard.items.${item}.title`)}
                  className="font-semibold text-xl tracking-headline"
                />
                <p className="max-w-prose text-muted-foreground text-sm">
                  {t(`standard.items.${item}.body`)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* The page's one ruled ground: vetting is the section that turns the argument. */}
      <RuledField>
        <section aria-labelledby="vetting-heading">
          <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
            <SectionHeader
              tier="major"
              id="vetting-heading"
              eyebrow={t("vetting.eyebrow")}
              title={t("vetting.title")}
            />
            <ol className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {VETTING.map((step, index) => (
                <li key={step} className="flex flex-col gap-4 bg-background px-6 py-8">
                  <span className="font-mono text-muted-foreground text-xs tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Statement
                    as="h3"
                    text={t(`vetting.steps.${step}.title`)}
                    className="font-semibold text-xl tracking-headline"
                  />
                  <p className="max-w-prose text-muted-foreground text-sm">
                    {t(`vetting.steps.${step}.body`)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </RuledField>

      {/*
        The example profiles sit after the vetting ladder: the page has said what "senior" has to
        mean and how someone is vetted in, so the reader's next question is who that produces. Put
        before the ladder they would be six strangers; after it they are the output of an argument
        the reader has just been walked through.
      */}
      <ExpertProfiles />

      <section aria-labelledby="matching-heading coverage-heading">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:py-20 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <SectionHeader
              tier="minor"
              id="matching-heading"
              title={t("matching.title")}
              className="md:grid-cols-1 md:gap-4"
            />
            <p className="max-w-prose text-base leading-relaxed">{t("matching.lead")}</p>
          </div>
          <div className="flex flex-col gap-4">
            <SectionHeader
              tier="minor"
              id="coverage-heading"
              title={t("coverage.title")}
              className="md:grid-cols-1 md:gap-4"
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
