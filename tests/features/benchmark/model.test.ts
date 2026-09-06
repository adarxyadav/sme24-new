import { describe, expect, it } from "vitest";
import { MODEL_VERSION } from "@/features/benchmark/catalogue";
import {
  computeBenchmark,
  gapOf,
  type ModelAssumption,
  type ModelCatalogueEntry,
  type ModelCompany,
  type ModelKpiRow,
  type ModelPeerRow,
  positionOf,
  roundChf,
  selectPeer,
} from "@/features/benchmark/model";
import { parseSnapshotBlocks, SNAPSHOT_SCHEMAS } from "@/features/benchmark/snapshot";
import { KPI_CATALOGUE, KPI_KEYS, type KpiKey } from "@/features/research/catalogue";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const catalogue: readonly ModelCatalogueEntry[] = KPI_KEYS.map((key, index) => ({
  key,
  direction: KPI_CATALOGUE[key].direction,
  sortOrder: (index + 1) * 10,
}));

const company: ModelCompany = {
  id: UUID(1),
  employeesCount: 420,
  industryCode: "23.61",
  updatedAt: "2026-09-06T10:00:00.000Z",
};

let rowCounter = 100;
function kpi(key: KpiKey, value: number, overrides: Partial<ModelKpiRow> = {}): ModelKpiRow {
  rowCounter += 1;
  return {
    id: UUID(rowCounter),
    kpiKey: key,
    value,
    periodYear: 2025,
    source: "research",
    confidence: 0.9,
    researchRunId: UUID(9),
    ...overrides,
  };
}

let peerCounter = 500;
function peer(
  key: KpiKey,
  section: string,
  band: ModelPeerRow["sizeBand"],
  [p25, median, p75]: readonly [number, number, number],
  overrides: Partial<ModelPeerRow> = {},
): ModelPeerRow {
  peerCounter += 1;
  return {
    id: UUID(peerCounter),
    kpiKey: key,
    industrySection: section,
    sizeBand: band,
    periodYear: 2022,
    p25,
    median,
    p75,
    sampleSize: null,
    provisional: true,
    ...overrides,
  };
}

const assumptions: readonly ModelAssumption[] = [
  ["hours_per_fte", 1804, "hours per year"],
  ["direct_cost_per_case_chf", 4811, "CHF per case"],
  ["cost_per_absence_day_chf", 1100, "CHF per day"],
  ["lost_days_per_incident_default", 14, "days per case"],
  ["indirect_multiplier_low", 2, "factor"],
  ["indirect_multiplier", 3.7, "factor"],
  ["indirect_multiplier_high", 5, "factor"],
].map(([key, value, unit]) => ({
  key: key as ModelAssumption["key"],
  value: value as number,
  unit: unit as string,
  sourceName: "test",
  sourceUrl: null,
  provisional: true,
  effectiveFrom: "2022-12-31",
}));

const kpis: readonly ModelKpiRow[] = [
  kpi("ltifr", 2.4),
  kpi("trifr", 6.1),
  kpi("fatalities", 0),
  kpi("lost_days_per_incident", 12.5, { confidence: 0.8 }),
  kpi("accident_rate_per_1000_fte", 68),
  kpi("accident_rate_per_1000_fte", 72, { periodYear: 2024 }),
  kpi("absenteeism_rate", 3.8),
  kpi("near_miss_rate", 14),
  kpi("iso_45001_certified", 1),
];

const peers: readonly ModelPeerRow[] = [
  peer("accident_rate_per_1000_fte", "C", "all", [34.9, 49.9, 66.4]),
  peer("accident_rate_per_1000_fte", "ALL", "all", [25, 61.8, 81.2]),
  peer("lost_days_per_incident", "ALL", "all", [8, 10, 14]),
  peer("ltifr", "ALL", "all", [1, 2, 4]),
  peer("iso_45001_certified", "ALL", "all", [0.3, 0.3, 0.3]),
  peer("absenteeism_rate", "C", "all", [2.5, 3.5, 4.5]),
];

const compute = (overrides: Partial<Parameters<typeof computeBenchmark>[0]> = {}) =>
  computeBenchmark({ company, catalogue, kpis, peers, assumptions, ...overrides });

describe("computeBenchmark inputs, peers, positions and gaps (spec 0008, AC-4)", () => {
  it("takes the newest row per KPI, the section from the division and the band from the headcount", () => {
    const body = compute();
    expect(body.inputs.section).toBe("C");
    expect(body.inputs.sizeBand).toBe("250+");
    expect(body.inputs.fte).toBe(420);
    expect(body.inputs.companyUpdatedAt).toBe(company.updatedAt);
    const accident = body.inputs.kpis.find((input) => input.key === "accident_rate_per_1000_fte");
    expect(accident?.value).toBe(68);
    expect(accident?.periodYear).toBe(2025);
    expect(body.inputs.kpis).toHaveLength(8);
  });

  it("walks the rung ladder and picks the nearest year", () => {
    const result = compute().results.find((entry) => entry.key === "accident_rate_per_1000_fte");
    expect(result?.peer?.rung).toBe(2);
    expect(result?.peer?.industrySection).toBe("C");
    expect(result?.peer?.sizeBand).toBe("all");
    expect(result?.peer?.yearMatch).toBe("nearest");
    expect(result?.position).toBe("bottom_quarter");
    expect(result?.gapToMedian).toBeCloseTo(18.1);
    expect(result?.gapRelative).toBeCloseTo(18.1 / 49.9);
  });

  it("falls to rung 4 for a division with no section rows", () => {
    const body = compute({ company: { ...company, industryCode: "62.01" } });
    const result = body.results.find((entry) => entry.key === "accident_rate_per_1000_fte");
    expect(body.inputs.section).toBe("J");
    expect(result?.peer?.rung).toBe(4);
    expect(result?.peer?.industrySection).toBe("ALL");
  });

  it("prefers the same year and breaks a year distance tie towards the newer row", () => {
    const rows = [
      peer("ltifr", "ALL", "all", [1, 2, 3], { periodYear: 2021 }),
      peer("ltifr", "ALL", "all", [1, 2, 3], { periodYear: 2023 }),
      peer("ltifr", "ALL", "all", [1, 2, 3], { periodYear: 2025 }),
    ];
    expect(selectPeer(rows, "ltifr", null, "all", 2025)?.periodYear).toBe(2025);
    expect(selectPeer(rows, "ltifr", null, "all", 2022)?.periodYear).toBe(2023);
    expect(selectPeer(rows, "ltifr", null, "all", 2022)?.yearMatch).toBe("nearest");
    expect(selectPeer(rows, "ltifr", null, "all", 2025)?.yearMatch).toBe("same");
  });

  it("records no peer, position or gap for a KPI without a row on any rung and does not count it", () => {
    const body = compute();
    const trifr = body.results.find((entry) => entry.key === "trifr");
    expect(trifr).toEqual({
      key: "trifr",
      peer: null,
      position: null,
      gapToMedian: null,
      gapRelative: null,
      confidence: 0.9,
    });
    expect(body.kpisCompared).toBe(5);
  });

  it("positions lower is better and higher is better values against the quartiles", () => {
    const quartiles = { p25: 10, median: 20, p75: 30 };
    expect(positionOf("ltifr", "lower_is_better", 10, quartiles)).toBe("top_quarter");
    expect(positionOf("ltifr", "lower_is_better", 20, quartiles)).toBe("above_median");
    expect(positionOf("ltifr", "lower_is_better", 30, quartiles)).toBe("below_median");
    expect(positionOf("ltifr", "lower_is_better", 31, quartiles)).toBe("bottom_quarter");
    expect(positionOf("near_miss_rate", "higher_is_better", 30, quartiles)).toBe("top_quarter");
    expect(positionOf("near_miss_rate", "higher_is_better", 20, quartiles)).toBe("above_median");
    expect(positionOf("near_miss_rate", "higher_is_better", 10, quartiles)).toBe("below_median");
    expect(positionOf("near_miss_rate", "higher_is_better", 9, quartiles)).toBe("bottom_quarter");
  });

  it("applies the ISO rule: certified is above the median, missing is a gap of 1", () => {
    const share = { p25: 0.3, median: 0.3, p75: 0.3 };
    expect(positionOf("iso_45001_certified", "higher_is_better", 1, share)).toBe("above_median");
    expect(positionOf("iso_45001_certified", "higher_is_better", 0, share)).toBe("below_median");
    expect(gapOf("iso_45001_certified", "higher_is_better", 0, 0.3)).toEqual({
      gapToMedian: 0.3,
      gapRelative: 1,
    });
    expect(gapOf("iso_45001_certified", "higher_is_better", 1, 0.3)).toEqual({
      gapToMedian: 0,
      gapRelative: 0,
    });
    const missing = compute({
      kpis: kpis.map((row) => (row.kpiKey === "iso_45001_certified" ? { ...row, value: 0 } : row)),
    });
    expect(missing.gaps.some((gap) => gap.key === "iso_45001_certified")).toBe(true);
  });

  it("signs the gap so positive means worse, and leaves the relative gap null on a zero median", () => {
    expect(gapOf("ltifr", "lower_is_better", 3, 2)).toEqual({ gapToMedian: 1, gapRelative: 0.5 });
    expect(gapOf("near_miss_rate", "higher_is_better", 5, 10)).toEqual({
      gapToMedian: 5,
      gapRelative: 0.5,
    });
    expect(gapOf("ltifr", "lower_is_better", 3, 0)).toEqual({ gapToMedian: 3, gapRelative: null });
  });
});

describe("computeBenchmark cost, ranking, confidence and scalars (spec 0008, AC-18)", () => {
  it("prices the accident rate with the company's lost days and both savings", () => {
    const body = compute();
    const cost = body.cost;
    expect(cost?.incidentKpi).toBe("accident_rate_per_1000_fte");
    expect(cost?.incidents).toBeCloseTo(28.56);
    expect(cost?.lostDays).toBe(12.5);
    expect(cost?.lostDaysSource).toBe("kpi");
    expect(cost?.costPerCase).toBeCloseTo(18_561);
    expect(cost?.annual).toBeCloseTo(28.56 * 18_561 * 3.7, 3);
    expect(cost?.low).toBeCloseTo(28.56 * 18_561 * 2, 3);
    expect(cost?.high).toBeCloseTo(28.56 * 18_561 * 5, 3);
    // At the peer median: rate 49.9 and the lost days peer median 10.
    const atMedian = ((49.9 * 420) / 1000) * (4811 + 10 * 1100) * 3.7;
    expect(cost?.atMedian).toBeCloseTo(atMedian, 3);
    expect(cost?.savingMedian).toBeCloseTo(28.56 * 18_561 * 3.7 - atMedian, 3);
    const atTop = ((34.9 * 420) / 1000) * (4811 + 8 * 1100) * 3.7;
    expect(cost?.atTop).toBeCloseTo(atTop, 3);
    expect(cost?.savingTop).toBeCloseTo(28.56 * 18_561 * 3.7 - atTop, 3);
    expect(body.costChf).toBe(cost?.annual);
    expect(body.savingMedianChf).toBe(cost?.savingMedian);
    expect(body.savingTopChf).toBe(cost?.savingTop);
    expect(body.costLowChf).toBe(cost?.low);
    expect(body.costHighChf).toBe(cost?.high);
  });

  it("falls back to LTIFR with the hours assumption and the default lost days", () => {
    const body = compute({
      kpis: kpis.filter(
        (row) => !["accident_rate_per_1000_fte", "lost_days_per_incident"].includes(row.kpiKey),
      ),
    });
    expect(body.cost?.incidentKpi).toBe("ltifr");
    expect(body.cost?.incidents).toBeCloseTo((2.4 * 420 * 1804) / 1_000_000);
    expect(body.cost?.lostDays).toBe(14);
    expect(body.cost?.lostDaysSource).toBe("default");
    expect(body.cost?.costPerCase).toBeCloseTo(4811 + 14 * 1100);
    const keys = body.assumptions.map((assumption) => assumption.key);
    expect(keys).toContain("hours_per_fte");
    expect(keys).toContain("lost_days_per_incident_default");
  });

  it("yields a saving of 0 for a company at the median", () => {
    const body = compute({
      kpis: kpis.map((row) => {
        if (row.kpiKey === "accident_rate_per_1000_fte") return { ...row, value: 49.9 };
        if (row.kpiKey === "lost_days_per_incident") return { ...row, value: 10 };
        return row;
      }),
    });
    expect(body.cost?.savingMedian).toBe(0);
    expect(body.cost?.savingTop).toBeGreaterThan(0);
    expect(body.gaps.some((gap) => gap.key === "accident_rate_per_1000_fte")).toBe(false);
  });

  it("gives no cost without a headcount or with a headcount of 0, positions intact", () => {
    for (const employeesCount of [null, 0]) {
      const body = compute({ company: { ...company, employeesCount } });
      expect(body.cost).toBeNull();
      expect(body.costChf).toBeNull();
      expect(body.confidence).toBeNull();
      expect(body.inputs.sizeBand).toBe("all");
      expect(
        body.results.find((entry) => entry.key === "accident_rate_per_1000_fte")?.position,
      ).toBe("bottom_quarter");
      expect(body.kpisCompared).toBe(5);
      expect(body.assumptions).toEqual([]);
    }
  });

  it("gives no cost when neither incident KPI has a row", () => {
    const body = compute({
      kpis: kpis.filter((row) => !["accident_rate_per_1000_fte", "ltifr"].includes(row.kpiKey)),
    });
    expect(body.cost).toBeNull();
  });

  it("leaves the saving null on a peer median of 0", () => {
    const body = compute({
      peers: peers.map((row) =>
        row.kpiKey === "accident_rate_per_1000_fte" && row.industrySection === "C"
          ? { ...row, p25: 0, median: 0, p75: 0 }
          : row,
      ),
    });
    expect(body.cost?.atMedian).toBeNull();
    expect(body.cost?.savingMedian).toBeNull();
    expect(body.savingMedianChf).toBeNull();
    const accident = body.results.find((entry) => entry.key === "accident_rate_per_1000_fte");
    expect(accident?.gapRelative).toBeNull();
  });

  it("ranks cost linked gaps by their solo move saving, then the rest by relative gap", () => {
    const body = compute();
    expect(body.gaps.map((gap) => [gap.rank, gap.key, gap.reason])).toEqual([
      [1, "accident_rate_per_1000_fte", "cost"],
      [2, "lost_days_per_incident", "cost"],
      [3, "ltifr", "cost"],
      [4, "absenteeism_rate", "distance"],
    ]);
    const annual = 28.56 * 18_561 * 3.7;
    const accidentSolo = annual - ((49.9 * 420) / 1000) * 18_561 * 3.7;
    const lostDaysSolo = annual - 28.56 * (4811 + 10 * 1100) * 3.7;
    expect(body.gaps[0]?.savingMedianChf).toBeCloseTo(accidentSolo, 3);
    expect(body.gaps[1]?.savingMedianChf).toBeCloseTo(lostDaysSolo, 3);
    expect(body.gaps[2]?.savingMedianChf).toBeNull();
    expect(body.gaps[3]?.gapRelative).toBeCloseTo(0.3 / 3.5);
  });

  it("puts a fatality first even without a peer row", () => {
    const body = compute({
      kpis: kpis.map((row) => (row.kpiKey === "fatalities" ? { ...row, value: 1 } : row)),
    });
    expect(body.gaps[0]).toEqual({
      rank: 1,
      key: "fatalities",
      reason: "fatality",
      savingMedianChf: null,
      gapRelative: null,
    });
    expect(body.gaps[1]?.key).toBe("accident_rate_per_1000_fte");
  });

  it("breaks a tie by the catalogue sort order", () => {
    const body = compute({
      kpis: kpis.map((row) => {
        if (row.kpiKey === "absenteeism_rate") return { ...row, value: 4.5 };
        if (row.kpiKey === "near_miss_rate") return { ...row, value: 5 };
        return row;
      }),
      peers: [
        ...peers.filter((row) => row.kpiKey !== "absenteeism_rate"),
        peer("absenteeism_rate", "C", "all", [2, 3, 4]),
        peer("near_miss_rate", "ALL", "all", [5, 10, 20]),
      ],
    });
    const distance = body.gaps.filter((gap) => gap.reason === "distance");
    expect(distance.map((gap) => gap.key)).toEqual(["absenteeism_rate", "near_miss_rate"]);
    expect(distance[0]?.gapRelative).toBeCloseTo(0.5);
    expect(distance[1]?.gapRelative).toBeCloseTo(0.5);
  });

  it("takes the minimum confidence over the rows the cost used, 1 for a client row", () => {
    expect(compute().confidence).toBe(0.8);
    const clientRows = compute({
      kpis: kpis.map((row) =>
        row.kpiKey === "lost_days_per_incident" ? { ...row, source: "client" as const } : row,
      ),
    });
    expect(clientRows.confidence).toBe(0.9);
    expect(
      clientRows.inputs.kpis.find((input) => input.key === "lost_days_per_incident")?.confidence,
    ).toBe(1);
    const unknown = compute({
      kpis: kpis.map((row) => ({ ...row, confidence: null })),
    });
    expect(unknown.confidence).toBeNull();
  });

  it("flags provisional peers or assumptions and lists only the assumptions used", () => {
    const body = compute();
    expect(body.peerProvisional).toBe(true);
    expect(body.assumptions.map((assumption) => assumption.key).sort()).toEqual(
      [
        "cost_per_absence_day_chf",
        "direct_cost_per_case_chf",
        "indirect_multiplier",
        "indirect_multiplier_high",
        "indirect_multiplier_low",
      ].sort(),
    );
    const clean = compute({
      peers: peers.map((row) => ({ ...row, provisional: false })),
      assumptions: assumptions.map((assumption) => ({ ...assumption, provisional: false })),
    });
    expect(clean.peerProvisional).toBe(false);
  });

  it("rounds CHF to the nearest 100 below 10 000 and to the nearest 1 000 above", () => {
    expect(roundChf(4_849)).toBe(4_800);
    expect(roundChf(4_850)).toBe(4_900);
    expect(roundChf(9_950)).toBe(10_000);
    expect(roundChf(12_499)).toBe(12_000);
    expect(roundChf(735_318)).toBe(735_000);
    expect(roundChf(0)).toBe(0);
  });

  it("produces a body the version 1 schema accepts", () => {
    const body = compute();
    const parsed = parseSnapshotBlocks({ model_version: MODEL_VERSION, ...body });
    expect(parsed.error).toBeNull();
    expect(parsed.blocks?.gaps).toHaveLength(4);
  });
});

describe("the snapshot version map (spec 0008, AC-9)", () => {
  const valid = compute();

  it("parses a version 1 row and rejects an unknown version or a broken block", () => {
    expect(Object.keys(SNAPSHOT_SCHEMAS)).toContain(MODEL_VERSION);
    expect(parseSnapshotBlocks({ model_version: MODEL_VERSION, ...valid }).blocks).not.toBeNull();
    const unknown = parseSnapshotBlocks({ model_version: "benchmark-model@0", ...valid });
    expect(unknown.blocks).toBeNull();
    expect(unknown.error).toContain("benchmark-model@0");
    const broken = parseSnapshotBlocks({ model_version: MODEL_VERSION, ...valid, gaps: "nope" });
    expect(broken.blocks).toBeNull();
    expect(broken.error).toContain("gaps");
  });
});
