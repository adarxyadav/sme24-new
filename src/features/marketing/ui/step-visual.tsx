import Image from "next/image";
import { getFormatter, getTranslations } from "next-intl/server";
import { QuartileBand } from "@/components/ui/quartile-band";
import { PACKAGES } from "@/features/marketing/packages";
import { cn } from "@/lib/utils";

/** The step keys that carry a visual, in the landing page's own order. */
export type StepVisualKey = "lookup" | "benchmark" | "package" | "expert";

/*
  The peer figures of the still, and where they come from. Section C (manufacturing) at 2022 in
  `supabase/seed-data/benchmarks.csv`: p25 34.9, median 49.9, p75 66.4 accidents per 1 000 FTE.
  The company's marked value is the p75 of that same row, because the worked example the page
  already carries one section above ("A 120 person metal fabricator ... about CHF 148 000 a year")
  is computed at exactly that rate. So the band and the sentence describe one company, and a
  change to the seed CSV moves both or neither -- there is no third invented figure here.
*/
export const PEERS = { p25: 34.9, median: 49.9, p75: 66.4 } as const;
export const COMPANY_RATE = 66.4;
/** The row the figures above are copied from, so a test can find it in the seed CSV. */
export const PEER_ROW = {
  kpi_key: "accident_rate_per_1000_fte",
  industry_section: "C",
  size_band: "all",
  period_year: 2022,
} as const;

/** The worked example's yearly incident cost in CHF, the figure `landing.points.sentence` prints. */
const EXAMPLE_COST_CHF = 595_853;

/**
 * The photography per step, from the campaign deck already in `public/campaign/`. Only the two
 * steps without a screen take one: looking a company up pictures the workwear of the company
 * being looked up, and the site visit pictures the senior expert who makes it.
 *
 * Both are shot the campaign way, cut out on white, so both are set `object-contain` on the pure
 * white ground the campaign pieces use rather than cropped to fill a panel: `cover` on a full
 * length coverall keeps a torso and two legs, which reads as a pair of trousers. `grayscale`
 * follows the imagery rule (docs/design.md, Brand) rather than the slot -- a photograph of a
 * person is black and white, a cut out object keeps its colour, so the expert is desaturated and
 * the coverall's reflective stripes stay orange.
 */
const PHOTOS = {
  lookup: {
    src: "/campaign/dresscode.jpg",
    width: 933,
    height: 1400,
    grayscale: false,
  },
  expert: {
    src: "/campaign/graue-haare.jpg",
    width: 800,
    height: 1066,
    grayscale: true,
  },
} as const;

/**
 * The steps whose still is a photograph, and so runs past the frame's bottom edge rather than
 * ending in a border. A card still (the benchmark, the packages) is a fixed set of rows and must
 * size to them: stretched to the frame it would show a large empty floor inside its own border,
 * which reads as a fault rather than as a crop. Pure.
 */
export function stepVisualBleeds(step: StepVisualKey): boolean {
  return step === "lookup" || step === "expert";
}

export type StepVisualProps = {
  readonly step: StepVisualKey;
  readonly className?: string;
};

/**
 * The picture beside one step of "How it works" (2026-09-10). Two of the four steps have a real
 * screen and are drawn from that screen's own components and strings -- the benchmark from
 * `QuartileBand` and the `benchmark.card.*` keys, the package from `PACKAGES` -- so the page shows
 * the product rather than describing it and the picture cannot drift from the screen it pictures
 * (docs/design.md, hero object). The other two have no screen to show: step 01's screen is the
 * hero object a few hundred pixels above, and a site visit is not a screen at all, so they take
 * campaign photography rather than an invented screenshot, which is the mistake `HeroBenchmark`
 * was removed for.
 *
 * Every still is `inert` under one `role="img"` whose label says what it is a picture of, so
 * nothing inside takes focus, answers a click or reaches the accessibility tree, and no figure
 * inside is read out as though it were the reader's own. Server component.
 */
export async function StepVisual({ step, className }: StepVisualProps) {
  const [t, card, packages, format] = await Promise.all([
    getTranslations("marketing.landing.how.visual"),
    getTranslations("benchmark.card"),
    getTranslations("marketing.packages"),
    getFormatter(),
  ]);

  const photo = step === "lookup" || step === "expert" ? PHOTOS[step] : null;
  if (photo) {
    return (
      <div
        role="img"
        aria-label={t(`${step}.alt`)}
        // The pure white ground of a campaign piece, in both themes: these objects were cut out
        // on white, so on the jet ground they would otherwise float in a black box with a white
        // halo. `text-jet` is inherited by nothing here but keeps the block honest if copy is
        // ever added to it.
        className={cn(
          // Wide and open ended: the still fills the column and runs past the frame's bottom
          // edge, so it is cropped by the viewport rather than sitting inside a square. `h-full`
          // with `min-h-80` keeps it tall on a short viewport, where the frame has little to give.
          "flex h-full min-h-80 items-end justify-center overflow-hidden border-t bg-pure-white px-10 pt-10",
          className,
        )}
      >
        <Image
          src={photo.src}
          alt=""
          width={photo.width}
          height={photo.height}
          sizes="(min-width: 1024px) 44rem, (min-width: 768px) 60vw, 90vw"
          loading="lazy"
          // `object-top` with `object-contain`: when the frame is shorter than the photograph the
          // crop takes the feet, not the face.
          className={cn("size-full object-contain object-top", photo.grayscale && "grayscale")}
        />
      </div>
    );
  }

  if (step === "benchmark") {
    return (
      <div
        inert
        role="img"
        aria-label={t("benchmark.alt")}
        // No border of its own: from `lg` this sits inside the section's framed panel, and a card
        // outline a few pixels in from the frame's own reads as a box drawn twice. The card is
        // held by the panel and separated from the sentence above it by its own top rule instead.
        className={cn("flex flex-col gap-6 border-t bg-background py-8", className)}
      >
        <div className="flex flex-col gap-1">
          <p className="font-medium text-sm">{card("title")}</p>
          <p className="font-semibold text-4xl tabular-nums tracking-headline lg:text-5xl">
            {format.number(EXAMPLE_COST_CHF, {
              style: "currency",
              currency: "CHF",
              maximumFractionDigits: 0,
            })}
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t pt-5">
          <p className="text-muted-foreground text-xs">{t("benchmark.kpi")}</p>
          {/*
            The real `QuartileBand` from the dashboard, on the real section C row. Its own drawing
            is `aria-hidden` and its `label` is the `sr-only` sentence it always carries; the whole
            still is hidden from assistive tech anyway, so the label is there to keep the
            component's contract rather than to be read.
          */}
          <QuartileBand
            p25={PEERS.p25}
            median={PEERS.median}
            p75={PEERS.p75}
            value={COMPANY_RATE}
            label={t("benchmark.alt")}
            className="max-w-none"
          />
          <p className="font-mono text-muted-foreground text-xs tabular-nums">
            {t("benchmark.quartiles", {
              p25: format.number(PEERS.p25, { maximumFractionDigits: 1 }),
              median: format.number(PEERS.median, { maximumFractionDigits: 1 }),
              p75: format.number(PEERS.p75, { maximumFractionDigits: 1 }),
            })}
          </p>
        </div>
      </div>
    );
  }

  // The three fixed price packages in the ladder's own order, at their real prices.
  const priced = PACKAGES.filter((entry) => entry.priceChf !== null);
  return (
    <div
      inert
      role="img"
      aria-label={t("package.alt")}
      // Same as the benchmark card: the panel frames it, so the ladder keeps only the rules that
      // divide one rung from the next and the top rule that divides it from the sentence.
      className={cn("flex flex-col divide-y border-t bg-background", className)}
    >
      {priced.map((entry, index) => (
        <div
          key={entry.key}
          className={cn(
            "flex items-baseline justify-between gap-4 py-6",
            // The middle rung sits in the accent-free equivalent of a highlight: the palette has
            // no accent hue (docs/design.md, rule 3), so "picked" is a ground change, not a colour.
            index === 1 && "bg-muted px-4",
          )}
        >
          <span className="font-medium text-base">{packages(`${entry.key}.shortName`)}</span>
          <span className="font-semibold text-base tabular-nums">
            {format.number(entry.priceChf ?? 0, {
              style: "currency",
              currency: "CHF",
              maximumFractionDigits: 0,
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
