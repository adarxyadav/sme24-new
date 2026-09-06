import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QuartileBand } from "@/components/ui/quartile-band";
import { Skeleton } from "@/components/ui/skeleton";
import type { BenchmarkState } from "@/features/benchmark/catalogue";
import { roundChf } from "@/features/benchmark/model";
import type { ParsedSnapshot } from "@/features/benchmark/queries";
import type { SnapshotGap, SnapshotPeer, SnapshotResult } from "@/features/benchmark/snapshot";
import {
  isKpiKey,
  KPI_CATALOGUE,
  type KpiFormat,
  type KpiKey,
} from "@/features/research/catalogue";
import type { KpiDefinitionRow } from "@/features/research/queries";
import { ConfidenceBadge } from "@/features/research/ui/badges";
import { localizedText } from "@/features/research/ui/kpi-table";
import type { LocaleCode } from "@/i18n/routing";

export type BenchmarkSegmentProps = {
  readonly snapshot: ParsedSnapshot | null;
  readonly state: BenchmarkState;
  readonly catalogue: readonly KpiDefinitionRow[];
  readonly locale: LocaleCode;
};

type Formatter = Awaited<ReturnType<typeof getFormatter>>;
type Translator = Awaited<ReturnType<typeof getTranslations<"benchmark">>>;

/** How many gaps show before the "show all" disclosure (AC-9). */
const TOP_GAPS = 3;

/** A KPI value in the catalogue's display format (AC-14): percentages from a fraction, absenteeism divided by 100 first. Pure. */
export function formatKpiValue(
  value: number,
  kind: KpiFormat,
  format: Formatter,
  yesNo: { readonly yes: string; readonly no: string },
): string {
  switch (kind) {
    case "integer":
      return format.number(value, "integer");
    case "percent1":
      return format.number(value / 100, "percent");
    case "yesNo":
      return value >= 1 ? yesNo.yes : yesNo.no;
    default:
      return format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

/** The peer quartile of a KPI in display form: the certified share for ISO, else the KPI format. Pure. */
function formatQuartile(
  key: KpiKey,
  value: number,
  format: Formatter,
  yesNo: { readonly yes: string; readonly no: string },
): string {
  if (key === "iso_45001_certified") return format.number(value, "percent");
  return formatKpiValue(value, KPI_CATALOGUE[key].format, format, yesNo);
}

/**
 * The benchmark segment of the dashboard (spec 0008, AC-9): the opportunity card, the priority
 * gaps and the per KPI positions read from the newest snapshot, or one of the three waiting
 * states. Server component.
 */
export async function BenchmarkSegment({
  snapshot,
  state,
  catalogue,
  locale,
}: BenchmarkSegmentProps) {
  const t = await getTranslations("benchmark");
  const research = await getTranslations("research.table");
  const format = await getFormatter();
  const yesNo = { yes: research("yes"), no: research("no") };

  return (
    <section
      aria-labelledby="benchmark-heading"
      className="flex flex-col gap-4"
      data-benchmark-state={state}
    >
      <div className="flex flex-col gap-1">
        <h2 id="benchmark-heading" className="font-semibold text-lg">
          {t("heading")}
        </h2>
        <p className="max-w-prose text-muted-foreground text-sm">{t("description")}</p>
      </div>
      {state === "calculating" ? <CalculatingState label={t("state.calculating")} /> : null}
      {state === "unavailable" ? (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.unavailable")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "noData" ? (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.noData")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "ready" && snapshot ? (
        <>
          {snapshot.peerProvisional ? (
            <p
              className="flex items-start gap-2 text-muted-foreground text-xs"
              data-provisional-note
            >
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t("provisionalNote")}
            </p>
          ) : null}
          <OpportunityCard
            snapshot={snapshot}
            catalogue={catalogue}
            locale={locale}
            t={t}
            format={format}
          />
          <GapList
            snapshot={snapshot}
            catalogue={catalogue}
            locale={locale}
            t={t}
            format={format}
            yesNo={yesNo}
          />
          <PositionList
            snapshot={snapshot}
            catalogue={catalogue}
            locale={locale}
            t={t}
            format={format}
            yesNo={yesNo}
          />
        </>
      ) : null}
    </section>
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

type BlockProps = {
  readonly snapshot: ParsedSnapshot;
  readonly catalogue: readonly KpiDefinitionRow[];
  readonly locale: LocaleCode;
  readonly t: Translator;
  readonly format: Formatter;
};

function kpiName(catalogue: readonly KpiDefinitionRow[], locale: LocaleCode, key: string): string {
  const definition = catalogue.find((entry) => entry.key === key);
  return (definition ? localizedText(definition.name, locale) : "") || key;
}

/** The KPI whose confidence equals the snapshot's (the one that drove the count), among the cost rows. Pure. */
export function confidenceDriver(snapshot: ParsedSnapshot): KpiKey | null {
  const cost = snapshot.blocks.cost;
  if (!cost || snapshot.confidence === null) return null;
  const keys: KpiKey[] = [cost.incidentKpi];
  if (cost.lostDaysSource === "kpi") keys.push("lost_days_per_incident");
  const driver = snapshot.blocks.inputs.kpis.find(
    (input) => keys.includes(input.key) && input.confidence === snapshot.confidence,
  );
  return driver?.key ?? null;
}

function OpportunityCard({ snapshot, catalogue, locale, t, format }: BlockProps) {
  const chf = (value: number) => format.number(roundChf(value), "chfWhole");
  const cost = snapshot.blocks.cost;
  const driver = confidenceDriver(snapshot);
  const computedOn = format.dateTime(new Date(snapshot.createdAt), "dateShort");
  const activeCount = catalogue.length;

  return (
    <Card data-opportunity-card data-cost={snapshot.costChf ?? ""}>
      <CardHeader>
        <CardTitle>{t("card.title")}</CardTitle>
        <CardDescription>{t("card.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {cost && snapshot.costChf !== null ? (
          <>
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-3xl tabular-nums" data-numeric data-cost-headline>
                {chf(snapshot.costChf)}
              </p>
              {snapshot.costLowChf !== null && snapshot.costHighChf !== null ? (
                <p className="text-muted-foreground text-sm tabular-nums" data-numeric>
                  {t("card.range", {
                    low: chf(snapshot.costLowChf),
                    high: chf(snapshot.costHighChf),
                  })}
                </p>
              ) : null}
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="eyebrow text-muted-foreground">{t("card.savingMedian")}</dt>
                <dd className="font-medium tabular-nums" data-numeric data-saving-median>
                  {snapshot.savingMedianChf === null
                    ? t("card.noReference")
                    : chf(snapshot.savingMedianChf)}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="eyebrow text-muted-foreground">{t("card.savingTop")}</dt>
                <dd className="font-medium tabular-nums" data-numeric data-saving-top>
                  {snapshot.savingTopChf === null
                    ? t("card.noReference")
                    : chf(snapshot.savingTopChf)}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              {snapshot.confidence !== null ? (
                <span className="flex items-center gap-1.5">
                  <ConfidenceBadge confidence={snapshot.confidence} />
                  {driver ? (
                    <span>
                      {t("card.confidenceFrom", { kpi: kpiName(catalogue, locale, driver) })}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span data-computed-on>{t("card.computedOn", { date: computedOn })}</span>
            </div>
          </>
        ) : (
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>
              {!snapshot.blocks.inputs.fte
                ? t("card.missingHeadcount")
                : t("card.missingIncidentRate")}
            </AlertTitle>
            <AlertDescription>
              <p data-computed-on>{t("card.computedOn", { date: computedOn })}</p>
            </AlertDescription>
          </Alert>
        )}
        <p className="text-muted-foreground text-sm" data-compared={snapshot.kpisCompared}>
          {t("card.compared", { compared: snapshot.kpisCompared, total: activeCount })}
        </p>
      </CardContent>
    </Card>
  );
}

type ValueProps = BlockProps & { readonly yesNo: { readonly yes: string; readonly no: string } };

function GapItem({
  gap,
  snapshot,
  catalogue,
  locale,
  t,
  format,
  yesNo,
}: ValueProps & { readonly gap: SnapshotGap }) {
  const result = snapshot.blocks.results.find((entry) => entry.key === gap.key);
  const input = snapshot.blocks.inputs.kpis.find((entry) => entry.key === gap.key);
  const kind = KPI_CATALOGUE[gap.key].format;
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border p-4"
      data-gap={gap.key}
      data-rank={gap.rank}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={gap.reason === "fatality" ? "destructive" : "outline"}>
          {t("gaps.rank", { rank: gap.rank })}
        </Badge>
        <span className="font-medium">{kpiName(catalogue, locale, gap.key)}</span>
      </div>
      {gap.reason === "fatality" ? <p className="text-sm">{t("gaps.fatality")}</p> : null}
      {input && result?.peer ? (
        <p className="text-muted-foreground text-sm tabular-nums" data-numeric>
          {t("gaps.versus", {
            value: formatKpiValue(input.value, kind, format, yesNo),
            median: formatQuartile(gap.key, result.peer.median, format, yesNo),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums" data-numeric>
        {gap.gapRelative !== null ? (
          <span>{t("gaps.relative", { percent: format.number(gap.gapRelative, "percent") })}</span>
        ) : null}
        {gap.savingMedianChf !== null ? (
          <span className="font-medium" data-gap-saving>
            {t("gaps.saving", { amount: format.number(roundChf(gap.savingMedianChf), "chfWhole") })}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function GapList(props: ValueProps) {
  const { snapshot, t } = props;
  const gaps = snapshot.blocks.gaps;
  const top = gaps.slice(0, TOP_GAPS);
  const rest = gaps.slice(TOP_GAPS);
  return (
    <section aria-labelledby="gaps-heading" className="flex flex-col gap-3" data-gaps={gaps.length}>
      <div className="flex flex-col gap-1">
        <h3 id="gaps-heading" className="font-semibold">
          {t("gaps.title")}
        </h3>
        <p className="max-w-prose text-muted-foreground text-sm">{t("gaps.description")}</p>
      </div>
      {gaps.length === 0 ? (
        <Alert variant="success">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("gaps.empty")}</AlertTitle>
        </Alert>
      ) : (
        <>
          <ol className="grid gap-3 md:grid-cols-3">
            {top.map((gap) => (
              <GapItem key={gap.key} gap={gap} {...props} />
            ))}
          </ol>
          {rest.length > 0 ? (
            <details className="group rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                {t("gaps.showAll", { count: gaps.length })}
              </summary>
              <ol className="grid gap-3 border-t p-4 md:grid-cols-3">
                {rest.map((gap) => (
                  <GapItem key={gap.key} gap={gap} {...props} />
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function peerLabel(peer: SnapshotPeer, t: Translator): string {
  const section =
    peer.industrySection === "ALL"
      ? t("positions.allIndustries")
      : t(`noga.sections.${peer.industrySection as "A"}`);
  const band = t(`sizeBands.${peer.sizeBand}`);
  const year =
    peer.yearMatch === "nearest"
      ? `${peer.periodYear} (${t("positions.nearestYear")})`
      : String(peer.periodYear);
  const base = t("positions.peer", { section, band, year });
  return peer.sampleSize === null
    ? base
    : `${base}, ${t("positions.sample", { n: peer.sampleSize })}`;
}

function PositionRow({
  definition,
  result,
  snapshot,
  catalogue,
  locale,
  t,
  format,
  yesNo,
}: ValueProps & {
  readonly definition: KpiDefinitionRow;
  readonly result: SnapshotResult | undefined;
}) {
  const name = kpiName(catalogue, locale, definition.key);
  const input = snapshot.blocks.inputs.kpis.find((entry) => entry.key === definition.key);
  const key = isKpiKey(definition.key) ? definition.key : null;
  const kind: KpiFormat = key ? KPI_CATALOGUE[key].format : "decimal2";
  const value = input ? formatKpiValue(input.value, kind, format, yesNo) : null;
  const peer = result?.peer ?? null;
  const quartiles =
    peer && key
      ? {
          p25: formatQuartile(key, peer.p25, format, yesNo),
          median: formatQuartile(key, peer.median, format, yesNo),
          p75: formatQuartile(key, peer.p75, format, yesNo),
        }
      : null;
  const bandLabel = result?.position ? t(`positions.band.${result.position}`) : null;

  return (
    <li
      className="grid gap-2 rounded-lg border p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      data-position-kpi={definition.key}
      data-position={result?.position ?? ""}
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground text-xs">{definition.unit}</span>
        {value !== null ? (
          <span className="font-medium tabular-nums" data-numeric data-value={input?.value}>
            {value}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{t("positions.noValue")}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {peer && input && quartiles && bandLabel ? (
          <>
            {kind !== "yesNo" ? (
              <QuartileBand
                p25={peer.p25}
                median={peer.median}
                p75={peer.p75}
                value={input.value}
                label={t("positions.srBand", {
                  kpi: name,
                  value: value ?? "",
                  band: bandLabel,
                  p25: quartiles.p25,
                  median: quartiles.median,
                  p75: quartiles.p75,
                })}
              />
            ) : null}
            <span className="text-sm">{bandLabel}</span>
            <span className="text-muted-foreground text-xs tabular-nums" data-numeric>
              {t("positions.quartiles", quartiles)}
            </span>
            <span className="text-muted-foreground text-xs">{peerLabel(peer, t)}</span>
          </>
        ) : value !== null ? (
          <span className="text-muted-foreground text-sm">{t("positions.noPeer")}</span>
        ) : null}
      </div>
    </li>
  );
}

function PositionList(props: ValueProps) {
  const { snapshot, catalogue, t } = props;
  return (
    <section aria-labelledby="positions-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="positions-heading" className="font-semibold">
          {t("positions.title")}
        </h3>
        <p className="max-w-prose text-muted-foreground text-sm">{t("positions.description")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {catalogue.map((definition) => (
          <PositionRow
            key={definition.key}
            definition={definition}
            result={snapshot.blocks.results.find((entry) => entry.key === definition.key)}
            {...props}
          />
        ))}
      </ul>
    </section>
  );
}
