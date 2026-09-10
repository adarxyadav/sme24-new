import { fixedPricePackages } from "@/features/marketing/packages";
import { PackageCard } from "@/features/marketing/ui/package-card";
import { cn } from "@/lib/utils";

/**
 * A still of the packages the reader picks between, drawn from the real `PackageCard` and the real
 * `PACKAGES` catalogue, so the prices in the picture are the prices on the page and a change to
 * the catalogue moves both.
 *
 * The three fixed price packages only (`fixedPricePackages`), not the four `PackagesGrid` shows:
 * the fourth is the implementation partner, which carries no price and is sold by conversation, so
 * in a still whose whole subject is "the price is on the page" it would be the one card with
 * nothing to show. The section further down the page still lists all four.
 *
 * The cards are laid out here rather than through `PackagesGrid` because that grid subgrids its
 * rows across four columns at the content width; inside a step panel it would either scroll or
 * squeeze each card to a column too narrow for a franc figure. Three columns, one row each, is the
 * same object at the width this frame has.
 *
 * Like `LookupCard` it is the picture only. It contains real `Link`s, which is safe because the
 * caller is what neutralises them: `StepVisual` renders it inside an `inert` subtree, so nothing
 * here takes focus, answers a click or reaches the accessibility tree.
 */
export function PackagesCard({ className }: { readonly className?: string }) {
  return (
    // `PackageCard` is a `row-span-5 grid-rows-subgrid` child: it takes its rows from the list
    // above it and has none of its own, so the tracks have to be declared here or the name, the
    // price and the button collapse into whatever height their content happens to want. These are
    // the `overview` tracks from `PackagesGrid`, kept in step with it: the first holds the trade
    // name over the catalogue name (two lines of the longest subtitle), and the fourth opens the
    // quiet space under the price that makes the figure read as considered rather than as a line
    // item.
    <ul
      className={cn(
        "grid w-full gap-3",
        "grid-rows-[repeat(5,auto)] sm:grid-cols-3 sm:grid-rows-[minmax(4.75rem,auto)_auto_auto_minmax(3.5rem,auto)_auto]",
        className,
      )}
    >
      {fixedPricePackages().map((entry) => (
        <li key={entry.key} className="row-span-5 grid grid-rows-subgrid">
          <PackageCard entry={entry} variant="overview" />
        </li>
      ))}
    </ul>
  );
}
