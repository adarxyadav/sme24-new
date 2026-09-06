import { CheckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import type { Package } from "@/features/marketing/packages";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type PackageCardProps = {
  readonly entry: Package;
  /** `overview` on the landing page (name, promise, price, a link to pricing); `full` on the pricing page. */
  readonly variant?: "overview" | "full";
  readonly className?: string;
};

/**
 * One package (spec 0009, AC-5, AC-6): the name, the one line promise, the price without
 * decimals through the `chfWhole` format with the VAT note, or "Price on request" for the
 * retainer, the included points and the call to action (sign up for a fixed price, the contact
 * form for the retainer). Names, promises and points come from `marketing.packages.<key>.*`,
 * the price from `PACKAGES`. Server component.
 */
export function PackageCard({ entry, variant = "full", className }: PackageCardProps) {
  const t = useTranslations("marketing.packages");
  const pricing = useTranslations("marketing.pricing");
  const format = useFormatter();
  const retainer = entry.priceChf === null;

  return (
    <article
      data-slot="package-card"
      data-package={entry.key}
      className={cn("flex h-full flex-col gap-6 bg-background px-6 py-8", className)}
    >
      <div className="flex flex-col gap-3">
        <Statement
          as="h3"
          text={t(`${entry.key}.name`)}
          className="font-bold text-xl tracking-headline"
        />
        <p className="max-w-prose text-muted-foreground text-sm">{t(`${entry.key}.promise`)}</p>
      </div>
      <p className="flex flex-col gap-1">
        {retainer ? (
          <span className="font-bold text-2xl tracking-headline">{pricing("priceOnRequest")}</span>
        ) : (
          <>
            <span className="font-bold text-2xl tabular-nums tracking-headline" data-numeric>
              {format.number(entry.priceChf, "chfWhole")}
            </span>
            <span className="text-muted-foreground text-xs">{pricing("vatNote")}</span>
          </>
        )}
      </p>
      {variant === "full" ? (
        <ul className="flex flex-col gap-2 text-sm">
          {entry.included.map((point) => (
            <li key={point} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{t(includedKey(entry.key, point))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto pt-2">
        {variant === "overview" ? (
          <Button asChild variant="outline">
            <Link href="/pricing">{pricing("overviewLink")}</Link>
          </Button>
        ) : retainer ? (
          <Button asChild variant="outline" size="lg">
            <Link href={{ pathname: "/contact", query: { topic: "retainer" } }}>
              {pricing("retainerCta")}
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link href="/sign-up">{pricing("cta")}</Link>
          </Button>
        )}
      </div>
    </article>
  );
}

/**
 * The catalog key of one included point. The point names are plain strings in `PACKAGES`, so
 * the key is asserted; the catalog test (AC-6) proves every point has its message.
 */
function includedKey(key: Package["key"], point: string) {
  return `${key}.included.${point}` as Parameters<
    ReturnType<typeof useTranslations<"marketing.packages">>
  >[0];
}
