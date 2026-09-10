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
export async function StepVisual({ step, className }: StepVisualProps) {
  const t = await getTranslations("marketing.landing.how.visual");

  return (
    <div
      inert
      role="img"
      aria-label={t(`${step}.alt`)}
      className={cn(
        // The reserved ground: the muted token rather than a hand mixed grey, so it follows the
        // palette in both themes (docs/design.md). `min-h-80` keeps the frame a picture's shape
        // on a short viewport, where the panel has little height to give it.
        "h-full min-h-80 w-full bg-muted",
        className,
      )}
    />
  );
}
