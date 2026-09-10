import { getTranslations } from "next-intl/server";
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
        // `border-t` is the rule every real still carried, kept here for the same reason: without
        // it the grey meets the sentence above with no edge, and a ground change alone reads as
        // the panel discolouring rather than as a picture beginning. It is the placeholder's one
        // piece of drawing, and it is the piece that says "something belongs here".
        "w-full border-t bg-muted",
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
        className,
      )}
    />
  );
}
