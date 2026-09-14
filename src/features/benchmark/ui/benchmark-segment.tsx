import { ExternalLinkIcon, InfoIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type BenchmarkState, sectionOfDivision } from "@/features/benchmark/catalogue";
import { roundMoney } from "@/features/benchmark/loss";
import type { ParsedSnapshot } from "@/features/benchmark/queries";
import type {
  SnapshotBlocks,
  SnapshotPeerRow,
  SnapshotPeers,
  SnapshotRecommendation,
} from "@/features/benchmark/snapshot";
import { checkoutPath } from "@/features/checkout/checkout-path";
import type { ExpertSuggestion } from "@/features/experts/queries";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
import { PACKAGES } from "@/features/marketing/packages";
import { Link } from "@/i18n/navigation";
import { type LocaleCode, localeFromCode } from "@/i18n/routing";
import { countryName, regionOf } from "@/lib/countries";
import { chartDomain, niceTicks, tickDecimals } from "./chart-scale";
import { FactsForm, type FactsFormProps } from "./facts-form";
import { type ChartPoint, PeerChart } from "./peer-chart";

export type BenchmarkSegmentProps = {
  readonly snapshot: ParsedSnapshot | null;
  readonly state: BenchmarkState;
  /** The company facts the form edits (AC-11). */
  readonly company: FactsFormProps["company"];
  readonly locale: LocaleCode;
  /**
   * Hides every "correct these facts" form (spec 0013, AC-11). An assigned expert reads the same
   * benchmark the client sees, but `updateCompanyFacts` is a client action they may not call, so
   * showing them the form would offer an edit that can only ever fail.
   */
  readonly readOnly?: boolean;
  /**
   * The "Your figures" card, rendered inside the `noData` state above the facts form (spec 0010).
   * `noData` means a snapshot compared nothing, so entering a figure by hand is the remedy the
   * alert is asking for and the card belongs beside it rather than further down the page. A
   * caller that has no client KPI form to offer — the expert view, which is `readOnly` — passes
   * nothing and the state renders as it did before.
   */
  readonly figuresSlot?: React.ReactNode;
  /**
   * The experts to suggest beside the benchmark (spec 0022, AC-22), already chosen and signed by
   * `loadExpertSuggestions`. The page loads them, not this component: the choice is one database
   * function and the photos are signed with the caller's own client.
   */
  readonly experts?: readonly ExpertSuggestion[];
  /** The company's own name, shown in place in the peer table on the client's own row (AC-20). */
  readonly companyName?: string;
};

type Translator = Awaited<ReturnType<typeof getTranslations<"benchmark">>>;
type CatalogueTranslator = Awaited<ReturnType<typeof getTranslations<"experts.catalogue">>>;
type PackagesTranslator = Awaited<ReturnType<typeof getTranslations<"marketing.packages">>>;
type PricingTranslator = Awaited<ReturnType<typeof getTranslations<"marketing.pricing">>>;
type Formatter = Awaited<ReturnType<typeof getFormatter>>;

/** The client's own figures as a row of the peer table (AC-20), or null without an LTIFR to place it by. */
type ClientRow = {
  readonly name: string;
  readonly headcount: number | null;
  readonly ltifr: number | null;
  readonly trifr: number | null;
  readonly loss: number | null;
};

/**
 * The benchmark segment of the dashboard (spec 0008, AC-9; spec 0022, AC-18, AC-20 to AC-24): the
 * waiting states, the `outdated` sentence for a snapshot written by a model version this code no
 * longer reads, then on a readable snapshot the four sections in the order AC-20 to AC-23 fix —
 * the one peer table, the estimated loss, the suggested experts, the recommended package — and the
 * company facts card last. Nothing from an unreadable row is ever shown. Server component.
 */
export async function BenchmarkSegment({
  snapshot,
  state,
  company,
  locale,
  readOnly = false,
  figuresSlot,
  experts = [],
  companyName,
}: BenchmarkSegmentProps) {
  // Every translator this segment and its sections need, awaited once here: a nested async
  // component would suspend inside a tree the caller already awaited, so the sections below are
  // all synchronous and are handed what they read.
  const [t, catalogue, packages, pricing, format] = await Promise.all([
    getTranslations("benchmark"),
    getTranslations("experts.catalogue"),
    getTranslations("marketing.packages"),
    getTranslations("marketing.pricing"),
    getFormatter(),
  ]);
  // `ready` is the only state whose blocks are both present and current; every other state renders
  // its own sentence and nothing of the stored row (AC-18).
  const blocks = state === "ready" ? snapshot?.blocks : null;

  return (
    <section
      aria-labelledby="benchmark-heading"
      className="flex flex-col gap-4"
      data-benchmark-state={state}
    >
      <h2 id="benchmark-heading" className="font-semibold text-lg">
        {t("heading")}
      </h2>
      {state === "calculating" ? <CalculatingState label={t("state.calculating")} /> : null}
      {state === "unavailable" ? (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.unavailable")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "outdated" ? (
        <Alert variant="info" data-outdated>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.outdated")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "noData" ? (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.noData")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "noData" && !readOnly ? figuresSlot : null}

      {blocks ? (
        <>
          <PeersSection
            blocks={blocks}
            companyName={companyName ?? t("peers.table.yourCompany")}
            locale={locale}
            t={t}
            format={format}
          />
          <LossSection blocks={blocks} t={t} format={format} />
          {/* The expert suggestions and the package are the client's own next step: an assigned
              expert reading this page is not being sold a package or shown three colleagues to
              choose between, so the read only view stops after the loss (spec 0013, AC-11). */}
          {readOnly ? null : (
            <>
              <ExpertsSection experts={experts} t={t} catalogue={catalogue} />
              <PackageSection
                recommendation={blocks.recommendation}
                locale={locale}
                t={t}
                packages={packages}
                pricing={pricing}
                format={format}
              />
            </>
          )}
        </>
      ) : null}

      {state !== "calculating" && state !== "unavailable" && !readOnly ? (
        <FactsCard company={company} t={t} />
      ) : null}
    </section>
  );
}

/**
 * An amount in the snapshot's own currency, whole units (AC-14). The named `chfWhole` format is
 * fixed to francs, so the currency is passed explicitly the way the `benchmark_ready` email does:
 * a client outside Switzerland is never told its losses in francs.
 *
 * Money is stored unrounded and rounded once at display, here, by the same `roundMoney` the task
 * applies before it hands the figures to the email: a modelled loss printed to the franc would
 * read as a measurement, and the card and the email would disagree for one snapshot. Pure.
 */
function money(value: number, currency: string, format: Formatter): string {
  return format.number(roundMoney(value), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
}

/** A rate as the table prints it: two decimals, or the dash when the company published none. Pure. */
function rate(value: number | null, format: Formatter, dash: string): string {
  return value === null
    ? dash
    : format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The rung's name (AC-20): the country by name, the region by its own label, or "worldwide". The
 * region label is read from the country the run started at, which is the one the ladder widened
 * from. Pure but for the translator.
 */
function scopeOf(peers: SnapshotPeers, country: string, locale: LocaleCode, t: Translator): string {
  if (peers.rung === "country") {
    return t("peers.rung.country", { country: countryName(country, locale) });
  }
  if (peers.rung === "region") {
    const region = regionOf(country);
    return t("peers.rung.region", {
      region: region ? t(`peers.region.${region}` as "peers.region.dach") : "",
    });
  }
  return t("peers.rung.world");
}

/**
 * The chart's points in rank order (spec 0022, the D-chart): one per company that published a
 * TRIFR, since the ranking is a TRIFR ranking and a company without one has no place on it. The
 * rank is the position among those kept, so it is always 1..n with no gap, and it is assigned after
 * the filter rather than read from the table's index.
 *
 * Every string is formatted here, in the server component: the client component draws pixels and
 * formats nothing, which is what keeps a grouped figure from rendering differently on Node and in
 * the browser. Pure but for the translator and the formatter.
 */
function chartPoints({
  rows,
  country,
  currency,
  locale,
  t,
  format,
}: {
  readonly rows: readonly (SnapshotPeerRow | ClientRow)[];
  readonly country: string;
  readonly currency: string;
  readonly locale: LocaleCode;
  readonly t: Translator;
  readonly format: Formatter;
}): readonly ChartPoint[] {
  const dash = t("peers.table.none");
  return rows
    .filter((row) => row.trifr !== null)
    .map((row, index): ChartPoint => {
      const isClient = !("sourceUrl" in row);
      const name = "sourceUrl" in row ? row.peerName : row.name;
      const rank = index + 1;
      // A peer's loss is its own, priced from its headcount and rates; the client's own loss is not
      // drawn as an area, because it is modelled from figures the client entered rather than
      // published, so the sketch gives them an outline instead.
      const loss = "sourceUrl" in row ? row.estimatedLoss : null;
      const rankLabel = format.number(rank, "integer");
      const trifrLabel = rate(row.trifr, format, dash);
      const lossLabel = loss === null ? dash : money(loss, currency, format);
      return {
        key: isClient ? "client" : `peer-${name}`,
        isClient,
        rank,
        // The filter above proves this, but the type cannot see through it.
        trifr: row.trifr ?? 0,
        loss,
        name,
        lines: [
          t("chart.tooltip.rank", { rank: rankLabel }),
          t("chart.tooltip.trifr", { value: trifrLabel }),
          t("chart.tooltip.loss", { amount: lossLabel }),
        ],
        cells: {
          rank: rankLabel,
          country: countryName("sourceUrl" in row ? row.country : country, locale),
          trifr: trifrLabel,
          loss: lossLabel,
        },
      };
    });
}

/** Every label the drawing needs, formatted here so the client component formats nothing. Pure but for the translator. */
function chartLabels({
  points,
  t,
  format,
}: {
  readonly points: readonly ChartPoint[];
  readonly t: Translator;
  readonly format: Formatter;
}) {
  const ticks = niceTicks(chartDomain(points.map((point) => point.trifr)));
  const decimals = tickDecimals(ticks);
  return {
    chart: t("chart.title"),
    tableCaption: t("chart.tableCaption"),
    xAxis: t("chart.xAxis"),
    yAxis: t("chart.yAxis"),
    yTicks: ticks.map((value) => ({
      value,
      label: format.number(value, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    })),
    legendClient: t("chart.legend.client"),
    legendPeer: t("chart.legend.peer"),
    columns: {
      company: t("peers.table.company"),
      rank: t("chart.column.rank"),
      country: t("peers.table.country"),
      trifr: t("peers.table.trifr"),
      loss: t("peers.table.loss"),
    },
  };
}

/**
 * The peer benchmark, first (AC-20): the badge with the peer count and the rung, one rank sentence
 * from `peers.rates` (replaced by the thin sentence when the run rested on fewer than three peers),
 * then one table in the order of `peers.rows` with the client's own row highlighted in place by its
 * LTIFR, and the one footnote. Never the word verified. Server component.
 */
function PeersSection({
  blocks,
  companyName,
  locale,
  t,
  format,
}: {
  readonly blocks: SnapshotBlocks;
  readonly companyName: string;
  readonly locale: LocaleCode;
  readonly t: Translator;
  readonly format: Formatter;
}) {
  const { peers, inputs, loss } = blocks;
  if (!peers) {
    return (
      <Card data-peers-card>
        <CardHeader>
          <CardTitle>
            <h3>{t("peers.heading")}</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-w-prose text-muted-foreground text-sm">{t("peers.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  const scope = scopeOf(peers, inputs.country, locale, t);
  const section = inputs.section ?? sectionOfDivision(inputs.industryCode);
  const industry = section ? t(`noga.sections.${section as "C"}`) : "";
  const clientRate = (key: "ltifr" | "trifr") =>
    inputs.kpis.find((kpi) => kpi.key === key)?.value ?? null;
  const clientTrifr = clientRate("trifr");
  const clientRow: ClientRow = {
    name: companyName,
    headcount: inputs.fte,
    ltifr: clientRate("ltifr"),
    trifr: clientTrifr,
    loss: loss?.loss ?? null,
  };
  // The client sits among the peers by its own TRIFR, so the table reads as one ranking rather than
  // a list with the reader appended. Without a TRIFR there is no place to put them and the row is
  // left out, which is the same condition that empties the rank sentence.
  //
  // TRIFR and not LTIFR because the chart above ranks by TRIFR (the owner's sketch of 14 Sep 2026),
  // and a table ordered differently from the chart it sits under would give one reader two rankings.
  // The stored `peers.rows` stay sorted by LTIFR: changing that is a model change and a version bump
  // for an ordering only the page cares about, so the re-sort belongs here.
  const byTrifr = (a: SnapshotPeerRow, b: SnapshotPeerRow) => {
    if (a.trifr === null && b.trifr === null) return a.peerName < b.peerName ? -1 : 1;
    if (a.trifr === null) return 1;
    if (b.trifr === null) return -1;
    if (a.trifr !== b.trifr) return a.trifr - b.trifr;
    return a.peerName < b.peerName ? -1 : 1;
  };
  const sortedPeers = [...peers.rows].sort(byTrifr);
  const rows: readonly (SnapshotPeerRow | ClientRow)[] =
    clientTrifr === null
      ? sortedPeers
      : [
          ...sortedPeers.filter((row) => row.trifr !== null && row.trifr < clientTrifr),
          clientRow,
          ...sortedPeers.filter((row) => row.trifr === null || row.trifr >= clientTrifr),
        ];
  const points = chartPoints({
    rows,
    country: inputs.country,
    currency: inputs.currency,
    locale,
    t,
    format,
  });

  return (
    <Card data-peers-card>
      <CardHeader>
        <CardTitle>
          <h3>{t("peers.heading")}</h3>
        </CardTitle>
        <CardAction>
          <Badge variant="secondary" data-peer-count={peers.rows.length}>
            {t("peers.badge", { count: peers.rows.length, scope })}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="max-w-prose text-sm" data-rank-sentence>
          {rankSentence({ peers, industry, scope, t })}
        </p>
        {/* The chart draws the same ranking the table lists, so it needs two points to be a
            comparison at all; below that the table alone stands. */}
        {points.length >= 2 ? (
          <figure className="flex flex-col gap-2">
            <PeerChart
              points={points}
              yDomain={chartDomain(points.map((point) => point.trifr))}
              labels={chartLabels({ points, t, format })}
            />
            <figcaption className="max-w-prose text-muted-foreground text-xs" data-chart-caption>
              {t("chart.caption")}
            </figcaption>
          </figure>
        ) : null}
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableCaption className="sr-only">
              {t("peers.table.caption", { industry, scope })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("peers.table.company")}</TableHead>
                <TableHead scope="col">{t("peers.table.country")}</TableHead>
                <TableHead scope="col">{t("peers.table.year")}</TableHead>
                <TableHead scope="col" className="text-right">
                  {t("peers.table.ltifr")}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t("peers.table.trifr")}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t("peers.table.loss")}
                </TableHead>
                <TableHead scope="col">{t("peers.table.source")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) =>
                "sourceUrl" in row ? (
                  <PeerTableRow
                    key={`peer-${row.peerName}`}
                    row={row}
                    currency={inputs.currency}
                    locale={locale}
                    t={t}
                    format={format}
                  />
                ) : (
                  <ClientTableRow
                    key="client"
                    row={row}
                    country={inputs.country}
                    currency={inputs.currency}
                    locale={locale}
                    t={t}
                    format={format}
                  />
                ),
              )}
            </TableBody>
          </Table>
        </div>
        <p className="max-w-prose text-muted-foreground text-xs" data-peers-footnote>
          {t("peers.footnote")}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The one rank sentence (AC-20): both ranks when the client has both rates and the peers published
 * both, one when only one side stands, the thin sentence in place of all of it when the run rested
 * on fewer than three peers, and the prompt to enter a figure when the client is in no ranking.
 * Pure but for the translator.
 */
function rankSentence({
  peers,
  industry,
  scope,
  t,
}: {
  readonly peers: SnapshotPeers;
  readonly industry: string;
  readonly scope: string;
  readonly t: Translator;
}): string {
  if (peers.thin) return t("peers.rank.thin", { count: peers.rows.length });
  const ltifr = peers.rates.ltifr;
  const trifr = peers.rates.trifr;
  // A rate the client does not publish has a null rank and is left out of the sentence (AC-20).
  const hasLtifr = ltifr?.rank != null;
  const hasTrifr = trifr?.rank != null;
  const values = {
    industry,
    scope,
    ltifrRank: ltifr?.rank ?? 0,
    ltifrOf: ltifr?.of ?? 0,
    trifrRank: trifr?.rank ?? 0,
    trifrOf: trifr?.of ?? 0,
  };
  if (hasLtifr && hasTrifr) return t("peers.rank.both", values);
  if (hasLtifr) return t("peers.rank.ltifr", values);
  if (hasTrifr) return t("peers.rank.trifr", values);
  return t("peers.rank.none");
}

/** One published peer in the table (AC-20), its source link opening the page in a new tab. */
function PeerTableRow({
  row,
  currency,
  locale,
  t,
  format,
}: {
  readonly row: SnapshotPeerRow;
  readonly currency: string;
  readonly locale: LocaleCode;
  readonly t: Translator;
  readonly format: Formatter;
}) {
  const dash = t("peers.table.none");
  return (
    <TableRow data-peer={row.peerName}>
      <TableCell className="min-w-48 max-w-xs align-top whitespace-normal">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.peerName}</span>
          <span className="text-muted-foreground text-xs">
            {row.headcount === null
              ? t("peers.table.noHeadcount")
              : t("peers.table.headcount", { n: format.number(row.headcount, "integer") })}
          </span>
        </div>
      </TableCell>
      <TableCell className="align-top">{countryName(row.country, locale)}</TableCell>
      <TableCell className="align-top tabular-nums" data-numeric>
        {row.periodYear}
      </TableCell>
      <TableCell className="align-top text-right tabular-nums" data-numeric>
        {rate(row.ltifr, format, dash)}
      </TableCell>
      <TableCell className="align-top text-right tabular-nums" data-numeric>
        {rate(row.trifr, format, dash)}
      </TableCell>
      <TableCell className="align-top text-right tabular-nums" data-numeric>
        {row.estimatedLoss === null ? dash : money(row.estimatedLoss, currency, format)}
      </TableCell>
      <TableCell className="align-top">
        <a
          href={row.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
        >
          <span className="sr-only">{t("peers.table.sourceLink", { name: row.peerName })}</span>
          <span aria-hidden="true">{t("peers.table.source")}</span>
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
        </a>
      </TableCell>
    </TableRow>
  );
}

/** The client's own figures, highlighted in place among the peers (AC-20). */
function ClientTableRow({
  row,
  country,
  currency,
  locale,
  t,
  format,
}: {
  readonly row: ClientRow;
  readonly country: string;
  readonly currency: string;
  readonly locale: LocaleCode;
  readonly t: Translator;
  readonly format: Formatter;
}) {
  const dash = t("peers.table.none");
  return (
    <TableRow data-client-row className="bg-muted/60">
      <TableCell className="min-w-48 max-w-xs align-top whitespace-normal">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.name}</span>
          <span className="text-muted-foreground text-xs">
            {row.headcount === null
              ? t("peers.table.noHeadcount")
              : t("peers.table.headcount", { n: format.number(row.headcount, "integer") })}
          </span>
        </div>
      </TableCell>
      <TableCell className="align-top">{countryName(country, locale)}</TableCell>
      <TableCell className="align-top text-muted-foreground">{dash}</TableCell>
      <TableCell className="align-top text-right font-medium tabular-nums" data-numeric>
        {rate(row.ltifr, format, dash)}
      </TableCell>
      <TableCell className="align-top text-right font-medium tabular-nums" data-numeric>
        {rate(row.trifr, format, dash)}
      </TableCell>
      <TableCell className="align-top text-right font-medium tabular-nums" data-numeric>
        {row.loss === null ? dash : money(row.loss, currency, format)}
      </TableCell>
      <TableCell className="align-top">
        <Badge variant="secondary">{t("peers.table.you")}</Badge>
      </TableCell>
    </TableRow>
  );
}

/**
 * The estimated loss, second (AC-21): the yearly loss in the client's currency as the headline, the
 * saving at the peer median and at the best peer, and the counts behind it each with a "Calculated"
 * badge. The empty state, when the client has no LTIFR, asks for it and links to the figures card.
 * No line names the hourly cost, the hours per incident or the fatality price. Server component.
 */
function LossSection({
  blocks,
  t,
  format,
}: {
  readonly blocks: SnapshotBlocks;
  readonly t: Translator;
  readonly format: Formatter;
}) {
  const { loss, inputs } = blocks;
  if (!loss) {
    return (
      <Card data-loss-card>
        <CardHeader>
          <CardTitle>
            <h3>{t("loss.heading")}</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <p className="max-w-prose text-sm">{t("loss.empty.title")}</p>
          <a
            href="#self-assessment-heading"
            className="text-primary text-sm underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            {t("loss.empty.link")}
          </a>
        </CardContent>
      </Card>
    );
  }

  const currency = inputs.currency;
  const savings = [
    loss.savingAtMedian === null || loss.savingAtMedian <= 0
      ? null
      : t("loss.savingAtMedian", { amount: money(loss.savingAtMedian, currency, format) }),
    loss.savingAtBest === null || loss.savingAtBest <= 0
      ? null
      : t("loss.savingAtBest", { amount: money(loss.savingAtBest, currency, format) }),
  ].filter((line): line is string => line !== null);

  return (
    <Card data-loss-card>
      <CardHeader>
        <CardTitle>
          <h3>{t("loss.heading")}</h3>
        </CardTitle>
        <CardDescription>{t("loss.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="font-semibold text-3xl tabular-nums" data-numeric data-loss-headline>
          {t("loss.headline", { amount: money(loss.loss, currency, format) })}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {savings.length === 0 ? (
            <li className="text-muted-foreground">{t("loss.noSaving")}</li>
          ) : (
            savings.map((line) => <li key={line}>{line}</li>)
          )}
        </ul>
        <div className="flex flex-col gap-2">
          <h4 className="font-medium text-sm">{t("loss.counts.heading")}</h4>
          <ul className="flex flex-col gap-2">
            <CountRow
              label={t("loss.counts.ltis", { count: format.number(loss.ltis, "oneDecimal") })}
              badge={t("loss.counts.calculated")}
            />
            <CountRow
              label={t("loss.counts.recordables", {
                count: format.number(loss.recordables, "oneDecimal"),
              })}
              badge={t("loss.counts.calculated")}
            />
            <CountRow
              label={t("loss.counts.fatalities", { count: loss.fatalities })}
              badge={t("loss.counts.calculated")}
            />
          </ul>
          {loss.trifrMissing ? (
            <p className="max-w-prose text-muted-foreground text-xs">
              {t("loss.counts.trifrMissing")}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** One derived count with its "Calculated" badge (AC-21). */
function CountRow({ label, badge }: { readonly label: string; readonly badge: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="tabular-nums" data-numeric>
        {label}
      </span>
      <Badge variant="outline">{badge}</Badge>
    </li>
  );
}

/**
 * The suggested experts, third (AC-22): up to three cards with the photo, the name, the headline,
 * the sectors, countries, languages and availability, under one sentence saying ops assigns the
 * expert after a package is bought. There is no button (Follow-up); fewer than three show what
 * there is and zero shows one sentence. Server component.
 */
function ExpertsSection({
  experts,
  t,
  catalogue,
}: {
  readonly experts: readonly ExpertSuggestion[];
  readonly t: Translator;
  readonly catalogue: CatalogueTranslator;
}) {
  return (
    <Card data-experts-card>
      <CardHeader>
        <CardTitle>
          <h3>{t("experts.heading")}</h3>
        </CardTitle>
        <CardDescription>{t("experts.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {experts.length === 0 ? (
          <p className="max-w-prose text-muted-foreground text-sm">{t("experts.empty")}</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-3">
            {experts.map((expert) => (
              <li key={expert.expertId} className="flex flex-col gap-3 rounded-lg border p-4">
                <ExpertAvatar
                  fullName={expert.fullName}
                  photoUrl={expert.photoUrl}
                  className="size-14 shrink-0"
                />
                <div className="flex flex-col gap-0.5">
                  <h4 className="font-semibold text-sm">
                    {expert.fullName ?? t("experts.unnamed")}
                  </h4>
                  {expert.headline ? (
                    <p className="text-muted-foreground text-xs">{expert.headline}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {expert.industries.map((code) => (
                    <Badge key={`i-${code}`} variant="outline">
                      {catalogue(`industries.${code as "A"}`)}
                    </Badge>
                  ))}
                  {expert.countries.map((code) => (
                    <Badge key={`c-${code}`} variant="outline">
                      {code}
                    </Badge>
                  ))}
                  {expert.languages.map((code) => (
                    <Badge key={`l-${code}`} variant="outline">
                      {catalogue(`languages.${code as "de"}`)}
                    </Badge>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("experts.availability", {
                    value: catalogue(`availability.${expert.availability as "available"}`),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The recommended package, fourth (AC-23): the package's own marketing copy (short name, full name,
 * what is included and the price as spec 0011 sells it), the one sentence explaining why the
 * standing chose it, and the buy button into the existing checkout — the enquiry link instead of a
 * price for the retainer, which is sold by conversation. The other packages are one link to the
 * pricing page. Server component.
 */
function PackageSection({
  recommendation,
  locale,
  t,
  packages,
  pricing,
  format,
}: {
  readonly recommendation: SnapshotRecommendation;
  readonly locale: LocaleCode;
  readonly t: Translator;
  readonly packages: PackagesTranslator;
  readonly pricing: PricingTranslator;
  readonly format: Formatter;
}) {
  const entry = PACKAGES.find((item) => item.key === recommendation.packageKey);
  if (!entry) return null;
  const key = entry.key;
  const name = packages(`${key}.shortName` as "sms.shortName");

  return (
    <Card data-package-card data-package={key}>
      <CardHeader>
        <CardTitle>
          <h3>{t("package.heading")}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h4 className="font-semibold text-xl">{name}</h4>
          <p className="text-muted-foreground text-sm">{packages(`${key}.name` as "sms.name")}</p>
        </div>
        <p className="max-w-prose text-sm" data-package-reason>
          {t(`package.reason.${recommendation.reason}` as "package.reason.one_worse")}
        </p>
        <p className="font-semibold text-2xl tabular-nums" data-numeric data-package-price>
          {entry.priceChf === null ? (
            pricing("onDemand")
          ) : (
            <>
              {format.number(entry.priceChf, "chfWhole")}{" "}
              <span className="font-normal text-muted-foreground text-sm">
                {pricing("vatNote")}
              </span>
            </>
          )}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {entry.included.map((point) => (
            <li key={point} className="text-muted-foreground">
              {packages(`${key}.included.${point}` as "sms.included.iso")}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-4">
          {entry.priceChf === null ? (
            <Button asChild>
              <Link href="/contact">{t("package.enquire", { name })}</Link>
            </Button>
          ) : (
            <Button asChild>
              <a href={checkoutPath(localeFromCode(locale), key)}>{t("package.buy", { name })}</a>
            </Button>
          )}
          <Link
            href="/pricing"
            className="text-primary text-sm underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            {t("package.others")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The company facts card (spec 0008, AC-11): the NOGA division, the country and the headcount form
 * under its own title. Since 2026-09-13 (owner decision) it is the only piece left of the "How this
 * is calculated" disclosure: the formula, the assumptions and the inputs used no longer render for
 * the client. Server component.
 */
function FactsCard({
  company,
  t,
}: {
  readonly company: FactsFormProps["company"];
  readonly t: Translator;
}) {
  return (
    <Card data-facts-card>
      <CardHeader>
        <CardTitle>{t("facts.title")}</CardTitle>
        <CardDescription>{t("facts.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FactsForm company={company} />
      </CardContent>
    </Card>
  );
}

function CalculatingState({ label }: { readonly label: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {label}
        </p>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-60" />
      </CardContent>
    </Card>
  );
}
