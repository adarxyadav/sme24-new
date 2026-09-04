import { useTranslations } from "next-intl";
import { PageStack } from "@/components/page-stack";
import { Skeleton } from "@/components/ui/skeleton";

export type PageSkeletonProps = {
  /** Summary tiles under the header, the shape of an overview page. */
  readonly tiles?: number;
  /** A list block under the tiles (the admin overview has one). */
  readonly rows?: number;
};

const SLOTS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/**
 * The `loading.tsx` body for a signed in area (spec 0003, AC-7): a header, summary tiles and an
 * optional list drawn as skeletons so the page keeps its shape while it streams. Announced once
 * as busy. Server component.
 */
export function PageSkeleton({ tiles = 3, rows = 0 }: PageSkeletonProps) {
  const t = useTranslations("states");
  return (
    <PageStack aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {tiles > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SLOTS.slice(0, tiles).map((slot) => (
            <div key={slot} className="flex flex-col gap-3 rounded-lg border p-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      ) : null}
      {rows > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border p-6">
          <Skeleton className="h-5 w-40" />
          {SLOTS.slice(0, rows).map((slot) => (
            <Skeleton key={slot} className="h-9 w-full" />
          ))}
        </div>
      ) : null}
    </PageStack>
  );
}
