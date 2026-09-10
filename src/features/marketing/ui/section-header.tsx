import { Statement } from "@/components/brand/statement";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The rhythm tier of a marketing section (docs/design.md, marketing section vocabulary). */
export type SectionTier = "anchor" | "major" | "minor";

export type SectionHeaderProps = {
  readonly tier: SectionTier;
  /** Caps label above the heading. Anchors and majors only; a minor never carries one. */
  readonly eyebrow?: string;
  readonly title: string;
  readonly lead?: string;
  /**
   * Renders the eyebrow as a pill and drops the heading's closing sentences to the muted colour,
   * so one heading carries the claim and the line that would otherwise sit beside it as a lead
   * (the shape of the reference the owner brought on 2026-09-10). Majors only, and the section
   * passes no `lead` with it -- the count says how many opening sentences stay at full strength.
   */
  readonly emphasis?: { readonly leadSentences: number };
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
 * a hairline. `emphasis` overrides the tier's layout with the pill and two tone heading shape.
 * Server component.
 */
export function SectionHeader({
  tier,
  eyebrow,
  title,
  lead,
  emphasis,
  as = "h2",
  id,
  className,
}: SectionHeaderProps) {
  const heading = (
    <Statement
      as={as}
      id={id}
      text={title}
      // The emphasis heading runs on as prose rather than breaking at every sentence: its whole
      // point is that the claim and its answer read as one paragraph of display type.
      layout={emphasis ? "flow" : "line"}
      leadSentences={emphasis?.leadSentences}
      className={cn(
        // The page opener carries the ceiling weight (600), so the one h1 on a marketing page
        // sits heavier than the h2 section headings that follow it, which keep the display
        // tokens' own 450. Owner decision of 2026-09-10.
        as === "h1" && "font-semibold",
        tier === "anchor" && "max-w-4xl text-display-sm md:text-display-lg",
        tier === "major" && "text-display-sm md:text-display",
        tier === "minor" && "font-semibold text-2xl tracking-headline md:text-display-sm",
        // A measure the two tone heading needs and the split major does not: the heading is the
        // whole width of the band here, so without a cap the muted half runs to a line length
        // display type cannot hold.
        emphasis && "max-w-5xl",
      )}
    />
  );

  /*
    The emphasis shape (owner decision of 2026-09-10, from the reference they brought): the label
    is a pill rather than a bare caps line, the heading carries its own lead in the muted colour,
    and nothing sits beside it. It stacks like an anchor rather than splitting like a major,
    because there is no second column left to split into.

    The pill takes the brand accent (owner decision, 2026-09-10, amending rule 3). It was
    `secondary` until then, on the reading that rule 3 forbade the reference's blue outright; the
    rule now carries a named exception for one decorative hue, so the shape and the hue are both
    borrowed. It is `--brand-accent`, not `--info`: the pill labels a section and never reports a
    state, and the Notice status has to keep meaning exactly that.
  */
  if (emphasis) {
    return (
      <div className={cn("flex flex-col items-start gap-5", className)}>
        {eyebrow ? (
          <Badge variant="brand-accent" className="eyebrow h-auto px-2.5 py-1">
            {eyebrow}
          </Badge>
        ) : null}
        {heading}
      </div>
    );
  }

  if (tier === "minor") {
    return (
      <div
        className={cn("grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10", className)}
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
          {eyebrow ? <p className="eyebrow text-brand-accent">{eyebrow}</p> : null}
          {heading}
        </div>
        {lead ? <p className="max-w-prose self-end text-lg text-muted-foreground">{lead}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {eyebrow ? <p className="eyebrow text-brand-accent">{eyebrow}</p> : null}
      {heading}
      {lead ? <p className="max-w-prose text-lg text-muted-foreground">{lead}</p> : null}
    </div>
  );
}
