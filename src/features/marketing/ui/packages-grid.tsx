import { sortedPackages } from "@/features/marketing/packages";
import { PackageCard, type PackageCardProps } from "./package-card";

/**
 * The four packages side by side in catalog order (spec 0009, AC-5, AC-6), hairlines between the
 * cards, two columns on small screens and four on large ones. Server component.
 */
export function PackagesGrid({ variant = "full" }: Pick<PackageCardProps, "variant">) {
  return (
    <ul className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {sortedPackages().map((entry) => (
        <li key={entry.key} className="flex">
          <PackageCard entry={entry} variant={variant} />
        </li>
      ))}
    </ul>
  );
}
