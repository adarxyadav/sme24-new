import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  CampaignFrame,
  CampaignImage,
  CampaignPiece,
  CampaignWall,
} from "@/components/brand/campaign";
import { RuledField } from "@/components/brand/ruled-field";
import { Statement } from "@/components/brand/statement";
import { webSiteJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { CompanyLookupField } from "@/features/marketing/ui/company-lookup-field";
import { HeroResearch } from "@/features/marketing/ui/hero-research";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { PackagesGrid } from "@/features/marketing/ui/packages-grid";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import { StepsSection } from "@/features/marketing/ui/steps-section";
import { TrustSection } from "@/features/marketing/ui/trust-section";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

const STEPS = ["lookup", "benchmark", "package", "expert"] as const;

/**
 * The campaign deck's objects (web sized under `public/campaign/`), in wall order. `grayscale`
 * carries the imagery rule (docs/design.md, Brand): photographs of people and places are black
 * and white, cut out objects keep their colour.
 */
const WALL = [
  { key: "teamevent", src: "/campaign/teamevent.jpg", grayscale: false },
  { key: "firmenwagen", src: "/campaign/firmenwagen.webp", grayscale: false },
  { key: "dresscode", src: "/campaign/dresscode.jpg", grayscale: false },
  { key: "jahresbonus", src: "/campaign/jahresbonus.webp", grayscale: true },
  { key: "noCosmetics", src: "/campaign/graue-haare.jpg", grayscale: true },
  { key: "noOverhead", src: "/campaign/keine-haare.jpg", grayscale: true },
] as const;

/** Title, description, alternates and social fields of the landing page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("landing", resolveLocale(locale));
}

/**
 * The landing page (spec 0009, AC-5), top to bottom: the hero with the lookup field, the worked
 * example, how it works, the packages overview, the campaign wall, the trust band and the
 * closing call to action with the same field. Prerendered in both languages; the `WebSite` structured data sits
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

      {/*
        The hero runs up behind the sticky header (`-mt-16`, the bar's `h-16`, given back as
        padding inside) so the ruled ground reaches the top of the viewport; the unscrolled bar
        is transparent, so the two meet without a seam. The hero sits on the page ground in both
        themes, white in light and jet in dark, so the bar never has to invert here. The section's
        `pt-*` therefore reads 4rem short of the space it actually opens above the headline: the
        first 4rem sits under the bar.
      */}
      <RuledField hero align="center" className="-mt-16">
        {/*
          The hero is the page's one quiet block (docs/design.md, tier map: anchor): the statement,
          one lead, one control, one utility line, and nothing else. There is no eyebrow, because
          the headline already names the offer and a caps label above it only adds a third type
          size before the reader reaches the claim.
        */}
        <section className="mx-auto flex max-w-5xl flex-col items-center px-4 pt-48 pb-28 text-center sm:px-6 md:pt-60 md:pb-36">
          {/*
            The one headline on the site that is a noun phrase rather than a campaign statement
            (owner decision of 2026-09-10): it names the number the CFO is buying and carries no
            verb, so it takes no square stop -- `splitSentences` leaves a stopless string bare,
            which is why the copy ends without a period and must keep ending without one. Adding
            a full stop back would put a square mid headline.

            `display` and not `display-lg`, on the full `max-w-5xl` measure: German is the longer
            language here, and at 4.5rem "Franken" drops to a third line while English holds two.
          */}
          <Statement
            as="h1"
            layout="flow"
            text={t("title")}
            // `text-wrap-pretty` overrides the `text-balance` every `Statement` carries: the
            // balancer equalises the two lines, which on this headline leaves the second line as
            // long as, or longer than, the first -- the block widens as it falls. Pretty keeps
            // the first line full and lets the second run short, the shape display type wants,
            // and it is the one headline long enough for the difference to show.
            className="text-pretty font-semibold text-display-sm sm:text-display"
          />
          {/* Held to a narrower measure than the statement, so the lead sits under it as a block
              rather than running wider than the words it supports. `2xl` and not `xl`, with the
              balancer off for the same reason as the headline: at `xl` the copy just fills both
              lines and the second comes out longer than the first, so the block splays as it
              falls. At this measure the first line runs full and the second sits short in both
              languages, which is the shape the statement above it already has.

              The balancer stays on below `sm`, though: at a phone measure the copy runs to four
              lines, and `pretty` there fills three and leaves "fixed price." alone on the fourth.
              Even lines beat a top heavy block once the block is a paragraph. */}
          <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-pretty">
            {t("lead")}
          </p>
          {/* The field is one centred control, not a full width bar: past `max-w-xl` the input
              stretches away from the button and the pair stops reading as a single object. */}
          <CompanyLookupField
            {...lookup}
            size="hero"
            hideLabel
            className="mt-10 flex w-full max-w-xl flex-col gap-2 sm:flex-row"
          />
          {/* Held to the field's own `max-w-xl` measure so the line shares the control's box,
              and laid out as that control's two columns from `sm`: an empty flexible cell over
              the input, then the link centred over the button's own column. Centring the link on
              the whole measure would sit it under the input instead, where it reads as belonging
              to the field. Below `sm` the form stacks and the button goes full width, so the
              single centred cell already lands under it. */}
          <p className="mt-5 grid w-full max-w-xl justify-items-center text-muted-foreground text-sm sm:grid-cols-[1fr_auto] sm:justify-items-stretch">
            {/* The input's column, mirrored: flexible and empty, so the cell beside it takes the
                button's own intrinsic width and centres the link inside it. */}
            <span aria-hidden className="hidden sm:block" />
            {/* A copy of the button's label at the button's own `xl` size metrics (`px-4`,
                `text-base`), invisible and zero height, purely to give this grid column the
                button's exact width so the link centres on it. */}
            <span
              className="sm:invisible sm:col-start-2 sm:row-start-1 sm:h-0 sm:px-4 sm:font-medium sm:text-base"
              aria-hidden
            >
              {lookup.cta}
            </span>
            <Link
              href="/sign-in"
              className="underline underline-offset-4 hover:text-foreground sm:col-start-2 sm:row-start-1 sm:justify-self-center"
            >
              {t("signIn")}
            </Link>
          </p>
        </section>
      </RuledField>

      {/*
        The hero object (docs/design.md, hero object): a still of the client area's first screen,
        under the hero rather than inside it, so the picture of a form never sits beside the real
        lookup field above. The block is `inert` and announced as one image.
      */}
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 md:pb-20">
        <HeroResearch />
      </div>

      {/*
        The bridge between the hero and the steps (docs/design.md, tier map: minor). It exists to
        show one result before the mechanism is explained, because the reader has just seen the
        product (the hero object above) and is about to be told the four steps below without ever
        having been shown an outcome. Ingredients do not sell a dish.

        Why it carries no heading, no lead and no footnote: this is a passage, not a destination.
        The band that stood here until 2026-09-10 listed three data sources; the ledger that
        replaced it printed three figures in three boxed cells; the version after that still spent
        a heading, a lead and a footnote on one number. All three asked a reader two screens into
        the page to stop and study. One sentence with the figure inside it can be read at a glance
        and does the same work, and the methodology it used to footnote already has a whole page
        (`/how-it-works`), reached from the nav rather than from a link hung off this sentence.

        The figure is computed by the real model rather than chosen for effect, so the example can
        never contradict what a live benchmark would print for the same company. From
        `supabase/seed-data/`: UVG section C carries p75 66.4 and median 49.9 accidents per 1 000
        FTE; at 120 FTE that is 7.97 accidents a year, each costing
        `direct_cost_per_case_chf` 4811 + 14 lost days x 1100 = CHF 20 211, times the middle
        `indirect_multiplier` of 3.7 -- CHF 595 853. The same arithmetic at the median rate gives
        CHF 447 787, so the gap is CHF 148 066, rounded down to the nearest thousand for display.
        Changing an assumption CSV changes this number, which is why the sentence says "about" and
        `/how-it-works` carries the detail.
      */}
      <section aria-labelledby="example-heading">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
          {/* The band's accessible name, and the only heading it has: visually hidden, because a
              minor's opener would reinstate the stack this pass removed, while the landmark still
              owes a name (docs/design.md, accessibility). */}
          <h2 id="example-heading" className="sr-only">
            {t("points.heading")}
          </h2>
          {/* One sentence, at a size between the body copy around it and a display figure, with
              the number set in the foreground colour so the eye lands on it first and reads
              outward. `tabular-nums` per docs/design.md, type rules; `whitespace-nowrap` so the
              figure never breaks across lines. */}
          <p className="max-w-5xl text-pretty text-copy-18 text-muted-foreground leading-snug md:text-2xl">
            {t.rich("points.sentence", {
              figure: (chunks) => (
                <span className="whitespace-nowrap font-semibold text-foreground text-xl tabular-nums md:text-3xl">
                  {chunks}
                </span>
              ),
            })}
          </p>
        </div>
      </section>

      <StepsSection
        eyebrow={t("how.eyebrow")}
        title={t("how.title")}
        navLabel={t("how.navLabel")}
        steps={STEPS.map((step) => ({
          key: step,
          title: t(`how.steps.${step}.title`),
          body: t(`how.steps.${step}.body`),
          label: t(`how.steps.${step}.rail`),
        }))}
      />

      <section aria-labelledby="packages-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
          {/*
            The packages opener takes the emphasis shape: the label as a pill and one heading that
            states the claim and answers it in the muted colour, with nothing beside it. The first
            two sentences stay at full strength ("Fixed price. No surprises.") and the third, which
            was the lead until 2026-09-10, closes the heading in grey.
          */}
          <SectionHeader
            tier="major"
            id="packages-heading"
            eyebrow={t("packages.eyebrow")}
            title={t("packages.title")}
            emphasis={{ leadSentences: 2 }}
          />
          <PackagesGrid variant="overview" />
        </div>
      </section>

      <section aria-labelledby="wall-heading">
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
                    grayscale={item.grayscale}
                    sizes="(min-width: 640px) 20rem, 80vw"
                    loading={index === 0 ? "lazy" : undefined}
                  />
                </CampaignFrame>
              </CampaignPiece>
            ))}
          </CampaignWall>
        </div>
      </section>

      <TrustSection />

      <ClosingCta title={t("closing.title")} lead={t("closing.lead")}>
        {/* An anchor tier like the hero, so the field carries the hero's weight; its label stays
            visible because the closing has no field heading of its own. */}
        <CompanyLookupField {...lookup} size="hero" inverse />
      </ClosingCta>
    </>
  );
}
