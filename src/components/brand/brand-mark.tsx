import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The SME24 monogram traced from the brand guidelines (v1.0, section 02) on a 30 × 40 grid: two
 * columns, the small square inside the opening, the crossbar, the stem and the base. Swap this
 * string for the path in the official asset kit (service@sme24.ch) when it arrives; nothing else
 * changes.
 */
export const MARK_PATH =
  "M0 0h9v23H0zM21 0h9v23h-9zM12 5h6v6h-6zM9 15h12v8H9zM12 23h6v9h-6zM0 32h30v8H0z";

export const MARK_VIEWBOX = "0 0 30 40";

export type BrandMarkVariant = "bare" | "badge" | "keyline";

export type BrandMarkProps = {
  /** `bare` in lockups and beside text; `badge` (solid circle) and `keyline` stand alone. */
  readonly variant?: BrandMarkVariant;
  /** Accessible name. Omit when the mark is decorative next to the visible product name. */
  readonly title?: string;
  readonly className?: string;
};

type SvgProps = {
  readonly title?: string;
  readonly viewBox: string;
  readonly className?: string;
  readonly children: React.ReactNode;
};

/** Decorative unless a title is given; then it is an image named by that title. */
function Svg({ title, viewBox, className, children }: SvgProps) {
  if (title) {
    return (
      <svg role="img" aria-label={title} viewBox={viewBox} className={className}>
        <title>{title}</title>
        {children}
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox={viewBox} className={className}>
      {children}
    </svg>
  );
}

/**
 * The brand mark in its two approved forms. Draws with `currentColor`, so `text-*` picks the
 * color and the badge knocks the mark out of the circle (whatever ground is behind shows
 * through), which keeps every approved variant a matter of text and background utilities.
 * Never recolored, stretched, rotated or given effects. Server or browser.
 */
export function BrandMark({ variant = "bare", title, className }: BrandMarkProps) {
  const maskId = useId();

  if (variant === "bare") {
    return (
      <Svg
        title={title}
        viewBox={MARK_VIEWBOX}
        className={cn("h-8 w-auto shrink-0 fill-current", className)}
      >
        <path d={MARK_PATH} />
      </Svg>
    );
  }

  // The mark occupies 56% of the circle's height, as in the approved circled badge.
  const inner = <path d={MARK_PATH} transform="translate(18.5 14) scale(0.9)" />;

  return (
    <Svg
      title={title}
      viewBox="0 0 64 64"
      className={cn("size-8 shrink-0 fill-current", className)}
    >
      {variant === "badge" ? (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect width="64" height="64" fill="white" />
            <g fill="black">{inner}</g>
          </mask>
          <circle cx="32" cy="32" r="32" mask={`url(#${maskId})`} />
        </>
      ) : (
        <>
          <circle cx="32" cy="32" r="30.5" fill="none" stroke="currentColor" strokeWidth="3" />
          {inner}
        </>
      )}
    </Svg>
  );
}
