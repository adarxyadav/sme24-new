"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuartileBand } from "@/components/ui/quartile-band";
import { Separator } from "@/components/ui/separator";
import type { SnapshotPeerBlock } from "@/features/benchmark/snapshot";
import { chartDomain } from "@/features/benchmark/ui/chart-scale";
import { type BubblePoint, PeerBubbleChart } from "@/features/benchmark/ui/peer-bubble-chart";
import { PeerStanding } from "@/features/benchmark/ui/peer-standing";

/** The three shapes of the band: inside the top quarter, below the median, beyond p75. */
const BANDS = [
  { key: "bandTop", p25: 34.9, median: 49.9, p75: 66.4, value: 30 },
  { key: "bandBelow", p25: 34.9, median: 49.9, p75: 66.4, value: 58 },
  { key: "bandOutside", p25: 34.9, median: 49.9, p75: 66.4, value: 68 },
] as const;

/** The spec's invented example of a peer block (spec 0021): 4th of 6, the best at 0.9, every number made up. */
const PEER_BLOCK: SnapshotPeerBlock = {
  key: "ltifr",
  geoRung: "europe",
  rank: 4,
  best: "helvetia",
  gapToBest: 1.5,
  certifiedShare: null,
  chart: { client: null, points: [] },
  rows: [
    ["helvetia", "Helvetia Präzision AG", "CH", 1_800, 0.9, "employees_and_contractors", 41_000],
    ["nordstahl", "Nordstahl GmbH", "DE", 9_800, 1.6, "employees_and_contractors", 22_000],
    ["lyon", "Lyon Précision SA", "FR", 2_300, 2.1, "employees", 8_000],
    [
      "veneto",
      "Veneto Meccanica SpA",
      "IT",
      4_100,
      3.1,
      "employees_and_contractors",
      "already_ahead",
    ],
    ["ruhr", "Ruhr Chemie AG", "DE", 12_500, 4.0, "employees_and_contractors", "already_ahead"],
  ].map(([peerKey, name, country, headcount, value, basis, savingAtPeer]) => ({
    peerKey: peerKey as string,
    name: name as string,
    country: country as string,
    headcount: headcount as number,
    headcountYear: 2024,
    periodYear: 2024,
    value: value as number,
    valueAsPublished: value as number,
    unitAsPublished: "per_million_hours" as const,
    basis: basis as "employees" | "employees_and_contractors",
    sourceUrl: "https://example.org/report",
    reportUrl: "https://example.org",
    verifiedAt: "2026-09-13T00:00:00.000Z",
    denominatorAsPublished: null,
    note: null,
    savingAtPeer: savingAtPeer as number | "already_ahead",
  })),
};

/**
 * The chart's invented points (spec 0021, AC-22): the client and four peers, one of them a
 * quotient row with a note. Every string is literal, grouped with a plain space, because this
 * section renders in the browser and a formatter here would trip the ICU grouping hazard.
 */
const CHART_POINTS: readonly BubblePoint[] = [
  {
    key: "client",
    isClient: true,
    x: 2.4,
    y: 12.5,
    headcount: 420,
    name: "Your company",
    lines: ["Switzerland, 420 employees", "LTIFR 2.40", "12.50 days lost per incident"],
    cells: { country: "Switzerland", headcount: "420", ltifr: "2.40", lostDays: "12.50", note: "" },
  },
  {
    key: "helvetia",
    isClient: false,
    x: 0.9,
    y: 9.8,
    headcount: 1_800,
    name: "Helvetia Präzision AG",
    lines: ["Switzerland, 1 800 employees", "LTIFR 0.90", "9.80 days lost per incident, 2024"],
    cells: { country: "CH", headcount: "1 800", ltifr: "0.90", lostDays: "9.80", note: "" },
  },
  {
    key: "nordstahl",
    isClient: false,
    x: 1.6,
    y: 20.5,
    headcount: 9_800,
    name: "Nordstahl GmbH",
    lines: [
      "Germany, 9 800 employees",
      "LTIFR 1.60",
      "20.50 days lost per incident, 2024",
      "2 275 days lost over 111 lost time accidents, as published",
    ],
    cells: {
      country: "DE",
      headcount: "9 800",
      ltifr: "1.60",
      lostDays: "20.50 (2 275 days lost over 111 lost time accidents, as published)",
      note: "",
    },
  },
  {
    key: "lyon",
    isClient: false,
    x: 2.1,
    y: 15.3,
    headcount: 2_300,
    name: "Lyon Précision SA",
    lines: ["France, 2 300 employees", "LTIFR 2.10", "15.30 days lost per incident, 2023"],
    cells: { country: "FR", headcount: "2 300", ltifr: "2.10", lostDays: "15.30", note: "" },
  },
  {
    key: "ruhr",
    isClient: false,
    x: 4.0,
    y: 71.2,
    headcount: 12_500,
    name: "Ruhr Chemie AG",
    lines: [
      "Germany, 12 500 employees",
      "LTIFR 4.00",
      "71.20 days lost per incident, 2024",
      "204 991 days lost over 2 879 lost time accidents, as published",
      "365 days charged per fatal accident",
    ],
    cells: {
      country: "DE",
      headcount: "12 500",
      ltifr: "4.00",
      lostDays: "71.20 (204 991 days lost over 2 879 lost time accidents, as published)",
      note: "365 days charged per fatal accident",
    },
  },
];
const CHART_SECTOR = 14.5;
const CHART_X = chartDomain(CHART_POINTS.map((point) => point.x));
const CHART_Y = chartDomain([...CHART_POINTS.map((point) => point.y), CHART_SECTOR]);

/**
 * The benchmark primitives (spec 0008, AC-14): the `QuartileBand` in three shapes and a static
 * opportunity card in its cut down shape (the confidence spelled out in the title row, the range,
 * the working estimate with its lost time clause, a saving and an "already at or below" mark), so
 * axe scans them on the gallery. The "How this is calculated" disclosure that once sat beside the
 * card was cut on 2026-09-13 (owner decision), the Peer Standing card of spec 0021 on the
 * spec's invented example, and the peer bubble chart of its chart amendment on invented points.
 * Runs in the browser.
 */
export function BenchmarkSection() {
  const t = useTranslations("gallery.benchmark");
  const b = useTranslations("benchmark");
  const format = useFormatter();
  const chf = (value: number) => format.number(value, "chfWhole");

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-8 lg:grid-cols-3">
        {BANDS.map((band) => (
          <Example key={band.key} label={t(band.key)}>
            <QuartileBand
              p25={band.p25}
              median={band.median}
              p75={band.p75}
              value={band.value}
              label={t("bandLabel", { value: band.value })}
            />
            <p className="text-muted-foreground text-xs tabular-nums" data-numeric>
              {b("positions.quartiles", { p25: band.p25, median: band.median, p75: band.p75 })}
            </p>
          </Example>
        ))}
      </div>
      {/* The point comparison beside the three band shapes (spec 0016, AC-16): a peer row holding
          one figure gets no band and no replacement graphic, so axe scans that state too. */}
      <div className="grid gap-8 lg:grid-cols-3">
        <Example label={t("pointComparison")}>
          <span className="text-sm">{b("positions.band.above_average")}</span>
          <p className="text-muted-foreground text-xs tabular-nums" data-numeric>
            {b("positions.sector", { value: "44.30" })}
          </p>
        </Example>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <Example label={t("card")}>
          <Card>
            <CardHeader>
              <CardTitle>{b("card.title")}</CardTitle>
              <CardAction>
                <Badge variant="warning">{b("card.confidence.medium")}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <p className="font-semibold text-3xl tabular-nums" data-numeric>
                  {b("card.rangeHeadline", { low: chf(1_060_000), high: chf(2_651_000) })}
                </p>
                <p className="text-muted-foreground text-sm tabular-nums" data-numeric>
                  {b.rich("card.workingDerived", {
                    cost: chf(1_961_000),
                    count: format.number(1.8, "oneDecimal"),
                    fte: format.number(420, "integer"),
                    value: (chunks) => (
                      <span className="font-medium text-foreground">{chunks}</span>
                    ),
                  })}
                </p>
              </div>
              <Separator />
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-label-13 text-muted-foreground">{b("card.savingMedian")}</dt>
                  <dd className="text-muted-foreground text-sm tabular-nums" data-numeric>
                    {b.rich("card.savingValue", {
                      amount: chf(522_000),
                      value: (chunks) => (
                        <span className="font-medium text-foreground text-lg">{chunks}</span>
                      ),
                    })}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-label-13 text-muted-foreground">{b("card.savingTop")}</dt>
                  <dd className="text-sm">{b("card.atOrBelow")}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </Example>
      </div>
      {/* The Peer Standing card (spec 0021, AC-10) on invented figures, so axe scans the rank line,
          the strip and the linked table. */}
      <div className="grid gap-8">
        <Example label={t("peerStanding")}>
          <div className="w-full rounded-lg border p-4">
            <PeerStanding
              t={b}
              format={format}
              block={PEER_BLOCK}
              clientValue={2.4}
              clientCountry="CH"
              section="C"
              kpiName="LTIFR"
              locale="en"
              yesNo={{ yes: "yes", no: "no" }}
            />
          </div>
        </Example>
      </div>
      {/* The peer bubble chart (spec 0021, AC-22) on invented points, one a quotient row with a
          note, so axe scans the focusable bubbles, the tooltip and the screen reader table. */}
      <div className="grid gap-8">
        <Example label={t("peerChart")}>
          <div className="w-full rounded-lg border p-4">
            <PeerBubbleChart
              points={CHART_POINTS}
              xDomain={CHART_X}
              yDomain={CHART_Y}
              sectorLine={{
                value: CHART_SECTOR,
                label: b("peers.chart.sectorLine", { value: "14.50" }),
              }}
              labels={{
                chart: b("peers.chart.label", { count: 4 }),
                tableCaption: b("peers.chart.tableCaption"),
                xAxis: b("peers.chart.xAxis"),
                yAxis: b("peers.chart.yAxis"),
                xTicks: [1, 2, 3, 4].map((value) => ({ value, label: String(value) })),
                yTicks: [20, 40, 60].map((value) => ({ value, label: String(value) })),
                legendClient: b("peers.chart.legend.client"),
                legendPeer: b("peers.chart.legend.peer"),
                legendSector: b("peers.chart.legend.sector"),
                columns: {
                  company: b("peers.chart.table.company"),
                  country: b("peers.chart.table.country"),
                  headcount: b("peers.chart.table.headcount"),
                  ltifr: b("peers.chart.table.ltifr"),
                  lostDays: b("peers.chart.table.lostDays"),
                  note: b("peers.chart.table.note"),
                },
              }}
            />
          </div>
        </Example>
      </div>
    </div>
  );
}
