import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { QuartileBand } from "@/components/ui/quartile-band";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { BenchmarkState } from "@/features/benchmark/catalogue";
import { roundChf, roundChfRange } from "@/features/benchmark/model";
import type { AssumptionRow, ParsedSnapshot } from "@/features/benchmark/queries";
import {
  type DerivedCount,
  peerShapeOf,
  type SnapshotBlocks,
  type SnapshotGap,
} from "@/features/benchmark/snapshot";
import {
  confidenceLevel,
  isKpiKey,
  KPI_CATALOGUE,
  type KpiFormat,
  type KpiKey,
} from "@/features/research/catalogue";
import type { KpiDefinitionRow } from "@/features/research/queries";
import { ConfidenceBadge } from "@/features/research/ui/badges";
import { localizedText } from "@/features/research/ui/kpi-table";
import type { LocaleCode } from "@/i18n/routing";
import { CalculationContent } from "./calculation-content";
import { CalculationDisclosure } from "./calculation-disclosure";
import { FactsForm, type FactsFormProps } from "./facts-form";
import { formatKpiValue } from "./format";

export type BenchmarkSegmentProps = {
  readonly snapshot: ParsedSnapshot | null;
  readonly state: BenchmarkState;
  readonly catalogue: readonly KpiDefinitionRow[];
  /** The assumption rows for the disclosure labels (AC-10). */
  readonly assumptions: readonly AssumptionRow[];
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
   * `noData` means a snapshot compared zero KPIs, so entering a figure by hand is the remedy the
   * alert is asking for and the card belongs beside it rather than further down the page. A
   * caller that has no client KPI form to offer — the expert view, which is `readOnly` — passes
   * nothing and the state renders as it did before.
   */
  readonly figuresSlot?: React.ReactNode;
};

type Formatter = Awaited<ReturnType<typeof getFormatter>>;
type Translator = Awaited<ReturnType<typeof getTranslations<"benchmark">>>;

/** How many gaps show before the "show all" disclosure (AC-9). */
const TOP_GAPS = 3;

/** The peer quartile of a KPI in display form: the certified share for ISO, else the KPI format. Pure. */
function formatQuartile(
  key: KpiKey,
  value: number,
  format: Formatter,
  yesNo: { readonly yes: string; readonly no: string },
): string {
  if (key === "iso_45001_certified") return format.number(value, "percent");
  // The fatality peer row is a rate per 100 000 employed persons, never the count's whole number
  // format (spec 0016 amendment, AC-23); the unit is added by the caller.
  if (key === "fatalities") return formatKpiValue(value, "decimal2", format, yesNo);
  return formatKpiValue(value, KPI_CATALOGUE[key].format, format, yesNo);
}

/**
 * The benchmark segment of the dashboard (spec 0008, AC-9): the opportunity card, the priority
 * gaps and the per KPI positions read from the newest snapshot, or one of the three waiting
 * states. The `noData` state also carries the caller's `figuresSlot`, so the client KPI form sits
 * beside the alert that asks for a figure. Server component.
 */
export async function BenchmarkSegment({
  snapshot,
  state,
  catalogue,
  assumptions,
  company,
  locale,
  readOnly = false,
  figuresSlot,
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
        <>
          <Alert variant="info">
            <InfoIcon aria-hidden="true" />
            <AlertTitle>{t("state.noData")}</AlertTitle>
          </Alert>
          {readOnly ? null : figuresSlot}
          {readOnly ? null : (
            <Card>
              <CardHeader>
                <CardTitle>{t("disclosure.correctTitle")}</CardTitle>
                <CardDescription>{t("disclosure.correctDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <FactsForm company={company} />
              </CardContent>
            </Card>
          )}
        </>
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
            company={company}
            readOnly={readOnly}
          />
          <CalculationDisclosure title={t("disclosure.title")}>
            <CalculationFacts
              snapshot={snapshot}
              catalogue={catalogue}
              locale={locale}
              t={t}
              format={format}
            />
            <CalculationContent
              snapshot={snapshot}
              catalogue={catalogue}
              assumptions={assumptions}
              locale={locale}
            />
            {readOnly ? null : (
              <section className="flex flex-col gap-2" data-correct-facts>
                <h4 className="font-semibold text-sm">{t("disclosure.correctTitle")}</h4>
                <p className="max-w-prose text-muted-foreground text-sm">
                  {t("disclosure.correctDescription")}
                </p>
                <FactsForm company={company} />
              </section>
            )}
          </CalculationDisclosure>
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

/**
 * The catalogue name without its parenthetical gloss, for use inside a sentence: a column heading
 * wants "LTIFR (lost time injury frequency rate)", a provenance line wants "LTIFR" (spec 0012,
 * AC-4). A name with no parenthesis is returned unchanged. Pure.
 *
 * Assumes a catalogue name uses " (" only to open a gloss, in both languages. A KPI name that
 * ever carries a parenthesis as part of the term itself would be truncated here, so a new
 * `kpi_definitions` name keeps the gloss last and everything before it self contained.
 */
function shortKpiName(name: string): string {
  return name.split(" (")[0]?.trim() || name;
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

/**
 * One derived injury count as a plain row of the disclosure (spec 0012): the label, the number to
 * one decimal (AC-8) and a sentence naming the rate and year it came from (AC-4). Its "Calculated
 * from" wording is what marks the number as calculated rather than researched or typed in, now
 * that no badge sits beside it. Never a confidence score (AC-5). Server component.
 */
function DerivedCountRow({
  count,
  label,
  testId,
  catalogue,
  locale,
  t,
  format,
}: {
  readonly count: DerivedCount;
  readonly label: string;
  readonly testId: string;
  readonly catalogue: readonly KpiDefinitionRow[];
  readonly locale: LocaleCode;
  readonly t: Translator;
  readonly format: Formatter;
}) {
  // The Suva rate gets its own short phrase: the catalogue name reads as an unreadable sentence
  // when interpolated ("Calculated from your Accident rate per 1 000 FTE for 2024").
  const suva = count.fromKey === "accident_rate_per_1000_fte";
  const client = count.fromSource === "client";
  const provenance = suva
    ? t(client ? "derived.fromClientSuva" : "derived.fromResearchSuva", { year: count.fromYear })
    : t(client ? "derived.fromClient" : "derived.fromResearch", {
        kpi: shortKpiName(kpiName(catalogue, locale, count.fromKey)),
        year: count.fromYear,
      });

  return (
    <li data-derived-count={testId}>
      <span className="text-foreground">{label}</span>
      {": "}
      <span className="tabular-nums" data-numeric data-derived-value>
        {format.number(count.count, "oneDecimal")}
      </span>
      {" · "}
      <span data-derived-from={count.fromKey}>{provenance}</span>
    </li>
  );
}

/**
 * The rows that describe the snapshot rather than price it, at the top of "How this is
 * calculated" (owner decision of 2026-09-13, recorded in spec 0012): the computed on date, how
 * many KPIs were compared, which KPI drove the confidence, and the derived injury counts with
 * their provenance and the note that only lost time accidents are priced (spec 0016, AC-31).
 * They left the opportunity card so it carries the cost and the two savings alone. Server component.
 */
function CalculationFacts({ snapshot, catalogue, locale, t, format }: BlockProps) {
  // Absent on a stored version 1 row and whenever nothing could be derived (spec 0012, AC-7, AC-12).
  const derived = snapshot.blocks.derived ?? null;
  const driver = confidenceDriver(snapshot);
  const computedOn = format.dateTime(new Date(snapshot.createdAt), "dateShort");

  return (
    <section className="flex flex-col gap-2 text-sm" data-calculation-facts>
      <h4 className="font-semibold">{t("disclosure.aboutTitle")}</h4>
      <ul className="flex flex-col gap-1 text-muted-foreground">
        <li data-computed-on>{t("disclosure.computedOn", { date: computedOn })}</li>
        <li data-compared={snapshot.kpisCompared}>
          {t("disclosure.compared", { compared: snapshot.kpisCompared, total: catalogue.length })}
        </li>
        {driver ? (
          <li data-confidence-from={driver}>
            {t("disclosure.confidenceFrom", { kpi: kpiName(catalogue, locale, driver) })}
          </li>
        ) : null}
        {derived?.lostTime ? (
          <DerivedCountRow
            count={derived.lostTime}
            label={t("derived.lostTime")}
            testId="lost-time"
            catalogue={catalogue}
            locale={locale}
            t={t}
            format={format}
          />
        ) : null}
        {derived?.recordable ? (
          <DerivedCountRow
            count={derived.recordable}
            label={t("derived.recordable")}
            testId="recordable"
            catalogue={catalogue}
            locale={locale}
            t={t}
            format={format}
          />
        ) : null}
        {/* The recordable count is shown for context and never priced: say so beside it (spec
            0016 amendment, AC-31). */}
        {derived?.recordable ? <li data-derived-priced>{t("derived.priced")}</li> : null}
      </ul>
    </section>
  );
}

/**
 * The annual incident cost (spec 0008, AC-9): the title with the confidence spelled out beside
 * it, the outward rounded range (spec 0016, AC-9), one line with the working estimate and the
 * lost time count it is built from (spec 0012, AC-1), then the two savings. Everything that
 * explains the arithmetic sits in the disclosure below (`CalculationFacts`). Without a cost the
 * card names the missing input and offers the facts form. Server component.
 */
function OpportunityCard({
  snapshot,
  t,
  format,
  company,
  readOnly,
}: BlockProps & {
  readonly company: FactsFormProps["company"];
  readonly readOnly: boolean;
}) {
  const chf = (value: number) => format.number(roundChf(value), "chfWhole");
  const cost = snapshot.blocks.cost;
  // Rounded outward, so the displayed band always contains the computed one (spec 0016, AC-9).
  const range =
    snapshot.costLowChf !== null && snapshot.costHighChf !== null
      ? roundChfRange(snapshot.costLowChf, snapshot.costHighChf)
      : null;
  // Absent on a stored version 1 row and whenever nothing could be derived; the working estimate
  // then stands without its injuries clause (spec 0012, AC-7, AC-12).
  const derived = snapshot.blocks.derived ?? null;
  const value = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );
  // A saving of zero is a position, not a broken sum: the company already sits at or below that
  // peer mark. `null` means the model had no peer reference to measure against at all.
  const saving = (amount: number | null) =>
    amount === null ? (
      t("card.noReference")
    ) : amount <= 0 ? (
      <span className="text-foreground">{t("card.atOrBelow")}</span>
    ) : (
      t.rich("card.savingValue", {
        amount: chf(amount),
        value: (chunks) => <span className="font-medium text-foreground text-lg">{chunks}</span>,
      })
    );

  return (
    <Card data-opportunity-card data-cost={snapshot.costChf ?? ""}>
      <CardHeader>
        <CardTitle>{t("card.title")}</CardTitle>
        {snapshot.confidence !== null ? (
          <CardAction>
            <ConfidenceBadge
              confidence={snapshot.confidence}
              label={t(`card.confidence.${confidenceLevel(snapshot.confidence)}`)}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {cost && snapshot.costChf !== null ? (
          <>
            {/* The range leads and the point estimate sits beneath it as the working estimate
                (spec 0016, AC-9): the multiplier behind the single figure is a declared assumption,
                so the honest headline is the band it sits in. The ends round outward, so the shown
                band always contains the computed one. */}
            <div className="flex flex-col gap-1.5">
              {range ? (
                <>
                  <p
                    className="font-semibold text-3xl tabular-nums"
                    data-numeric
                    data-cost-range
                    data-cost-low={range.low}
                    data-cost-high={range.high}
                  >
                    {t("card.rangeHeadline", {
                      low: format.number(range.low, "chfWhole"),
                      high: format.number(range.high, "chfWhole"),
                    })}
                  </p>
                  <p
                    className="text-muted-foreground text-sm tabular-nums"
                    data-numeric
                    data-cost-headline
                  >
                    {derived?.lostTime
                      ? t.rich("card.workingDerived", {
                          cost: chf(snapshot.costChf),
                          count: format.number(derived.lostTime.count, "oneDecimal"),
                          fte: format.number(derived.fte, "integer"),
                          value,
                        })
                      : t.rich("card.working", { cost: chf(snapshot.costChf), value })}
                  </p>
                </>
              ) : (
                <p className="font-semibold text-3xl tabular-nums" data-numeric data-cost-headline>
                  {chf(snapshot.costChf)}
                </p>
              )}
            </div>
            <Separator />
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="text-label-13 text-muted-foreground">{t("card.savingMedian")}</dt>
                <dd
                  className="text-muted-foreground text-sm tabular-nums"
                  data-numeric
                  data-saving-median
                >
                  {saving(snapshot.savingMedianChf)}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-label-13 text-muted-foreground">{t("card.savingTop")}</dt>
                <dd
                  className="text-muted-foreground text-sm tabular-nums"
                  data-numeric
                  data-saving-top
                >
                  {saving(snapshot.savingTopChf)}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>
                {!snapshot.blocks.inputs.fte
                  ? t("card.missingHeadcount")
                  : t("card.missingIncidentRate")}
              </AlertTitle>
            </Alert>
            {readOnly ? null : <FactsForm company={company} />}
          </>
        )}
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

/**
 * The peer group in words. Names the source's own classification when the row carries one, else
 * the section, band and year as before (spec 0016, AC-6). A row reached on rung 3 or 4 says the
 * group was broadened (AC-6b): the shape can flip on fallback, so a company whose own section has
 * no row must not silently gain a band drawn from the wider `ALL` row. Pure.
 */
function peerLabel(
  peer: SnapshotBlocks["results"][number]["peer"] & object,
  t: Translator,
): string {
  const broadened = peer.rung >= 3 && peer.industrySection === "ALL";
  const section = peer.sourceKey
    ? peer.sourceKey
    : broadened
      ? t("positions.broadened")
      : peer.industrySection === "ALL"
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
  // The blocks' own result type, so a version 3 peer keeps its shape and source columns and a
  // stored @1 or @2 peer is still accepted without them (spec 0016, AC-12).
  readonly result: SnapshotBlocks["results"][number] | undefined;
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
  // A stored @1 or @2 row carries no shape, so derive it from the values it does carry: the rule
  // is the same one the model applies (spec 0016, AC-4, AC-12).
  const shape = peer ? (peer.shape ?? peerShapeOf(peer)) : null;
  const sectorFigure =
    peer && key
      ? key === "fatalities"
        ? t("positions.fatalityRate", { value: formatQuartile(key, peer.median, format, yesNo) })
        : formatQuartile(key, peer.median, format, yesNo)
      : null;
  // The value the position was judged on when it differs from the stored one: the fatality rate
  // (spec 0016 amendment, AC-22). Absent on a stored @1 to @3 row.
  const comparedValue = result?.comparedValue ?? null;
  const fte = snapshot.blocks.inputs.fte;

  return (
    <li
      className="grid gap-2 rounded-lg border p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      data-position-kpi={definition.key}
      data-position={result?.position ?? ""}
      data-peer-shape={shape ?? ""}
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
        {peer && input && quartiles && bandLabel && sectorFigure ? (
          shape === "point" ? (
            // A point row holds one figure repeated as all three quartiles, so it gets no band and
            // no replacement graphic: one labelled sector figure, and never the words quarter,
            // quartile or median (spec 0016, AC-6).
            <>
              <span className="sr-only">
                {t("positions.srSector", {
                  kpi: name,
                  // A fatality count was judged as a rate, so the narration compares the rate to
                  // the sector rate rather than a count to a rate (amendment D3, AC-23); the
                  // count itself is read from the value column.
                  value:
                    comparedValue !== null && key === "fatalities"
                      ? t("positions.fatalityRate", {
                          value: formatKpiValue(comparedValue, "decimal2", format, yesNo),
                        })
                      : (value ?? ""),
                  band: bandLabel,
                  sector: sectorFigure,
                })}
              </span>
              <span className="text-sm" aria-hidden="true">
                {bandLabel}
              </span>
              <span
                className="text-muted-foreground text-xs tabular-nums"
                data-numeric
                data-sector-figure={peer.median}
                aria-hidden="true"
              >
                {t("positions.sector", { value: sectorFigure })}
              </span>
              {comparedValue !== null && key === "fatalities" ? (
                <span
                  className="text-muted-foreground text-xs tabular-nums"
                  data-numeric
                  data-compared-value={comparedValue}
                >
                  {t("positions.fatalityCompared", {
                    value: t("positions.fatalityRate", {
                      value: formatKpiValue(comparedValue, "decimal2", format, yesNo),
                    }),
                  })}
                </span>
              ) : null}
              <span className="text-muted-foreground text-xs">{t("positions.pointBasis")}</span>
              <span className="text-muted-foreground text-xs">{peerLabel(peer, t)}</span>
            </>
          ) : (
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
          )
        ) : value !== null ? (
          // A KPI with no peer row says why (spec 0016, AC-8): a `no_source` KPI is one no Swiss
          // body publishes, so it gets its own sentence rather than the shared "not yet", which
          // would have the client waiting for data that is never coming.
          <span className="flex flex-col gap-0.5 text-muted-foreground text-sm" data-no-peer>
            <span>
              {key && KPI_CATALOGUE[key].peerStatus === "no_source"
                ? t("positions.peerStatus.noSourceTitle")
                : key && KPI_CATALOGUE[key].peerStatus === "pending"
                  ? t("positions.peerStatus.pendingTitle")
                  : t("positions.noPeer")}
            </span>
            {key === "fatalities" && !(fte && fte > 0) ? (
              // A count cannot become a rate without a headcount, so the model compared nothing
              // (spec 0016 amendment, D3, AC-23): say what is missing rather than "no peer data".
              <span className="text-xs" data-fatality-needs-headcount>
                {t("positions.fatalityNeedsHeadcount")}
              </span>
            ) : key ? (
              <span className="text-xs" data-peer-status={KPI_CATALOGUE[key].peerStatus}>
                {t(KPI_CATALOGUE[key].peerNote as "positions.noPeer")}
              </span>
            ) : null}
          </span>
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
