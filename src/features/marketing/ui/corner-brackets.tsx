import { cn } from "@/lib/utils";

/**
 * A corner bracket: two hairlines meeting at a right angle. Sits over a block's own `border`
 * hairline at a stronger value, so the block stays framed like every other one and is only marked
 * out at its corners.
 */
const BRACKET = "pointer-events-none absolute size-5 border-foreground/40";

const CORNERS = [
  "-top-px -left-px border-t border-l",
  "-top-px -right-px border-t border-r",
  "-bottom-px -left-px border-b border-l",
  "-bottom-px -right-px border-b border-r",
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
