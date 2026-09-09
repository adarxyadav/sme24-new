import { ArrowRightIcon, CheckIcon } from "lucide-react";
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
  /** The one card the ladder leads with. Marked, never re-styled: the same card, one shade lifted. */
  readonly featured?: boolean;
  readonly className?: string;
};

type PackageMessageKey = Parameters<ReturnType<typeof useTranslations<"marketing.packages">>>[0];

/**
 * One package (spec 0009, AC-5, AC-6 as amended on 2026-09-06): the name, the one line promise,
 * the delivery line, the price without decimals through the `chfWhole` format with the VAT note
 * (or "On demand" for the implementation partner), the call to action, then on the full variant
 * the included points as a checked list and the output and outcome rows.
 *
 * The card is a subgrid of the grid's rows, so the name, the price, the button and the detail
 * block sit on the same baseline in every card whatever the length of the copy. Because the rows
 * are shared rather than per card, a shorter card leaves its own gap and no invisible placeholder
 * text is needed to hold a baseline (the shape this card carried until 2026-09-09).
 *
 * Every string comes from `marketing.packages.<key>.*` and `marketing.pricing.*`, the price and
 * the order from `PACKAGES`. Server component.
 */
export function PackageCard({
  entry,
  variant = "full",
  featured = false,
  className,
}: PackageCardProps) {
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
      data-featured={featured || undefined}
      className={cn(
        // The rows are set on the grid, so the gap is the one the grid publishes; a card only
        // says how it fills them.
        "grid min-w-0 gap-y-3 px-6 py-8",
        // Each card stands on its own hairline now that the grid separates them, rather than
        // borrowing the shared rule of one edge to edge block. Square corners and no elevation:
        // `docs/design.md` fixes every surface as flat and block cornered, so a card is told apart
        // from the page by its line, never by a shadow or a softened corner.
        "border bg-card",
        // The featured card is the same card with a heavier edge, not a filled one. A fill would
        // make the middle rung a different kind of object; a foreground rule marks one card out of
        // four and survives dark mode without a second background token. `outline` rather than a
        // thicker `border`, so the mark sits over the hairline instead of adding width and nudging
        // the card's content half a pixel out of line with its neighbours.
        featured && "outline-2 outline-foreground -outline-offset-1",
        // The card takes the grid's rows, so every card's price, button and details align.
        full ? "row-span-8 grid-rows-subgrid" : "row-span-5 grid-rows-subgrid",
        className,
      )}
    >
      {/*
        The marker row. It is a row of the shared grid rather than a badge floated over the card,
        so the names below sit on one baseline whether or not a card is marked, and the mark can
        never overlap the name.

        Every card renders the row, and an unmarked one renders it empty with a fixed height: at
        `sm` the four cards sit in two grid rows and only one of those rows contains the marked
        card, so an `auto` track with no content in it collapses and that pair of cards loses the
        space above their names. The height is on the row's own box rather than on text nobody can
        see, so no screen reader meets a placeholder.
      */}
      <div className="h-5 self-start">
        {featured ? (
          <p className="eyebrow flex items-center gap-1.5 text-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />
            {pricing("featuredLabel")}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-2 self-start">
        <Statement
          as="h3"
          text={t(`${entry.key}.name`)}
          layout="flow"
          className="hyphens-auto text-balance break-words text-heading-20"
        />
        <p className="text-copy-14 text-muted-foreground">{t(`${entry.key}.promise`)}</p>
      </div>

      {/*
        The price block, bottom aligned in its row: the amount is the line the eye lands on, so it
        sits closest to the button with the VAT note tucked under it, and the delivery line above
        it as the term of the sale. "Best for" stays its own line above the block rather than being
        folded into the delivery line with a separator: how a package is delivered and who it suits
        are two different facts, and running them together reads as one broken sentence.
      */}
      {full ? (
        <p className="self-end text-copy-14">
          <span className="text-muted-foreground">{pricing("bestForLabel")} </span>
          <strong>{t(`${entry.key}.bestFor`)}</strong>
        </p>
      ) : null}

      {/*
        The delivery line is its own row of the shared grid rather than a line stacked above the
        amount, because one package's delivery wraps to two lines ("On site and ongoing") and a
        stacked line would push that card's amount a row below the other three.
      */}
      {full ? (
        <p className="self-end text-label-12 text-muted-foreground">{t(`${entry.key}.delivery`)}</p>
      ) : null}

      {/*
        The amount and the VAT note are two rows rather than one stacked block, for the same reason
        the delivery line is its own row: the partner card carries no VAT note, and inside one
        bottom aligned block its "On demand" would drop by the height of the note the other three
        cards carry. Two rows let each card leave the note row empty and keep the amounts level.
      */}
      {onDemand ? (
        <p className="self-end text-heading-40">{pricing("onDemand")}</p>
      ) : (
        <p className="self-end text-heading-40 tabular-nums" data-numeric>
          {format.number(entry.priceChf ?? 0, "chfWhole")}
        </p>
      )}

      <div className="self-start">
        {onDemand ? null : (
          <p className="text-label-12 text-muted-foreground">{pricing("vatNote")}</p>
        )}
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
          /*
            The partner card asks for a conversation rather than a purchase, so it takes the
            outline button: the three cards that can be bought carry the one filled action each,
            and the odd one out is told apart by the weight of its button rather than by different
            copy alone.
          */
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
          /*
            Every buyable card takes the filled button. Once the cards are separated each one is a
            self contained offer, so its own primary action should read as primary; marking only
            the featured card's button demoted the other two into looking unavailable. The featured
            card is already marked by its heavier edge and its "Start here" line, which is the
            emphasis that belongs to the ladder rather than to the buttons.
          */
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
        <div className="flex flex-col gap-5 border-t pt-6">
          {/*
            The included points read as a checked list rather than as filled pills: a pill is a
            status in this design system, and these are contents. One point per line also lets a
            long point wrap without reflowing the ones beside it.
          */}
          <ul className="flex flex-col gap-2">
            {entry.included.map((point) => (
              <li key={point} className="flex items-start gap-2 text-copy-14">
                <CheckIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0">{t(includedKey(entry.key, point))}</span>
              </li>
            ))}
          </ul>
          <dl className="flex flex-col gap-3 border-t pt-5">
            <div className="flex flex-col gap-0.5">
              <dt className="text-label-12 text-muted-foreground">{pricing("outputLabel")}</dt>
              <dd className="text-copy-14">{t(`${entry.key}.output`)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-label-12 text-muted-foreground">{pricing("outcomeLabel")}</dt>
              <dd className="text-copy-14">{t(`${entry.key}.outcome`)}</dd>
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
