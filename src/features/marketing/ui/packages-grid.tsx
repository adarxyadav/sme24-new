import { sortedPackages } from "@/features/marketing/packages";
import { PackageCard, type PackageCardProps } from "./package-card";

/**
 * The four packages side by side in catalog order (spec 0009, AC-5, AC-6), hairlines between the
 * cards, two columns on small screens and four on large ones. The grid owns the rows (name,
 * price, call to action, and on the full variant the details) and each card spans them through
 * `grid-rows-subgrid`, so the prices sit on one baseline and the buttons on another however long
 * a package name runs. Server component.
 */
export function PackagesGrid({ variant = "full" }: Pick<PackageCardProps, "variant">) {
  const full = variant === "full";
  return (
    <ul
      className={[
        "grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4",
        // One track per stacked card below `sm`, then the tracks the cards subgrid into.
        full
          ? "grid-rows-[repeat(4,auto)] sm:grid-rows-[repeat(8,auto)] lg:grid-rows-[repeat(4,auto)]"
          : "grid-rows-[repeat(3,auto)] sm:grid-rows-[repeat(6,auto)] lg:grid-rows-[repeat(3,auto)]",
      ].join(" ")}
    >
      {sortedPackages().map((entry) => (
        <li
          key={entry.key}
          className={
            full ? "row-span-4 grid grid-rows-subgrid" : "row-span-3 grid grid-rows-subgrid"
          }
        >
          <PackageCard entry={entry} variant={variant} />
        </li>
      ))}
    </ul>
  );
}
