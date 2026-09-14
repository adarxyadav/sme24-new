import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { collectionPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { CornerBrackets } from "@/features/marketing/ui/corner-brackets";
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
          {/*
            One control under the opener, centred on the same axis as the stack above it. The
            register is the only thing this page can offer a reader at the top: it is the one place
            the claim above can be checked against a public list rather than taken on trust, which
            is why it sits here and not only in the coverage column further down. That inline link
            stays -- it belongs to the sentence it sits in, and it names the register in full where
            there is room for it.

            Outline rather than the filled default. The filled button is the page's closing ask
            ("Get started" on the jet anchor), and a hero that opens with the same weight competes
            with it: this one hands the reader a way to verify the claim, not the page's action.

            `size="lg"`, the marketing call to action size (docs/design.md, spacing and layout).
            The hero's `xl` belongs to the landing page's lookup field alone.
          */}
          <div className="mt-10 flex justify-center">
            <Button asChild size="lg" variant="outline">
              <Link href="/expert-network/directory">{t("cta")}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/*
        The example profiles open the page under the hero (owner decision of 2026-09-14). They sat
        after the vetting ladder until then, on the reading that the cards are the output of an
        argument and would be six strangers before it. What that reading undervalued is that the
        hero's own claim -- "Senior people. No juniors." -- is the thing a reader arrives doubting,
        and the six cards are the evidence for it: shown first they answer the claim while it is
        still being made, and the standard and the ladder below then explain how such a person is
        found. The page argues from the evidence rather than towards it.

        The band stays openerless here (owner decision of 2026-09-14). It carries no argument above
        it now, so what names the cards is the hero itself plus the band's own disclosure note; the
        `sr-only` heading keeps the landmark named and the cards' `h3` a level to sit under.
      */}
      <ExpertProfiles />

      <section aria-labelledby="standard-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-28">
          {/*
            Stacked rather than the major tier's own split row (heading left, lead right), the
            override pattern the pricing page's compare and FAQ bands already use -- one section's
            layout, not a change to the tier.

            The split shape bottom aligns the lead to the heading column (`self-end`), which is
            right for a one line heading and wrong for this one: "What we mean by senior." turns to
            two lines at every width the split applies, so the lead sat on the second line's
            baseline, a full display line below the heading's first, and read as a stray sentence
            floating mid band rather than as this heading's lead. Stacked, the lead sits directly
            under the heading it belongs to and the band opens as one block.

            `gap-3` between the heading and its lead against the wrapper's own `gap-10` to the grid
            below: the pair has to read as one group against the cells it introduces.
          */}
          <SectionHeader
            tier="major"
            id="standard-heading"
            title={t("standard.title")}
            lead={t("standard.intro")}
            className="flex flex-col gap-3 lg:grid-cols-none lg:gap-3 **:data-[slot=lead]:self-start"
          />
          {/*
            The four corner brackets the landing page's trust band already wears: the block stays
            framed by its own hairline and is marked out only at its corners. `CornerBrackets`
            rather than four spans of this page's own, so the offsets live in one place and the two
            bands cannot drift apart -- the primitive already carries the `top-0 left-0` fix for the
            fractional pixel that split a corner into two parallel hairlines.

            It goes on this band and not the vetting ladder below it. The brackets mark the block a
            reader should weigh as one object, and the four cells here are the four halves of a
            single claim -- "nobody joins without all four". The ladder is a sequence on the ruled
            ground, which is already the page's one marked out section; bracketing both would spend
            the device twice on one page and neither would signify.

            The wrapper is `relative` and the `ul` keeps its own `border`: the brackets are
            absolutely positioned against that box and sit over the hairline it draws.
          */}
          <div className="relative">
            <CornerBrackets />
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
        </div>
      </section>

      {/*
        The vetting ladder sits on the page ground. It carried the ruled field -- this page's one
        ruled section -- until 2026-09-14, when the owner asked for the background rules off.

        The landing page made the same move on 2026-09-10 for its steps rail, and the reasoning
        transfers: off the hero the field runs at the full border token, and behind a band whose
        own content is a four cell hairline grid the vertical rules read as a second grid competing
        with the one that carries the sequence. What the ruled ground is for -- marking the one
        section per page that turns the argument -- the numbered ladder already does on its own.

        The expert network therefore has no ruled section now, the way the landing page has none.
        `RuledField` itself is untouched and still serves the two page heroes, the closing call to
        action and the gallery.
      */}
      <section aria-labelledby="vetting-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
          {/*
            The pill eyebrow and the stacked shape, so the page's three openers agree. The hero
            wears the accent pill, the standard band above stacks its heading over its lead, and
            this one was the last still carrying the bare caps line over the tier's split grid --
            a second eyebrow shape and a second layout on one page, for no reason a reader could
            infer.

            Stacked costs nothing here because this major passes no `lead`: the split grid put the
            heading in a 2fr column and left the 3fr beside it empty, so "How someone gets in."
            wrapped to two lines at a measure narrower than the band it introduces. Collapsed, the
            heading takes the full width and sets on one line at desktop widths.
          */}
          <SectionHeader
            tier="major"
            id="vetting-heading"
            eyebrow={t("vetting.eyebrow")}
            eyebrowVariant="pill"
            title={t("vetting.title")}
            className="flex flex-col gap-3 lg:grid-cols-none lg:gap-3"
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

      {/*
        The matching and coverage band stood here until 2026-09-14 and is gone entirely (owner
        decision). Coverage went first, for being the page's most Swiss bound copy, for repeating
        the hero's link to the SGAS register and for being the second heading on a landmark that
        named itself with two ids; matching followed on the same day.

        The page now runs hero, profiles, standard, vetting, closing: who they are, what senior
        means, how someone gets in, and the ask. "How you get yours." described the assignment
        mechanic, which is a question a reader has after deciding they want an expert rather than
        while deciding whether these people are any good, and the vetting ladder above already ends
        on how the bar is held. The fit guarantee it carried -- another expert at our cost -- is a
        commitment worth keeping somewhere, and the place for it is the package terms or the FAQ
        rather than a band of its own on this page.

        Both key groups leave both catalogs with it, so nothing dead is left behind.
      */}
      <ClosingCta title={t("closing.title")}>
        <Button asChild size="lg">
          <Link href="/sign-up">{t("closing.cta")}</Link>
        </Button>
      </ClosingCta>
    </>
  );
}
