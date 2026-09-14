import { cn } from "@/lib/utils";

/**
 * A corner bracket: two hairlines meeting at a right angle. Sits over a block's own `border`
 * hairline at a stronger value, so the block stays framed like every other one and is only marked
 * out at its corners.
 */
const BRACKET = "pointer-events-none absolute size-5 border-foreground/40";

/*
  The brackets sit ON the framed element's border box, not one pixel outside it. They were at
  `-top-px -left-px` until 2026-09-14, which put a 1px line one pixel clear of the 1px hairline it
  is meant to cover: wherever the block's own top or left landed on a fractional CSS pixel -- which
  a centred `max-w-*` column inside a `px-4 sm:px-6` gutter does at plenty of viewport widths --
  the two rounded to different device pixel rows and the corner read as two parallel hairlines
  rather than one darker stroke. At `top-0 left-0` the bracket occupies the same row as the border
  whatever the rounding, and because it is the darker value it simply wins there.
*/
const CORNERS = [
  "top-0 left-0 border-t border-l",
  "top-0 right-0 border-t border-r",
  "bottom-0 left-0 border-b border-l",
  "bottom-0 right-0 border-b border-r",
] as const;

export type CornerBracketsProps = {
  /** Extra classes for every bracket, e.g. the transition and hover state of a card that reveals them. */
  readonly className?: string;
};

/**
 * The four corner brackets of a marketing block (`docs/design.md`, the trust band). The caller
 * owns the positioning context: put them inside a `relative` box that carries the `border` they
 * sit over. They are decorative, so each is `aria-hidden` and none is focusable.
 *
 * Shared by the trust band, which shows them at rest, and the package card, which fades them in on
 * hover; the four offsets live here once so the two never drift apart. Server component.
 */
export function CornerBrackets({ className }: CornerBracketsProps) {
  return (
    <>
      {CORNERS.map((corner) => (
        <span key={corner} aria-hidden="true" className={cn(BRACKET, corner, className)} />
      ))}
    </>
  );
}
