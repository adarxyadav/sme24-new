import { sortedPackages } from "@/features/marketing/packages";
import { PackageCard, type PackageCardProps } from "./package-card";

/**
 * The four packages side by side in catalog order (spec 0009, AC-5, AC-6), each card standing on
 * its own hairline with a gap between them, two columns on small screens and four on large ones.
 * The cards are separate rather than edge to edge in one ruled block (the shape until 2026-09-09)
 * because four packages are four things to choose between, and a shared hairline reads as one
 * table: the gap is what makes them comparable objects rather than columns of the same object.
 * The corners stay square and the surface flat, the way `docs/design.md` fixes every surface.
 *
 * No card is marked out as the one to pick (owner decision of 2026-09-10): the four are a ladder
 * to read across, and singling one out put a thumb on the scale of the buyer's decision.
 *
 * The grid owns the rows -- the name, the best for and delivery lines, the amount, the VAT note,
 * the call to action and, on the full variant, the details -- and each card spans them through
 * `grid-rows-subgrid`, so the prices sit on one baseline and the buttons on another however long a
 * package name runs. The row tracks are also the reason the cards need no invisible placeholder
 * text: a card with no VAT note simply leaves its share of that row empty, and the row keeps its
 * height from the tallest card beside it rather than from a full stop nobody can see.
 * Server component.
 */
export function PackagesGrid({ variant = "full" }: Pick<PackageCardProps, "variant">) {
  const full = variant === "full";
  return (
    <ul
      className={[
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
        // One track per stacked card below `sm`, then the tracks the cards subgrid into.
        //
        // The first track is `minmax(3rem,auto)` -- two lines of the name at `heading-16` and its
        // 1.5 leading -- so a card whose name runs to one line leaves the second line empty rather
        // than pulling the promise below it upwards. That is what puts every promise on the same
        // baseline across the row, whatever the length of the name above it.
        full
          ? "grid-rows-[repeat(8,auto)] sm:grid-rows-[repeat(16,auto)] lg:grid-rows-[minmax(3rem,auto)_repeat(7,auto)]"
          : // The landing cards also run taller than their content needs, because a price deserves
            // a tall quiet card rather than a tight one: the room around the amount is what makes
            // it read as a considered figure instead of a line item. That height goes on the track
            // between the VAT note and the action, so it opens as space under the price rather
            // than as padding at the foot of the card. It has to live here rather than as a
            // `min-h` on the card, because a subgrid child takes its height from these tracks and
            // cannot stretch them from the inside.
            "grid-rows-[repeat(5,auto)] sm:grid-rows-[repeat(10,auto)] lg:grid-rows-[minmax(3rem,auto)_auto_auto_minmax(3.5rem,auto)_auto]",
      ].join(" ")}
    >
      {sortedPackages().map((entry) => (
        <li
          key={entry.key}
          className={
            full ? "row-span-8 grid grid-rows-subgrid" : "row-span-5 grid grid-rows-subgrid"
          }
        >
          <PackageCard entry={entry} variant={variant} />
        </li>
      ))}
    </ul>
  );
}
