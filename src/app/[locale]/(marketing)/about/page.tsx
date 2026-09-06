import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  CampaignFrame,
  CampaignGrid,
  CampaignImage,
  CampaignPiece,
} from "@/components/brand/campaign";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { aboutPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

const STORY = ["fixedPrice", "seniors", "noSlides"] as const;
const HOW = ["data", "fixed", "senior", "written"] as const;

/** Title, description, alternates and social fields of the about page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/about">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("about", resolveLocale(locale));
}

/**
 * The about page (spec 0009, page composition): the statement, the story in three paragraphs,
 * a campaign grid with the expert and two objects, how we work and the closing call to action;
 * `AboutPage` structured data. Prerendered in both languages.
 */
export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta] = await Promise.all([
    getTranslations("marketing.about"),
    getTranslations("marketing.about.meta"),
  ]);

  return (
    <>
      <JsonLd
        data={aboutPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/about", resolved),
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

      <section aria-labelledby="story-heading" className="border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Statement
            as="h2"
            id="story-heading"
            text={t("story.title")}
            className="text-display-sm md:text-display"
          />
          <div className="flex max-w-prose flex-col gap-6">
            {STORY.map((paragraph) => (
              <p key={paragraph} className="text-base leading-relaxed">
                {t(`story.${paragraph}`)}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section aria-label={t("grid.label")} className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <CampaignPiece statement={t("grid.statement")} as="p">
            <CampaignGrid columns={3}>
              <CampaignFrame caption={t("grid.philipp.caption")} aspect="portrait">
                <CampaignImage
                  src="/campaign/philipp.webp"
                  alt={t("grid.philipp.alt")}
                  sizes="(min-width: 640px) 33vw, 100vw"
                  loading="lazy"
                />
              </CampaignFrame>
              <CampaignFrame caption={t("grid.dresscode.caption")} aspect="portrait">
                <CampaignImage
                  src="/campaign/dresscode.jpg"
                  alt={t("grid.dresscode.alt")}
                  sizes="(min-width: 640px) 33vw, 100vw"
                />
              </CampaignFrame>
              <CampaignFrame caption={t("grid.firmenwagen.caption")} aspect="portrait">
                <CampaignImage
                  src="/campaign/firmenwagen.webp"
                  alt={t("grid.firmenwagen.alt")}
                  sizes="(min-width: 640px) 33vw, 100vw"
                />
              </CampaignFrame>
            </CampaignGrid>
          </CampaignPiece>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-24">
          <Statement
            as="h2"
            id="how-heading"
            text={t("how.title")}
            className="text-display-sm md:text-display"
          />
          <ul className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map((item) => (
              <li key={item} className="flex flex-col gap-3 bg-background px-6 py-8">
                <Statement
                  as="h3"
                  text={t(`how.items.${item}.title`)}
                  className="font-bold text-xl tracking-headline"
                />
                <p className="max-w-prose text-muted-foreground text-sm">
                  {t(`how.items.${item}.body`)}
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
