import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { BenchmarkCard } from "@/features/marketing/ui/benchmark-card";
import { LookupCard } from "@/features/marketing/ui/lookup-card";
import { PackagesCard } from "@/features/marketing/ui/packages-card";
import { cn } from "@/lib/utils";

/** The step keys that carry a visual, in the landing page's own order. */
export type StepVisualKey = "lookup" | "benchmark" | "package" | "expert";

/**
 * Whether this step's still runs past the frame's bottom edge rather than ending in a border.
 *
 * Every step's placeholder does, for now: a reserved frame that stopped short would leave a strip
 * of empty panel below it, which reads as a gap rather than as a picture yet to come. It stays a
 * function rather than becoming a constant because the answer is per step again the moment real
 * artwork lands -- a photograph bleeds, a card sized to its own rows does not. Pure.
 */
export function stepVisualBleeds(_step: StepVisualKey): boolean {
  return true;
}

export type StepVisualProps = {
  readonly step: StepVisualKey;
  /**
   * The still travels with its own step down a stacked column rather than filling the pinned
   * panel's right hand side. It then reserves a band rather than a screen: four stills at the
   * pinned column's height turned the section into four screens of grey on a phone, one per step,
   * with the copy pushed apart by a placeholder taller than any of it.
   */
  readonly stacked?: boolean;
  readonly className?: string;
};

/**
 * The placeholder standing in for one step's still (owner decision, 2026-09-10). The four real
 * stills -- two campaign photographs and two cards drawn from the product's own components -- were
 * removed while the art direction is decided, and this reserves the space they will return to:
 * the frame keeps its proportions, so the section's layout is already the layout the artwork will
 * land in and nothing shifts when it does.
 *
 * It is deliberately empty rather than labelled. A placeholder that announces itself ("image")
 * is a note to the team rendered to the visitor, and the panel reads as unfinished either way;
 * a plain reserved ground reads as a picture that has not loaded, which is the smaller error to
 * make in front of a buyer.
 *
 * `role="img"` with the step's own alt text is kept, so the accessibility tree still says what
 * belongs here rather than exposing an unlabelled decorative box -- and so restoring the artwork
 * is a change of what is drawn, not of what is announced. Server component.
 */
export async function StepVisual({ step, stacked = false, className }: StepVisualProps) {
  const t = await getTranslations("marketing.landing.how.visual");

  return (
    <div
      inert
      role="img"
      aria-label={t(`${step}.alt`)}
      className={cn(
        // The reserved ground: the muted token rather than a hand mixed grey, so it follows the
        // palette in both themes (docs/design.md).
        //
        // No rule above it (owner decision, 2026-09-10). It carried `border-t` until then, on the
        // reasoning that the grey needed an edge or it would read as the panel discolouring rather
        // than as a picture beginning. Once the step's copy and its still were set apart by the
        // column's own `gap-8`, that rule stopped reading as the picture's top edge and started
        // reading as a stray divider sitting on top of the block. The gap is the separation now,
        // and the ground change alone is enough to say a picture begins here.
        "w-full bg-muted",
        // Filling the pinned panel's right column, where `min-h-80` keeps the frame a picture's
        // shape on a short viewport and the panel crops whatever runs past its bottom edge.
        !stacked && "h-full min-h-80",
        // Stacked under its own step, where nothing crops it and the height is the whole cost.
        // A 16:9 band is a picture's proportion and a quarter of a phone screen rather than most
        // of it, so the four steps stay a readable sequence instead of four screens of grey. The
        // cap is what keeps that true once the column is wide: 16:9 of a 1100px panel is 619px,
        // taller than the phone placeholder it replaced, so the aspect gives way to a fixed band
        // as soon as holding the ratio would cost more height than the copy it illustrates.
        stacked && "aspect-video max-h-64",
        // A step whose card exists centres it inside the ground rather than filling it, so the
        // reserved frame still reads as the picture and the card as the thing pictured.
        (step === "lookup" || step === "benchmark" || step === "package") &&
          "grid place-items-center p-6 sm:p-10",
        // The photograph is centred inside the ground like the cards, not bled to the frame's
        // edges: the four steps are one row of stills, and a picture that filled its frame while
        // the other three sat inside theirs read as a different kind of object.
        step === "expert" && "grid place-items-center p-6 sm:p-10",
        className,
      )}
    >
      {/*
        The steps whose stills exist already: the first three each picture a screen this repo owns,
        so the picture is the component rather than a rendering of it -- the lookup form the hero
        object also shows, the benchmark result it produces, and the packages read off the real
        catalogue. The fourth is a photograph, below.

        Held to a measure and never stretched: a card that filled the ground would be the picture
        instead of sitting inside it, and at the pinned panel's width the cards' own controls would
        run to a length the real screens never show them at.
      */}
      {step === "lookup" ? <LookupCard className="w-full max-w-md shadow-sm" /> : null}
      {step === "benchmark" ? <BenchmarkCard className="w-full max-w-md shadow-sm" /> : null}
      {/* Wider than the single card steps: this one pictures a row of three cards being compared,
          which is the whole point of the step, so it takes the frame's width rather than a card's
          measure. */}
      {step === "package" ? <PackagesCard className="max-w-3xl" /> : null}
      {/*
        The one step pictured by a photograph rather than by the product: the expert is a person,
        and no screen in this repo shows one. It is Philipp, the same picture the About page runs,
        under the brand's imagery rule -- photographs of people and places are black and white
        (docs/design.md, Brand), which is why the colour original is desaturated here rather than a
        second grayscale file being checked in.

        `object-cover` with `fill`: the frame is a landscape crop of a portrait photograph, so the
        picture is cropped to the frame rather than letterboxed inside it, and `object-top` keeps
        the crop on the person instead of centring it on the floor. The `alt` is empty because the
        wrapper already carries the step's own `aria-label` and announces the whole block as one
        image -- a second description here would have a screen reader say it twice.
      */}
      {step === "expert" ? (
        // Held to the single card steps' own `max-w-md` so the four stills are one family, and
        // given the photograph's own portrait ratio rather than a crop: at this measure there is
        // room for the whole frame, so nothing has to be cut off the person.
        <Image
          src="/campaign/philipp.webp"
          alt=""
          width={900}
          height={1200}
          sizes="(min-width: 1024px) 28rem, 100vw"
          className="max-h-full w-full max-w-md object-contain grayscale"
        />
      ) : null}
    </div>
  );
}
