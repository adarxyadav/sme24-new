import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  CampaignFrame,
  CampaignImage,
  CampaignPiece,
  CampaignWall,
} from "@/components/brand/campaign";
import { Statement } from "@/components/brand/statement";
import { webSiteJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { CompanyLookupField } from "@/features/marketing/ui/company-lookup-field";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { PackagesGrid } from "@/features/marketing/ui/packages-grid";
import { StepsSection } from "@/features/marketing/ui/steps-section";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

const POINTS = ["price", "negotiation", "kickoff"] as const;
const STEPS = ["lookup", "benchmark", "package", "expert"] as const;

/** The campaign deck's objects (web sized under `public/campaign/`), in wall order. */
const WALL = [
  { key: "teamevent", src: "/campaign/teamevent.jpg" },
  { key: "firmenwagen", src: "/campaign/firmenwagen.webp" },
  { key: "dresscode", src: "/campaign/dresscode.jpg" },
  { key: "jahresbonus", src: "/campaign/jahresbonus.webp" },
  { key: "noCosmetics", src: "/campaign/no-cosmetics.jpg" },
  { key: "noOverhead", src: "/campaign/no-overhead.webp" },
] as const;

/** Title, description, alternates and social fields of the landing page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("landing", resolveLocale(locale));
}

/**
 * The landing page (spec 0009, AC-5), top to bottom: the hero with the lookup field, the three
 * proof points, how it works, the packages overview, the campaign wall and the closing call to
 * action with the same field. Prerendered in both languages; the `WebSite` structured data sits
 * next to the layout's `Organization`.
 */
export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta] = await Promise.all([
    getTranslations("marketing.landing"),
    getTranslations("marketing.landing.meta"),
  ]);
  const lookup = {
    locale: resolved,
    label: t("lookup.label"),
    placeholder: t("lookup.placeholder"),
    cta: t("lookup.cta"),
  };

  return (
    <>
      <JsonLd
        data={webSiteJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/", resolved),
          inLanguage: resolved,
        })}
      />

      <section className="dark bg-background text-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-24 sm:px-6 md:py-36">
          <p className="eyebrow text-muted-foreground">{t("eyebrow")}</p>
          <Statement
            as="h1"
            text={t("title")}
            className="max-w-4xl text-display-sm md:text-display lg:text-display-lg"
          />
          <p className="max-w-prose text-lg text-muted-foreground">{t("lead")}</p>
          <CompanyLookupField {...lookup} inverse />
          <Link
            href="/sign-in"
            className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("signIn")}
          </Link>
        </div>
      </section>

      <section aria-label={t("pointsLabel")} className="border-b">
        <ul className="mx-auto grid max-w-6xl gap-px sm:grid-cols-3 sm:divide-x">
          {POINTS.map((point) => (
            <li key={point} className="flex flex-col gap-3 px-4 py-10 sm:px-6">
              <Statement as="h2" text={t(`points.${point}.title`)} className="text-display-sm" />
              <p className="max-w-prose text-muted-foreground text-sm">
                {t(`points.${point}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <StepsSection
        eyebrow={t("how.eyebrow")}
        title={t("how.title")}
        steps={STEPS.map((step) => ({
          key: step,
          title: t(`how.steps.${step}.title`),
          body: t(`how.steps.${step}.body`),
        }))}
      />

      <section aria-labelledby="packages-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-24">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-muted-foreground">{t("packages.eyebrow")}</p>
            <Statement
              as="h2"
              id="packages-heading"
              text={t("packages.title")}
              className="text-display-sm md:text-display"
            />
            <p className="max-w-prose text-lg text-muted-foreground">{t("packages.lead")}</p>
          </div>
          <PackagesGrid variant="overview" />
        </div>
      </section>

      <section aria-labelledby="wall-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-24">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-muted-foreground">{t("wall.eyebrow")}</p>
            <Statement
              as="h2"
              id="wall-heading"
              text={t("wall.title")}
              className="text-display-sm md:text-display"
            />
          </div>
          <CampaignWall>
            {WALL.map((item, index) => (
              <CampaignPiece
                key={item.key}
                statement={t(`wall.items.${item.key}.statement`)}
                signature={false}
                as="h3"
              >
                <CampaignFrame className="max-w-xs">
                  <CampaignImage
                    src={item.src}
                    alt={t(`wall.items.${item.key}.alt`)}
                    sizes="(min-width: 640px) 20rem, 80vw"
                    loading={index === 0 ? "lazy" : undefined}
                  />
                </CampaignFrame>
              </CampaignPiece>
            ))}
          </CampaignWall>
        </div>
      </section>

      <ClosingCta title={t("closing.title")} lead={t("closing.lead")}>
        <CompanyLookupField {...lookup} inverse />
      </ClosingCta>
    </>
  );
}
