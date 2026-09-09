import { type PackageKey, sortedPackages } from "@/features/marketing/packages";
import { PackageCard, type PackageCardProps } from "./package-card";

/**
 * The package the ladder leads with. The middle rung: the one that validates real risks rather
 * than the cheapest look or the largest bill, so the ladder has a first step to read from. A
 * marketing decision, so it lives here beside the grid rather than in `PACKAGES`, which feature 11
 * promotes into the `packages` table.
 */
const FEATURED: PackageKey = "sms";

/**
 * The four packages side by side in catalog order (spec 0009, AC-5, AC-6), each card standing on
 * its own hairline with a gap between them, two columns on small screens and four on large ones.
 * The cards are separate rather than edge to edge in one ruled block (the shape until 2026-09-09)
 * because four packages are four things to choose between, and a shared hairline reads as one
 * table: the gap is what makes them comparable objects rather than columns of the same object.
 * The corners stay square and the surface flat, the way `docs/design.md` fixes every surface.
 *
 * The grid owns the rows -- the marker, the name, the best for and delivery lines, the amount, the
 * VAT note, the call to action and, on the full variant, the details -- and each card spans them
 * through `grid-rows-subgrid`, so the prices sit on one baseline and the buttons on another
 * however long a package name runs.
 *
 * The row tracks are the reason the cards need no invisible placeholder text: a card with no
 * marker and no VAT note simply leaves its share of those rows empty, and the rows keep their
 * height from the tallest card in the row rather than from a full stop nobody can see. The marker
 * row is the one a card always renders (empty when it is not the marked one), because at `sm` the
 * four cards sit in two grid rows and only one of those rows holds the marked card: an `auto`
 * track with nothing in it collapses, and that pair's names would sit higher than the other's.
 * Server component.
 */
export function PackagesGrid({ variant = "full" }: Pick<PackageCardProps, "variant">) {
  const full = variant === "full";
  return (
    <ul
      className={[
        "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
        // One track per stacked card below `sm`, then the tracks the cards subgrid into.
        full
          ? "grid-rows-[repeat(8,auto)] sm:grid-rows-[repeat(16,auto)] lg:grid-rows-[repeat(8,auto)]"
          : "grid-rows-[repeat(5,auto)] sm:grid-rows-[repeat(10,auto)] lg:grid-rows-[repeat(5,auto)]",
      ].join(" ")}
    >
      {sortedPackages().map((entry) => (
        <li
          key={entry.key}
          className={
            full ? "row-span-8 grid grid-rows-subgrid" : "row-span-5 grid grid-rows-subgrid"
          }
        >
          <PackageCard entry={entry} variant={variant} featured={entry.key === FEATURED} />
        </li>
      ))}
    </ul>
  );
}
