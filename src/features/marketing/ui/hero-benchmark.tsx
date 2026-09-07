import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { formatKpiValue } from "@/features/benchmark/ui/format";
import { HERO_EXAMPLE, type HeroPosition, trackLayout } from "@/features/marketing/hero-example";
import { PACKAGES } from "@/features/marketing/packages";
import { KPI_CATALOGUE } from "@/features/research/catalogue";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The landing hero's object (spec 0009, hero amendment of 2026-09-07): the example benchmark of
 * Muster AG drawn the way the dashboard draws a real one, so what the page promises is what the
 * product shows. Annual incident cost, the priority gaps, the position per KPI and the
 * recommended package; the strings are the dashboard's own `benchmark` keys plus the example's
 * names under `marketing.landing.example`. Reads no data, so it renders in a server component
 * and in the gallery alike.
 */
export function HeroBenchmark({ className }: { readonly className?: string }) {
  const t = useTranslations("marketing.landing.example");
  const b = useTranslations("benchmark");
  const packages = useTranslations("marketing.packages");
  const pricing = useTranslations("marketing.pricing");
  const research = useTranslations("research.table");
  const format = useFormatter();
  const yesNo = { yes: research("yes"), no: research("no") };
  const example = HERO_EXAMPLE;
  const nextStep = PACKAGES.find((entry) => entry.key === example.nextStep);
  const chf = (value: number) => format.number(value, "chfWhole");
  const kpi = (position: Pick<HeroPosition, "key" | "value">) =>
    formatKpiValue(position.value, KPI_CATALOGUE[position.key].format, format, yesNo);

  return (
    <article
      aria-label={t("label", { company: t("company") })}
      className={cn("border bg-card text-card-foreground", className)}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-5 py-3.5">
        <p className="font-semibold text-sm">{t("company")}</p>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground text-xs">
          <span>{t("sector")}</span>
          <span>{b(`sizeBands.${example.sizeBand}`)}</span>
          <span>{b("card.compared", { compared: example.compared, total: example.total })}</span>
        </p>
        <p className="text-muted-foreground text-xs sm:ml-auto">
          {b("card.computedOn", {
            date: format.dateTime(example.computedOn, {
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
          })}
        </p>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-5 bg-card p-5">
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-sm">{b("card.title")}</p>
            <p className="max-w-prose text-muted-foreground text-xs">{b("card.description")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-extrabold text-display-sm tabular-nums">
              {chf(example.cost.estimateChf)}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {b("card.range", { low: chf(example.cost.lowChf), high: chf(example.cost.highChf) })}
            </p>
          </div>
          <dl className="flex flex-col border-t text-sm">
            <div className="flex justify-between gap-4 border-b py-2.5">
              <dt className="text-muted-foreground">{b("card.savingMedian")}</dt>
              <dd className="font-semibold tabular-nums">{chf(example.cost.savingMedianChf)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b py-2.5">
              <dt className="text-muted-foreground">{b("card.savingTop")}</dt>
              <dd className="font-semibold tabular-nums">{chf(example.cost.savingTopChf)}</dd>
            </div>
          </dl>
          <p className="text-muted-foreground text-xs">
            {b("card.confidenceFrom", { kpi: t(`kpis.${example.cost.confidenceFrom}`) })}
          </p>
        </div>

        <div className="flex flex-col gap-4 bg-card p-5">
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-sm">{b("gaps.title")}</p>
            <p className="max-w-prose text-muted-foreground text-xs">{b("gaps.description")}</p>
          </div>
          <ol className="flex flex-col">
            {example.gaps.map((gap, index) => (
              <li
                key={gap.key}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-t py-3"
              >
                <span className="font-semibold text-severity-high text-xs tabular-nums">
                  {index + 1}
                </span>
                <span className="font-semibold text-sm">{t(`kpis.${gap.key}`)}</span>
                <span className="row-span-2 text-right font-semibold text-sm tabular-nums">
                  {chf(gap.savingChf)}
                  <span className="block font-normal text-muted-foreground text-xs">
                    {t("savingUnit")}
                  </span>
                </span>
                <span className="col-start-2 text-muted-foreground text-xs tabular-nums">
                  {b("gaps.versus", {
                    value: kpi(gap),
                    median: kpi({ key: gap.key, value: gap.median }),
                  })}
                  {", "}
                  {b("gaps.relative", { percent: format.number(gap.relative, "percent") })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t p-5">
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-sm">{b("positions.title")}</p>
          <p className="max-w-prose text-muted-foreground text-xs">{b("positions.description")}</p>
        </div>
        <ul className="grid gap-x-10 sm:grid-cols-2">
          {example.positions.map((position) => (
            <PositionRow
              key={position.key}
              position={position}
              name={t(`kpis.${position.key}`)}
              value={kpi(position)}
              label={positionLabel(position, {
                band: (band) => b(`positions.band.${band}`),
                noPeer: b("positions.noPeer"),
                certified: t("peersCertified", {
                  percent: format.number(example.peersCertified, "percent"),
                }),
              })}
            />
          ))}
        </ul>
        <p className="text-muted-foreground text-xs tabular-nums">
          {b("positions.peer", {
            section: b(`noga.sections.${example.section}`),
            band: b(`sizeBands.${example.sizeBand}`),
            year: example.peerYear,
          })}
          {", "}
          {b("positions.sample", { n: example.peerSample })}
        </p>
      </div>

      {nextStep?.priceChf ? (
        <div className="flex flex-col gap-4 border-t p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-sm">{t("nextStep")}</p>
            <p className="font-bold text-lg tracking-headline">
              {packages(`${nextStep.key}.name`)}
            </p>
            <p className="text-muted-foreground text-sm">{packages(`${nextStep.key}.promise`)}</p>
            <p className="text-muted-foreground text-xs">{packages(`${nextStep.key}.delivery`)}</p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <p className="flex flex-col sm:items-end">
              <span className="font-extrabold text-2xl tabular-nums tracking-headline">
                {chf(nextStep.priceChf)}
              </span>
              <span className="text-muted-foreground text-xs">{pricing("vatNote")}</span>
            </p>
            <Button asChild size="lg">
              <Link href="/pricing">{t("seePackage")}</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

type PositionLabels = {
  readonly band: (band: NonNullable<HeroPosition["band"]>) => string;
  readonly noPeer: string;
  readonly certified: string;
};

/** The line beside a position's track: the band, the certified share for ISO, or no peer data. Pure. */
function positionLabel(position: HeroPosition, labels: PositionLabels): string {
  if (position.key === "iso_45001_certified") return labels.certified;
  return position.band ? labels.band(position.band) : labels.noPeer;
}

type PositionRowProps = {
  readonly position: HeroPosition;
  readonly name: string;
  readonly value: string;
  readonly label: string;
};

/** One KPI on its quartile track: name, value, the three ticks and the marker, and the band. */
function PositionRow({ position, name, value, label }: PositionRowProps) {
  const layout = position.quartiles ? trackLayout(position.value, position.quartiles) : null;
  const worse = position.band === "below_median" || position.band === "bottom_quarter";
  const better = position.band === "top_quarter" || position.band === "above_median";

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-t py-3 text-xs">
      <span className="font-medium">{name}</span>
      <span className="text-right font-semibold tabular-nums">{value}</span>
      <span className="col-span-2 mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <span aria-hidden="true" className="relative h-3">
          <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
          {layout ? (
            <>
              <span
                className="absolute inset-y-0.5 w-px bg-muted-foreground/60"
                style={{ left: `${layout.p25}%` }}
              />
              <span
                className="absolute inset-y-0 w-px bg-muted-foreground"
                style={{ left: `${layout.median}%` }}
              />
              <span
                className="absolute inset-y-0.5 w-px bg-muted-foreground/60"
                style={{ left: `${layout.p75}%` }}
              />
              <span
                className={cn(
                  "-ml-1 -mt-1 absolute top-1/2 size-2",
                  worse ? "bg-severity-high" : "bg-foreground",
                )}
                style={{ left: `${layout.marker}%` }}
              />
            </>
          ) : null}
        </span>
        <span
          className={cn(
            "whitespace-nowrap text-muted-foreground",
            worse && "text-severity-high",
            better && "text-success",
            !layout && "italic",
          )}
        >
          {label}
        </span>
      </span>
    </li>
  );
}
