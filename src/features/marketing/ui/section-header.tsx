import { Statement } from "@/components/brand/statement";
import { cn } from "@/lib/utils";

/** The rhythm tier of a marketing section (docs/design.md, marketing section vocabulary). */
export type SectionTier = "anchor" | "major" | "minor";

export type SectionHeaderProps = {
  readonly tier: SectionTier;
  /** Caps label above the heading. Anchors and majors only; a minor never carries one. */
  readonly eyebrow?: string;
  readonly title: string;
  readonly lead?: string;
  /** `h1` on the page opener, `h2` everywhere else. */
  readonly as?: "h1" | "h2";
  /** The id an owning `section` points at with `aria-labelledby`. */
  readonly id?: string;
  readonly className?: string;
};

/**
 * The opener of a marketing section (docs/design.md, marketing section vocabulary): the tier
 * picks the shape, so a page decides weight once and the heading size, the layout and the eyebrow
 * all follow. Anchor stacks left, major splits the heading from the lead, minor runs inline under
 * a hairline. Server component.
 */
export function SectionHeader({
  tier,
  eyebrow,
  title,
  lead,
  as = "h2",
  id,
  className,
}: SectionHeaderProps) {
  const heading = (
    <Statement
      as={as}
      id={id}
      text={title}
      className={cn(
        tier === "anchor" && "max-w-4xl text-display-sm md:text-display-lg",
        tier === "major" && "text-display-sm md:text-display",
        tier === "minor" && "font-semibold text-2xl tracking-headline md:text-display-sm",
      )}
    />
  );

  if (tier === "minor") {
    return (
      <div
        className={cn(
          "grid gap-4 border-t pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10",
          className,
        )}
      >
        {heading}
        {lead ? <p className="max-w-prose text-muted-foreground">{lead}</p> : null}
      </div>
    );
  }

  if (tier === "major") {
    return (
      <div
        className={cn("grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-10", className)}
      >
        <div className="flex flex-col gap-3">
          {eyebrow ? <p className="eyebrow text-muted-foreground">{eyebrow}</p> : null}
          {heading}
        </div>
        {lead ? <p className="max-w-prose self-end text-lg text-muted-foreground">{lead}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {eyebrow ? <p className="eyebrow text-muted-foreground">{eyebrow}</p> : null}
      {heading}
      {lead ? <p className="max-w-prose text-lg text-muted-foreground">{lead}</p> : null}
    </div>
  );
}
