import { ArrowRightIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { checkoutPath } from "@/features/checkout/checkout-path";
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
 * the delivery line, the price without decimals through the `chfWhole` format with the VAT note
 * (or "On demand" for the implementation partner), the call to action, then on the full variant
 * the included points as a list and the output and outcome rows. The card is a subgrid of the
 * grid's rows, so the name, the price, the button and the detail block sit on the same baseline
 * in every card whatever the length of the copy. Every string comes from
 * `marketing.packages.<key>.*` and `marketing.pricing.*`, the price and the order from
 * `PACKAGES`. Server component.
 */
export function PackageCard({ entry, variant = "full", className }: PackageCardProps) {
  const t = useTranslations("marketing.packages");
  const pricing = useTranslations("marketing.pricing");
  const format = useFormatter();
  const locale = useLocale() as Parameters<typeof checkoutPath>[0];
  const onDemand = entry.priceChf === null;
  const full = variant === "full";

  return (
    <article
      data-slot="package-card"
      data-package={entry.key}
      className={cn(
        "grid min-w-0 bg-background px-6 py-8",
        // The card takes the grid's rows, so every card's price, button and details align.
        full ? "row-span-4 grid-rows-subgrid gap-y-8" : "row-span-3 grid-rows-subgrid gap-y-8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2 self-start">
        <Statement
          as="h3"
          text={t(`${entry.key}.name`)}
          layout="flow"
          className="hyphens-auto break-words font-bold text-lg tracking-headline"
        />
        <p className="text-muted-foreground text-sm">{t(`${entry.key}.promise`)}</p>
        {full ? (
          <p className="text-sm">
            <span className="text-muted-foreground">{pricing("bestForLabel")} </span>
            <span className="font-medium">{t(`${entry.key}.bestFor`)}</span>
          </p>
        ) : null}
      </div>

      {/* Three tracks of its own, so the delivery line, the amount and the VAT note each sit on
          one baseline across the row even where a card has no VAT note. */}
      <div className="grid grid-rows-[auto_auto_auto] gap-1 self-end">
        {/* Empty on the overview variant, but the row keeps its height (an invisible full stop),
            so the amounts stay on one baseline across the whole row. */}
        <p
          aria-hidden={full ? undefined : true}
          className={cn("text-muted-foreground text-xs", !full && "invisible")}
        >
          {full ? t(`${entry.key}.delivery`) : "."}
        </p>
        {onDemand ? (
          <p className="font-bold text-3xl tracking-headline">{pricing("onDemand")}</p>
        ) : (
          <p className="font-bold text-3xl tabular-nums tracking-headline" data-numeric>
            {format.number(entry.priceChf ?? 0, "chfWhole")}
          </p>
        )}
        {/* The partner has no VAT note; the row still holds, so its amount keeps the baseline. */}
        <p
          aria-hidden={onDemand ? true : undefined}
          className={cn("text-muted-foreground text-xs", onDemand && "invisible")}
        >
          {onDemand ? "." : pricing("vatNote")}
        </p>
      </div>

      <div className="self-end">
        {variant === "overview" ? (
          <Button asChild variant="ghost" className="-mx-3 h-auto justify-start gap-2 px-3 py-2">
            {/*
              Four cards carry this link to the same page, so the visible label stays short while
              the accessible name names the package: a screen reader's link list reads four
              distinct destinations rather than "See all prices" four times.
            */}
            <Link
              href="/pricing"
              aria-label={pricing("overviewLinkFor", { name: t(`${entry.key}.name`) })}
            >
              {pricing("overviewLink")}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
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
            {/*
              Spec 0011 (AC-16): the chosen package rides along, so a signed out visitor lands
              back on the checkout for the package they picked once they have signed up. A
              signed in client is sent straight to the checkout by the sign up page.
            */}
            <Link
              href={{
                pathname: "/sign-up",
                query: { next: checkoutPath(locale, entry.key) },
              }}
            >
              {pricing("cta")}
            </Link>
          </Button>
        )}
      </div>

      {full ? (
        <div className="flex flex-col gap-5 border-t pt-6 text-sm">
          <ul className="flex flex-wrap gap-2">
            {entry.included.map((point) => (
              <li key={point} className="rounded-4xl bg-muted px-3 py-1">
                {t(includedKey(entry.key, point))}
              </li>
            ))}
          </ul>
          <dl className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium text-muted-foreground text-xs">
                {pricing("outputLabel")}
              </dt>
              <dd>{t(`${entry.key}.output`)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium text-muted-foreground text-xs">
                {pricing("outcomeLabel")}
              </dt>
              <dd>{t(`${entry.key}.outcome`)}</dd>
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
