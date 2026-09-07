import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuartileBand } from "@/components/ui/quartile-band";
import { formatKpiValue } from "@/features/benchmark/ui/format";
import { HERO_EXAMPLE, type HeroPosition } from "@/features/marketing/hero-example";
import { KPI_CATALOGUE } from "@/features/research/catalogue";
import { cn } from "@/lib/utils";

/**
 * How many gaps the hero shows. The dashboard lists every KPI; the hero is a shot of the
 * product, so it shows the headline cost and the three gaps the headline promises.
 */
const HERO_GAPS = 3;

/**
 * The landing hero's object (spec 0009, hero amendment of 2026-09-07): a shot of the example
 * benchmark of Muster AG, drawn from the dashboard's own `Card`, `Badge` and `QuartileBand` and
 * its `benchmark` strings, so the page shows the product rather than describing it. It answers
 * the headline's first two promises — what the risk costs and what to fix first — and leaves the
 * price and the packages to the sections below. Reads no data, so it renders in a server
 * component and in the gallery alike.
 */
export function HeroBenchmark({ className }: { readonly className?: string }) {
  const t = useTranslations("marketing.landing.example");
  const b = useTranslations("benchmark");
  const research = useTranslations("research.table");
  const format = useFormatter();
  const yesNo = { yes: research("yes"), no: research("no") };
  const example = HERO_EXAMPLE;
  const chf = (value: number) => format.number(value, "chfWhole");
  const kpi = (position: Pick<HeroPosition, "key" | "value">) =>
    formatKpiValue(position.value, KPI_CATALOGUE[position.key].format, format, yesNo);

  return (
    <section
      aria-label={t("label", { company: t("company") })}
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <p className="font-semibold text-sm">{t("company")}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          <span>{t("sector")}</span>
          <span>{b(`sizeBands.${example.sizeBand}`)}</span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{b("card.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-4xl tabular-nums" data-numeric>
                {chf(example.cost.estimateChf)}
              </p>
              <p className="text-muted-foreground text-sm tabular-nums" data-numeric>
                {b("card.range", {
                  low: chf(example.cost.lowChf),
                  high: chf(example.cost.highChf),
                })}
              </p>
            </div>
            <dl className="flex flex-col text-sm">
              <div className="flex items-baseline justify-between gap-4 border-t py-2.5">
                <dt className="text-muted-foreground">{b("card.savingMedian")}</dt>
                <dd className="font-medium tabular-nums" data-numeric>
                  {chf(example.cost.savingMedianChf)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t py-2.5">
                <dt className="text-muted-foreground">{b("card.savingTop")}</dt>
                <dd className="font-medium tabular-nums" data-numeric>
                  {chf(example.cost.savingTopChf)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{b("gaps.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {example.gaps.slice(0, HERO_GAPS).map((gap, index) => {
                const position = example.positions.find((entry) => entry.key === gap.key);
                return (
                  <li
                    key={gap.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 border-t pt-3 first:border-t-0 first:pt-0"
                  >
                    <Badge variant="outline">{b("gaps.rank", { rank: index + 1 })}</Badge>
                    <span className="font-medium text-sm">{t(`kpis.${gap.key}`)}</span>
                    <span className="font-medium text-sm tabular-nums" data-numeric>
                      {chf(gap.savingChf)}
                    </span>
                    <div className="col-start-2 col-end-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {position?.quartiles && position.band ? (
                        <QuartileBand
                          className="w-40 shrink-0"
                          p25={position.quartiles.p25}
                          median={position.quartiles.median}
                          p75={position.quartiles.p75}
                          value={position.value}
                          label={b("positions.srBand", {
                            kpi: t(`kpis.${gap.key}`),
                            value: kpi(position),
                            band: b(`positions.band.${position.band}`),
                            p25: kpi({ key: gap.key, value: position.quartiles.p25 }),
                            median: kpi({ key: gap.key, value: position.quartiles.median }),
                            p75: kpi({ key: gap.key, value: position.quartiles.p75 }),
                          })}
                        />
                      ) : null}
                      <span className="text-muted-foreground text-xs tabular-nums" data-numeric>
                        {b("gaps.versus", {
                          value: kpi(gap),
                          median: kpi({ key: gap.key, value: gap.median }),
                        })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground text-xs tabular-nums" data-numeric>
        {b("positions.peer", {
          section: b(`noga.sections.${example.section}`),
          band: b(`sizeBands.${example.sizeBand}`),
          year: example.peerYear,
        })}
        {", "}
        {b("positions.sample", { n: example.peerSample })}
      </p>
    </section>
  );
}
