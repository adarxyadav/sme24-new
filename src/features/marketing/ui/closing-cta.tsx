import { RuledField } from "@/components/brand/ruled-field";
import { Statement } from "@/components/brand/statement";
import { cn } from "@/lib/utils";

export type ClosingCtaProps = {
  readonly title: string;
  readonly lead?: string;
  /**
   * Centres the block and puts the ruled ground behind it, which is the landing page's own
   * bookend: the page opens on a centred statement over the ruled field and closes on the same
   * shape inverted. The inner pages keep the left aligned block, where the closing is one more
   * section rather than the answer to the hero.
   */
  readonly centered?: boolean;
  /** The call to action: the lookup field on the landing page, a button elsewhere. */
  readonly children: React.ReactNode;
};

/**
 * The closing call to action of a marketing page (spec 0009, page composition; docs/design.md,
 * tier map): an anchor on the inverse block with the action under it, so every page ends on the
 * same weight it opened with rather than on another major. Server component.
 *
 * `centered` is the landing page's bookend (owner decision, 2026-09-10, from a reference they
 * brought). The reference closes on a full bleed band -- one statement, one lead, one framed
 * action, centred, with room around all three -- and what carries it there is a photograph under a
 * gradient. This brand is black and white (docs/design.md, rule 3), so the composition is taken
 * and the ground is not: the texture is the `RuledField` the hero already opens the page with,
 * inverted here. Borrowing the reference's gradient would have spent a hue the palette does not
 * have on decoration, which is the one thing rule 3 forbids outright.
 *
 * The padding is the anchor tier's `py-24 md:py-40` (docs/design.md, tiers) at the top and two
 * steps less at the bottom in the left aligned shape, which is the one place this block departs
 * from an opener's rhythm and the reason it needs one: an opener is followed by the section it
 * opens, so its lower padding is read as the space before that section. The closing block is
 * followed by the footer, so the same figure landed as roughly 170px of empty jet under the
 * control and the band read as a layout that had lost its content rather than as a deliberate
 * bookend. Trimming only the bottom keeps the heading's entry weight and the tier's top rhythm
 * untouched. The centred shape takes its padding back to even, because there the space under the
 * control is what the composition is made of rather than a remainder.
 *
 * The group is the anchor opener's `gap-6` rather than `gap-8`: at `line-height: 1` the display
 * heading's box already clears about 15px under its baseline, so the wider gap broke the statement
 * and its control into two objects instead of one group. The left aligned shape keeps both flush
 * left -- `Statement` gives every sentence its own line, so centring strands a short closing
 * sentence on a line of its own, which is exactly why the centred shape sets the heading to run on
 * as prose (`layout="flow"`) instead.
 *
 * The full width hairline is what makes the block a bookend in dark mode: the inverse ground is jet
 * in both themes, so on a jet page it equals the page ground and the block would otherwise have no
 * edge at all. It is drawn inside the `dark` element rather than on it, because the `dark` variant
 * is descendant only (`&:is(.dark *)` in `globals.css`), so a border on the section itself would
 * take the outer theme's `--border` and disappear into the light page instead.
 */
export function ClosingCta({ title, lead, centered = false, children }: ClosingCtaProps) {
  const body = (
    <div
      className={cn(
        "mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6",
        centered
          ? "items-center py-28 text-center md:py-40"
          : "items-start pt-24 pb-16 md:pt-40 md:pb-24",
      )}
    >
      <Statement
        as="h2"
        id="closing-heading"
        text={title}
        // The centred shape runs the statement on as one paragraph rather than breaking at every
        // sentence: "See what your risk costs. Free." is two sentences and reads as the reference's
        // single centred line only when it is allowed to be one.
        layout={centered ? "flow" : "line"}
        className={cn(
          "text-display-sm md:text-display-lg",
          centered ? "max-w-3xl text-balance" : "max-w-4xl",
        )}
      />
      {lead ? (
        <p
          className={cn(
            "text-lg text-muted-foreground",
            // Held under the statement's own measure so the lead sits as a block beneath it,
            // the shape the hero's lead already takes.
            centered ? "max-w-xl text-balance" : "max-w-prose",
          )}
        >
          {lead}
        </p>
      ) : null}
      {/* The action gets its own space in the centred shape: the reference sets the button well
          clear of the copy, which is what stops the three parts reading as one stacked lump. */}
      <div className={cn("flex w-full flex-col items-center", centered && "mt-4")}>{children}</div>
    </div>
  );

  return (
    <section aria-labelledby="closing-heading" className="dark bg-background text-foreground">
      <div className="border-t" />
      {/* `align="center"` holds the rules back from the middle of the block, where the statement
          and the control sit, so the texture reads at the margins and never crosses the type.

          Damped hard on this block alone. The off hero field runs its rules at the full border
          token, which is right on the light ground the other two ruled sections sit on -- but this
          one is jet, and `--color-border` inverts with the block to a value bright enough that the
          rules stop being texture and start reading as a drawn grid over the statement. At 10% the
          reader feels the ground is ruled without being able to look straight at a line, which is
          the whole job of texture (owner decision, 2026-09-10: felt, not seen). It is set here
          rather than in `RuledField` because the component is correct as it stands for every light
          ground caller; what changed is the ground, so the correction belongs to the block that
          changed it. */}
      {centered ? (
        <RuledField align="center" className="[&>[aria-hidden]]:opacity-10">
          {body}
        </RuledField>
      ) : (
        body
      )}
    </section>
  );
}
