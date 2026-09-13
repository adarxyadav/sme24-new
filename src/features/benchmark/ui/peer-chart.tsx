import type { getFormatter, getTranslations } from "next-intl/server";
import type { ChartPoint, SnapshotBlocks } from "@/features/benchmark/snapshot";
import type { LocaleCode } from "@/i18n/routing";
import { countryName } from "@/lib/countries";
import { chartDomain, type Domain, niceTicks, type Tick, tickDecimals } from "./chart-scale";
import { type BubblePoint, PeerBubbleChart } from "./peer-bubble-chart";

type Formatter = Awaited<ReturnType<typeof getFormatter>>;
type Translator = Awaited<ReturnType<typeof getTranslations<"benchmark">>>;

export type PeerChartProps = {
  readonly blocks: SnapshotBlocks;
  readonly t: Translator;
  readonly format: Formatter;
  readonly locale: LocaleCode;
};

const twoDecimals = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/**
 * The published pair of a lost days figure as one sentence (spec 0021, AC-21): both printed
 * numbers for a quotient row, never the quotient alone; `null` for a figure printed as days. Pure.
 */
export function publishedPairOf(
  t: Translator,
  format: Formatter,
  figure: Pick<
    ChartPoint["lostDays"],
    "unitAsPublished" | "valueAsPublished" | "denominatorAsPublished"
  >,
): string | null {
  if (figure.unitAsPublished !== "days_over_lost_time_accidents") return null;
  return t("peers.asPublished.days_over_lost_time_accidents", {
    days: format.number(figure.valueAsPublished, "integer"),
    accidents: format.number(figure.denominatorAsPublished ?? 0, "integer"),
  });
}

/**
 * The bubble chart under the positions (spec 0021, AC-21, AC-22): draws from the LTIFR block's
 * `chart` alone, formats every number here on the server and hands the client component strings
 * (the ICU grouping hazard), reads the sector line from the lost days entry of `results[]`, and
 * shows one sentence instead when there is no LTIFR block, the client lacks either figure or no
 * peer holds both. Server component.
 */
export function PeerChart({ blocks, t, format, locale }: PeerChartProps) {
  const chart = blocks.peers.find((block) => block.key === "ltifr")?.chart ?? null;
  if (chart === null || chart.client === null || chart.points.length === 0) {
    return (
      <p className="max-w-prose text-muted-foreground text-sm" data-peer-chart="hidden">
        {t("peers.chart.hidden")}
      </p>
    );
  }
  const { client, points } = chart;
  const clientCountry = blocks.inputs.country ? countryName(blocks.inputs.country, locale) : "";
  const decimal = (value: number) => format.number(value, twoDecimals);
  const integer = (value: number) => format.number(value, "integer");
  const headcountLine = (country: string, headcount: number | null) =>
    headcount === null
      ? t("peers.chart.tooltip.headcountUnknown", { country })
      : t("peers.chart.tooltip.headcount", { country, n: integer(headcount) });
  const clientPoint: BubblePoint = {
    key: "client",
    isClient: true,
    x: client.ltifr,
    y: client.lostDays,
    headcount: client.headcount,
    name: t("peers.chart.client"),
    lines: [
      headcountLine(clientCountry, client.headcount),
      t("peers.chart.tooltip.ltifr", { value: decimal(client.ltifr) }),
      t("peers.chart.tooltip.lostDays", { value: decimal(client.lostDays) }),
    ],
    cells: {
      country: clientCountry,
      headcount: client.headcount === null ? "" : integer(client.headcount),
      ltifr: decimal(client.ltifr),
      lostDays: decimal(client.lostDays),
      note: "",
    },
  };
  const peerPoints: readonly BubblePoint[] = points.map((point) => {
    const pair = publishedPairOf(t, format, point.lostDays);
    const note = point.lostDays.note?.[locale] ?? null;
    return {
      key: point.peerKey,
      isClient: false,
      x: point.ltifr,
      y: point.lostDays.value,
      headcount: point.headcount,
      name: point.name,
      lines: [
        headcountLine(countryName(point.country, locale), point.headcount),
        t("peers.chart.tooltip.ltifr", { value: decimal(point.ltifr) }),
        t("peers.chart.tooltip.lostDaysYear", {
          value: decimal(point.lostDays.value),
          year: String(point.lostDays.periodYear),
        }),
        ...(pair === null ? [] : [pair]),
        ...(note === null ? [] : [note]),
      ],
      cells: {
        country: point.country,
        headcount: integer(point.headcount),
        ltifr: decimal(point.ltifr),
        lostDays:
          pair === null
            ? decimal(point.lostDays.value)
            : `${decimal(point.lostDays.value)} (${pair})`,
        note: note ?? "",
      },
    };
  });
  // The sector line is the client's lost days sector value, read from `results[]` and never from
  // the peers or the library; absent when the snapshot has no such row (AC-22).
  const sectorMedian =
    blocks.results.find((entry) => entry.key === "lost_days_per_incident")?.peer?.median ?? null;
  const all = [clientPoint, ...peerPoints];
  const xDomain = chartDomain(all.map((point) => point.x));
  const yDomain = chartDomain([
    ...all.map((point) => point.y),
    ...(sectorMedian === null ? [] : [sectorMedian]),
  ]);
  // Round ticks inside each domain, formatted here so the client component prints strings only.
  const ticksOf = (domain: Domain, target: number): readonly Tick[] => {
    const values = niceTicks(domain, target);
    const digits = tickDecimals(values);
    return values.map((value) => ({
      value,
      label: format.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    }));
  };

  return (
    <section aria-labelledby="peer-chart-heading" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h4 id="peer-chart-heading" className="font-medium">
          {t("peers.chart.title")}
        </h4>
        <p className="max-w-prose text-muted-foreground text-sm">{t("peers.chart.description")}</p>
      </div>
      <PeerBubbleChart
        points={all}
        xDomain={xDomain}
        yDomain={yDomain}
        sectorLine={
          sectorMedian === null
            ? null
            : {
                value: sectorMedian,
                label: t("peers.chart.sectorLine", { value: decimal(sectorMedian) }),
              }
        }
        labels={{
          chart: t("peers.chart.label", { count: peerPoints.length }),
          tableCaption: t("peers.chart.tableCaption"),
          xAxis: t("peers.chart.xAxis"),
          yAxis: t("peers.chart.yAxis"),
          xTicks: ticksOf(xDomain, 5),
          yTicks: ticksOf(yDomain, 4),
          legendClient: t("peers.chart.legend.client"),
          legendPeer: t("peers.chart.legend.peer"),
          legendSector: t("peers.chart.legend.sector"),
          columns: {
            company: t("peers.chart.table.company"),
            country: t("peers.chart.table.country"),
            headcount: t("peers.chart.table.headcount"),
            ltifr: t("peers.chart.table.ltifr"),
            lostDays: t("peers.chart.table.lostDays"),
            note: t("peers.chart.table.note"),
          },
        }}
      />
    </section>
  );
}
