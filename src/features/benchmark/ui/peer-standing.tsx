import type { getFormatter, getTranslations } from "next-intl/server";
import type { GeoRung, PeerKpiKey } from "@/features/benchmark/catalogue";
import { roundChf } from "@/features/benchmark/model";
import type { SnapshotPeerBlock, SnapshotPeerRow } from "@/features/benchmark/snapshot";
import { KPI_CATALOGUE, type KpiFormat } from "@/features/research/catalogue";
import type { LocaleCode } from "@/i18n/routing";
import { countryName, type Region, regionOf } from "@/lib/countries";
import { formatKpiValue } from "./format";

type Formatter = Awaited<ReturnType<typeof getFormatter>>;
type Translator = Awaited<ReturnType<typeof getTranslations<"benchmark">>>;

export type PeerStandingProps = {
  /** The `benchmark` translator and the formatter of the page, passed in so the card renders in one pass. */
  readonly t: Translator;
  readonly format: Formatter;
  readonly block: SnapshotPeerBlock;
  /** The client's own value for the KPI, `null` when the snapshot holds no row for it. */
  readonly clientValue: number | null;
  /** The client's country as the snapshot copied it (`inputs.country`), absent on an older row. */
  readonly clientCountry: string | undefined;
  /** The client's NACE section for the industry word. */
  readonly section: string | null;
  readonly kpiName: string;
  readonly locale: LocaleCode;
  readonly yesNo: { readonly yes: string; readonly no: string };
};

const STRIP_WIDTH = 320;
const STRIP_HEIGHT = 28;
const STRIP_PADDING = 10;

/** The scope phrase of a rung (spec 0021, AC-10): the client's country by name, the region's own message, Europe or the world. Pure. */
function scopeOf(
  t: Translator,
  geoRung: GeoRung,
  clientCountry: string | undefined,
  locale: LocaleCode,
): string {
  const country = clientCountry ? countryName(clientCountry, locale) : "";
  const region: Region | null = regionOf(clientCountry);
  switch (geoRung) {
    case "country":
      return t("peers.rung.country", { country });
    case "region":
      return t("peers.rung.region", { region: region ? t(`peers.region.${region}`) : "" });
    case "europe":
      return t("peers.rung.europe");
    default:
      return t("peers.rung.world");
  }
}

/** A peer's value in the KPI's display format; the ISO share is yes or no. Pure. */
function displayValue(
  key: PeerKpiKey,
  value: number,
  format: Formatter,
  yesNo: PeerStandingProps["yesNo"],
): string {
  const kind: KpiFormat = KPI_CATALOGUE[key].format;
  return formatKpiValue(value, kind, format, yesNo);
}

/**
 * The strip (spec 0021, AC-10): the KPI's scale with one marker per peer and the client's marker
 * only when the client has a value; decorative, with the `sr-only` sentence beside it carrying
 * the meaning. Server component.
 */
function PeerStrip({
  rows,
  clientValue,
  label,
}: {
  readonly rows: readonly SnapshotPeerRow[];
  readonly clientValue: number | null;
  readonly label: string;
}) {
  const values = [...rows.map((row) => row.value), ...(clientValue === null ? [] : [clientValue])];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const margin = span * 0.08;
  const scale = (n: number) =>
    STRIP_PADDING +
    ((n - (low - margin)) / (span + 2 * margin)) * (STRIP_WIDTH - 2 * STRIP_PADDING);
  const mid = STRIP_HEIGHT / 2;
  return (
    <span data-slot="peer-strip" className="block w-full max-w-xl">
      <svg
        viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`}
        className="block h-7 w-full"
        aria-hidden="true"
        data-peers={rows.length}
        data-client-value={clientValue ?? ""}
      >
        <line
          x1={STRIP_PADDING}
          x2={STRIP_WIDTH - STRIP_PADDING}
          y1={mid}
          y2={mid}
          stroke="var(--chart-3)"
          strokeWidth={1}
          strokeOpacity={0.6}
        />
        {rows.map((row) => (
          <circle
            key={row.peerKey}
            cx={scale(row.value)}
            cy={mid}
            r={4.5}
            fill="var(--chart-3)"
            stroke="var(--background)"
            strokeWidth={1}
          />
        ))}
        {clientValue === null ? null : (
          <circle
            cx={scale(clientValue)}
            cy={mid}
            r={6}
            fill="var(--chart-1)"
            stroke="var(--background)"
            strokeWidth={1.5}
          />
        )}
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The Peer Standing card (spec 0021, AC-10): for a KPI with a peer block, the rank line with the
 * word "publish" always in it, the sentence naming the gap to the best peer, the strip, the table
 * with the client's own row at its rank and its saving at every peer it is behind, and the rung
 * sentence. Money appears only on the client's rows, never as a peer's cost. Renders wherever its
 * caller does: the positions list on the server, the gallery in the browser.
 */
export function PeerStanding({
  t,
  format,
  block,
  clientValue,
  clientCountry,
  section,
  kpiName,
  locale,
  yesNo,
}: PeerStandingProps) {
  const kpi = t(`peers.kpi.${block.key}`);
  const industry = section ? t(`noga.sections.${section as "A"}`) : "";
  const scope = scopeOf(t, block.geoRung, clientCountry, locale);
  const count = block.rows.length;
  const value = (n: number) => displayValue(block.key, n, format, yesNo);
  const best = block.rows[0];
  const worst = block.rows[count - 1];
  const bestRow = block.rows.find((row) => row.peerKey === block.best) ?? best;
  const chf = (amount: number) => format.number(roundChf(amount), "chfWhole");
  const isIso = block.key === "iso_45001_certified";
  const certified = isIso ? Math.round((block.certifiedShare ?? 0) * count) : 0;
  // The client's own row sits at its rank position: after every peer that ranks strictly better.
  const clientIndex = block.rank === null ? null : Math.min(block.rank - 1, count);
  const country = clientCountry ? countryName(clientCountry, locale) : "";
  const rungSentence = (() => {
    const region = regionOf(clientCountry);
    switch (block.geoRung) {
      case "country":
        return t("peers.rung.sentence.country", { country });
      case "region":
        return t("peers.rung.sentence.region", {
          country,
          kpi,
          region: region ? t(`peers.region.${region}`) : "",
        });
      case "europe":
        return t("peers.rung.sentence.europe", { country, kpi });
      default:
        return t("peers.rung.sentence.world", { kpi });
    }
  })();
  const saving = (row: SnapshotPeerRow) =>
    row.savingAtPeer === null
      ? t("peers.table.noSaving")
      : row.savingAtPeer === "already_ahead"
        ? t("peers.table.alreadyAhead")
        : chf(row.savingAtPeer);

  return (
    <div
      className="flex flex-col gap-4"
      data-peer-standing={block.key}
      data-geo-rung={block.geoRung}
      data-rank={block.rank ?? ""}
      data-peer-count={count}
    >
      {isIso ? (
        <p className="text-sm" data-iso-share>
          {t("peers.iso.share", { certified, count })}{" "}
          {clientValue === null
            ? null
            : clientValue >= 1
              ? t("peers.iso.youYes")
              : t("peers.iso.youNo")}
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2" data-rank-line>
            {block.rank !== null ? (
              <span className="font-medium text-3xl tabular-nums tracking-headline" data-numeric>
                {t("peers.rank.ordinal", { rank: block.rank })}
              </span>
            ) : null}
            <span className="text-muted-foreground text-sm">
              {block.rank !== null
                ? t("peers.rank.ranked", { count, industry, scope, kpi })
                : t("peers.rank.unranked", { count, industry, scope, kpi })}
            </span>
          </p>
          {block.rank !== null && bestRow && block.gapToBest !== null ? (
            <p className="text-sm" data-gap-line>
              {block.rank === 1
                ? t("peers.rank.leading", { name: bestRow.name })
                : t("peers.rank.gap", {
                    gap: value(Math.abs(block.gapToBest)),
                    name: bestRow.name,
                  })}
            </p>
          ) : null}
          {best && worst ? (
            <PeerStrip
              rows={block.rows}
              clientValue={clientValue}
              label={
                clientValue === null
                  ? t("peers.srStripNoValue", {
                      count,
                      scope,
                      best: value(best.value),
                      worst: value(worst.value),
                    })
                  : t("peers.srStrip", {
                      value: value(clientValue),
                      count,
                      scope,
                      best: value(best.value),
                      worst: value(worst.value),
                    })
              }
            />
          ) : null}
        </>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-peer-table>
          <caption className="sr-only">{t("peers.table.caption", { kpi })}</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("peers.table.company")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("peers.table.country")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("peers.table.basis")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("peers.table.year")}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {kpiName}
              </th>
              {isIso ? null : (
                <th scope="col" className="py-2 text-right font-medium">
                  {t("peers.table.saving")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {block.rows.flatMap((row, index) => {
              const clientRow =
                clientIndex === index && clientValue !== null && clientCountry ? (
                  <tr key="client" className="border-b font-medium" data-client-row>
                    <td className="py-2 pr-3">{t("peers.table.you")}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{clientCountry}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {t("peers.table.employees")}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground" />
                    <td className="py-2 pr-3 text-right tabular-nums" data-numeric>
                      {value(clientValue)}
                    </td>
                    {isIso ? null : <td className="py-2 text-right text-muted-foreground" />}
                  </tr>
                ) : null;
              const peerRow = (
                <tr key={row.peerKey} className="border-b" data-peer-row={row.peerKey}>
                  <td className="py-2 pr-3">
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={t("peers.table.sourceLink", { name: row.name })}
                    >
                      {row.name}
                    </a>
                    <span className="block text-muted-foreground text-xs tabular-nums" data-numeric>
                      {t("peers.table.headcount", {
                        n: format.number(row.headcount, "integer"),
                        year: String(row.headcountYear),
                      })}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{row.country}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {t(`peers.table.${row.basis}`)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground tabular-nums" data-numeric>
                    {row.periodYear}
                  </td>
                  <td
                    className="py-2 pr-3 text-right tabular-nums"
                    data-numeric
                    data-value={row.value}
                    title={
                      row.unitAsPublished === "per_200k_hours"
                        ? t("peers.table.asPublished", {
                            value: format.number(row.valueAsPublished, {
                              maximumFractionDigits: 2,
                            }),
                          })
                        : undefined
                    }
                  >
                    {value(row.value)}
                  </td>
                  {isIso ? null : (
                    <td
                      className="py-2 text-right text-muted-foreground tabular-nums"
                      data-numeric
                      data-saving
                    >
                      {saving(row)}
                    </td>
                  )}
                </tr>
              );
              return clientRow ? [clientRow, peerRow] : [peerRow];
            })}
            {clientIndex === count && clientValue !== null && clientCountry ? (
              <tr key="client-last" className="border-b font-medium" data-client-row>
                <td className="py-2 pr-3">{t("peers.table.you")}</td>
                <td className="py-2 pr-3 text-muted-foreground">{clientCountry}</td>
                <td className="py-2 pr-3 text-muted-foreground">{t("peers.table.employees")}</td>
                <td className="py-2 pr-3 text-muted-foreground" />
                <td className="py-2 pr-3 text-right tabular-nums" data-numeric>
                  {value(clientValue)}
                </td>
                {isIso ? null : <td className="py-2 text-right text-muted-foreground" />}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="max-w-prose text-muted-foreground text-xs" data-rung-sentence>
        {rungSentence} {t("peers.rung.larger")}
      </p>
    </div>
  );
}
