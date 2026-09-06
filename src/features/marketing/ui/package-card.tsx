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

type PackageMessageKey = Parameters<ReturnType<typeof useTranslations<"marketing.packages">>>[0];

/**
 * One package (spec 0009, AC-5, AC-6 as amended on 2026-09-06): the name, the one line promise,
 * the best for line, the price without decimals through the `chfWhole` format with the VAT note
 * (or "On demand" for the implementation partner), the call to action (sign up for a fixed
 * price, the contact form for the partner), then below a hairline the delivery line, the included
 * points as pills and the output and outcome rows. Every string comes from
 * `marketing.packages.<key>.*` and `marketing.pricing.*`, the price and the order from
 * `PACKAGES`. Server component.
 */
export function PackageCard({ entry, variant = "full", className }: PackageCardProps) {
  const t = useTranslations("marketing.packages");
  const pricing = useTranslations("marketing.pricing");
  const format = useFormatter();
  const onDemand = entry.priceChf === null;
  const full = variant === "full";

  return (
    <article
      data-slot="package-card"
      data-package={entry.key}
      className={cn("flex h-full min-w-0 flex-col bg-background", className)}
    >
      <div className="flex flex-1 flex-col gap-5 px-6 py-8">
        <div className="flex flex-col gap-2">
          <Statement
            as="h3"
            text={t(`${entry.key}.name`)}
            className="hyphens-auto break-words font-bold text-xl tracking-headline"
          />
          <p className="max-w-prose text-muted-foreground text-sm">{t(`${entry.key}.promise`)}</p>
        </div>
        {full ? (
          <p className="text-sm">
            <span className="text-muted-foreground">{pricing("bestForLabel")} </span>
            <span className="font-medium">{t(`${entry.key}.bestFor`)}</span>
          </p>
        ) : null}
        <p className="flex flex-col gap-1">
          {entry.priceChf === null ? (
            <span className="font-bold text-2xl tracking-headline">{pricing("onDemand")}</span>
          ) : (
            <>
              <span className="font-bold text-2xl tabular-nums tracking-headline" data-numeric>
                {format.number(entry.priceChf, "chfWhole")}
              </span>
              <span className="text-muted-foreground text-xs">{pricing("vatNote")}</span>
            </>
          )}
        </p>
        <div className="mt-auto pt-2">
          {variant === "overview" ? (
            <Button asChild variant="outline" className="h-auto w-full whitespace-normal py-2">
              <Link href="/pricing">{pricing("overviewLink")}</Link>
            </Button>
          ) : onDemand ? (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-auto w-full whitespace-normal py-2"
            >
              <Link href={{ pathname: "/contact", query: { topic: "retainer" } }}>
                {pricing("retainerCta")}
              </Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="h-auto w-full whitespace-normal py-2">
              <Link href="/sign-up">{pricing("cta")}</Link>
            </Button>
          )}
        </div>
      </div>
      {full ? (
        <div className="flex flex-col gap-5 border-t px-6 py-6">
          <p className="text-muted-foreground text-sm">{t(`${entry.key}.delivery`)}</p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {entry.included.map((point) => (
              <li key={point} className="rounded-4xl bg-muted px-3 py-1">
                {t(includedKey(entry.key, point))}
              </li>
            ))}
          </ul>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">{pricing("outputLabel")}</dt>
              <dd className="font-medium">{t(`${entry.key}.output`)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">{pricing("outcomeLabel")}</dt>
              <dd className="font-medium">{t(`${entry.key}.outcome`)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The catalog key of one included point. The point names are plain strings in `PACKAGES`, so
 * the key is asserted; the catalog test (AC-6) proves every point has its message.
 */
function includedKey(key: Package["key"], point: string) {
  return `${key}.included.${point}` as PackageMessageKey;
}
