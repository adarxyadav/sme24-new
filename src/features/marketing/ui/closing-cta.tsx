import { Statement } from "@/components/brand/statement";

export type ClosingCtaProps = {
  readonly title: string;
  readonly lead?: string;
  /** The call to action: the lookup field on the landing page, a button elsewhere. */
  readonly children: React.ReactNode;
};

/**
 * The closing call to action of a marketing page (spec 0009, page composition; docs/design.md,
 * tier map): an anchor on the inverse block with the action under it, so every page ends on the
 * same weight it opened with rather than on another major. Server component.
 *
 * The padding is the anchor tier's `py-24 md:py-40` (docs/design.md, tiers) at the top and two
 * steps less at the bottom, which is the one place this block departs from an opener's rhythm and
 * the reason it needs one: an opener is followed by the section it opens, so its lower padding is
 * read as the space before that section. The closing block is followed by the footer, so the same
 * figure landed as roughly 170px of empty jet under the control and the band read as a layout that
 * had lost its content rather than as a deliberate bookend. Trimming only the bottom keeps the
 * heading's entry weight and the tier's top rhythm untouched.
 *
 * The group is the anchor opener's `gap-6` rather than `gap-8`: at `line-height: 1` the display
 * heading's box already clears about 15px under its baseline, so the wider gap broke the statement
 * and its control into two objects instead of one group. Both stay left aligned -- `Statement`
 * gives every sentence its own line, so centring strands a short closing sentence on a line of its
 * own, and the landing page's `CompanyLookupField` carries a left aligned label.
 *
 * The full width hairline is what makes the block a bookend in dark mode: the inverse ground is jet
 * in both themes, so on a jet page it equals the page ground and the block would otherwise have no
 * edge at all. It is drawn inside the `dark` element rather than on it, because the `dark` variant
 * is descendant only (`&:is(.dark *)` in `globals.css`), so a border on the section itself would
 * take the outer theme's `--border` and disappear into the light page instead.
 */
export function ClosingCta({ title, lead, children }: ClosingCtaProps) {
  return (
    <section aria-labelledby="closing-heading" className="dark bg-background text-foreground">
      <div className="border-t" />
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 pt-24 pb-16 sm:px-6 md:pt-40 md:pb-24">
        <Statement
          as="h2"
          id="closing-heading"
          text={title}
          className="max-w-4xl text-display-sm md:text-display-lg"
        />
        {lead ? <p className="max-w-prose text-lg text-muted-foreground">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}
