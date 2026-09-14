import { render } from "@testing-library/react";
import { createFormatter, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { MODEL_VERSION } from "@/features/benchmark/catalogue";
import type { ParsedSnapshot } from "@/features/benchmark/queries";
import type { InputKpi, SnapshotBlocks, SnapshotPeerRow } from "@/features/benchmark/snapshot";
import type { KpiKey } from "@/features/research/catalogue";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { definition, en } from "../../research/ui/helpers";

export { definition, en };

export const COMPANY_ID = "0c000000-0000-4000-8000-00000000000a";
export const SNAPSHOT_ID = "0e000000-0000-4000-8000-000000000001";
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The English formatter the server components read, so a test builds the exact string it expects. */
export const enFormat = createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE });

/** Renders a server rendered element under the English catalog, the named formats and the Swiss time zone. */
export function renderEnglish(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en-CH" messages={en} formats={formats} timeZone={TIME_ZONE}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const KPI_INDEX: readonly KpiKey[] = ["ltifr", "trifr", "fatalities"];

/** A KPI input as the task stores it in `inputs.kpis`. */
export function inputKpi(key: KpiKey, value: number, overrides: Partial<InputKpi> = {}): InputKpi {
  return {
    key,
    rowId: UUID(100 + KPI_INDEX.indexOf(key)),
    value,
    periodYear: 2025,
    source: "research",
    confidence: 0.9,
    researchRunId: UUID(9),
    ...overrides,
  };
}

/** One kept peer as `@7` stores it (spec 0022, AC-13). */
export function peerRow(
  peerName: string,
  ltifr: number | null,
  trifr: number | null,
  overrides: Partial<SnapshotPeerRow> = {},
): SnapshotPeerRow {
  return {
    peerName,
    country: "CH",
    headcount: 1_000,
    periodYear: 2024,
    ltifr,
    trifr,
    sourceUrl: `https://example.org/${peerName}`,
    confidence: 0.8,
    estimatedLoss: 500_000,
    ...overrides,
  };
}

/** The dashboard catalogue: the seven active KPIs in sort order (spec 0022, AC-4 retired the eighth). */
export const catalogue = [
  definition("ltifr", { sort_order: 2 }),
  definition("trifr", { sort_order: 3 }),
  definition("lost_days_per_incident", { sort_order: 4, unit: "days" }),
  definition("absenteeism_rate", { sort_order: 5, unit: "percent" }),
  definition("fatalities", { sort_order: 6, unit: "count" }),
  definition("iso_45001_certified", {
    sort_order: 7,
    unit: "yes or no",
    direction: "higher_is_better",
  }),
  definition("near_miss_rate", { sort_order: 8, direction: "higher_is_better" }),
];

/** The blocks of a `@7` snapshot: 500 FTE at LTIFR 6 and TRIFR 10, against three country peers. */
export function readyBlocks(overrides: Partial<SnapshotBlocks> = {}): SnapshotBlocks {
  return {
    inputs: {
      fte: 500,
      section: "C",
      industryCode: "23.61",
      country: "CH",
      currency: "CHF",
      companyUpdatedAt: "2026-09-14T07:00:00.000Z",
      kpis: [inputKpi("ltifr", 6), inputKpi("trifr", 10)],
    },
    peers: {
      rung: "country",
      thin: false,
      rows: [
        peerRow("Alpha AG", 2, 5, { estimatedLoss: 275_000 }),
        peerRow("Beta SA", 4, 9, { headcount: 2_400, estimatedLoss: 1_100_000 }),
        peerRow("Gamma GmbH", 8, 13, { headcount: null, estimatedLoss: null }),
      ],
      rates: {
        ltifr: { count: 3, median: 4, best: 2, rank: 3, of: 4, gapToMedian: 2 },
        trifr: { count: 3, median: 9, best: 5, rank: 3, of: 4, gapToMedian: 1 },
      },
    },
    loss: {
      ltis: 5.4,
      recordables: 3.6,
      trifrMissing: false,
      fatalities: 0,
      loss: 365_715,
      atMedian: 275_467.5,
      atBest: 144_517.5,
      savingAtMedian: 90_247.5,
      savingAtBest: 221_197.5,
    },
    recommendation: { packageKey: "sms", reason: "one_worse" },
    ...overrides,
  };
}

/** A parsed snapshot as the dashboard query hands it to the segment. */
export function parsedSnapshot(
  overrides: Partial<ParsedSnapshot> = {},
  blocks: Partial<SnapshotBlocks> = {},
): ParsedSnapshot {
  return {
    id: SNAPSHOT_ID,
    createdAt: "2026-09-14T08:00:00.000Z",
    triggerKind: "research",
    modelVersion: MODEL_VERSION,
    kpisCompared: 2,
    confidence: 0.8,
    currency: "CHF",
    lossAmount: 365_715,
    savingAtMedian: 90_247.5,
    costChf: null,
    savingMedianChf: null,
    savingTopChf: null,
    blocks: readyBlocks(blocks),
    ...overrides,
  };
}

/** The company facts the segment passes to the form. */
export const company = {
  id: COMPANY_ID,
  industryCode: "23.61",
  employeesCount: 500,
  country: "CH",
};
