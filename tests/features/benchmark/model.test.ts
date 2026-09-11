import { describe, expect, it } from "vitest";
import { MODEL_VERSION } from "@/features/benchmark/catalogue";
import {
  comparedValueOf,
  computeBenchmark,
  exposureCount,
  fatalityRateOf,
  gapOf,
  type ModelAssumption,
  type ModelCatalogueEntry,
  type ModelCompany,
  type ModelKpiRow,
  type ModelPeerRow,
  positionOf,
  rateShapeOf,
  roundChf,
  roundChfRange,
  selectPeer,
} from "@/features/benchmark/model";
import { parseSnapshotBlocks, peerShapeOf, SNAPSHOT_SCHEMAS } from "@/features/benchmark/snapshot";
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
  isAssumption: false,
  note: null,
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
      comparedValue: null,
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

  it("applies the ISO rule: certified is better than the sector, missing is a gap of 1", () => {
    // A certified share is one number repeated as all three quartiles, so it is a point row and
    // takes the two average positions rather than the median wording (spec 0016, AC-5).
    const share = { p25: 0.3, median: 0.3, p75: 0.3 };
    expect(positionOf("iso_45001_certified", "higher_is_better", 1, share)).toBe("above_average");
    expect(positionOf("iso_45001_certified", "higher_is_better", 0, share)).toBe("below_average");
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

  // A peer value of 0 is a real reference, not a gap in the data (spec 0016 amendment, D1): it
  // prices to zero incidents, so the saving is the whole annual cost. Before the amendment the
  // rule went quiet in exactly the case with the largest opportunity.
  it("prices a peer median of 0 as zero incidents, so the saving is the whole annual cost", () => {
    const body = compute({
      peers: peers.map((row) =>
        row.kpiKey === "accident_rate_per_1000_fte" && row.industrySection === "C"
          ? { ...row, p25: 0, median: 0, p75: 0 }
          : row,
      ),
    });
    expect(body.cost?.atMedian).toBe(0);
    expect(body.cost?.atTop).toBe(0);
    expect(body.cost?.savingMedian).toBeCloseTo(body.cost?.annual ?? -1, 6);
    expect(body.cost?.savingTop).toBeCloseTo(body.cost?.annual ?? -1, 6);
    expect(body.savingMedianChf).toBe(body.cost?.savingMedian);
    // The relative gap keeps its own rule: a division by a median of 0 stays null.
    const accident = body.results.find((entry) => entry.key === "accident_rate_per_1000_fte");
    expect(accident?.gapRelative).toBeNull();
    expect(accident?.gapToMedian).toBe(68);
  });

  it("prices a peer p25 of 0 with a positive median as the whole annual cost at the top", () => {
    const body = compute({
      peers: peers.map((row) =>
        row.kpiKey === "accident_rate_per_1000_fte" && row.industrySection === "C"
          ? { ...row, p25: 0, median: 49.9, p75: 66.4 }
          : row,
      ),
    });
    expect(body.cost?.atTop).toBe(0);
    expect(body.cost?.savingTop).toBeCloseTo(body.cost?.annual ?? -1, 6);
    // The median reference is untouched by the top quarter being 0.
    const atMedian = ((49.9 * 420) / 1000) * (4811 + 10 * 1100) * 3.7;
    expect(body.cost?.atMedian).toBeCloseTo(atMedian, 3);
  });

  // The saving is null only without a peer row at all.
  it("leaves both savings null only when the incident KPI has no peer row", () => {
    const body = compute({
      peers: peers.filter((row) => row.kpiKey !== "accident_rate_per_1000_fte"),
    });
    expect(body.cost).not.toBeNull();
    expect(body.cost?.atMedian).toBeNull();
    expect(body.cost?.atTop).toBeNull();
    expect(body.cost?.savingMedian).toBeNull();
    expect(body.cost?.savingTop).toBeNull();
  });

  // `assumptions` holds whatever rows the database returned, so a missing row used to reach the
  // arithmetic as `undefined` and yield `NaN` in the CHF figure (spec 0016 amendment, AC-20).
  it("gives no cost and names the missing assumption instead of NaN, on both arms", () => {
    const without = (key: ModelAssumption["key"]) =>
      assumptions.filter((assumption) => assumption.key !== key);
    // The Suva arm does not need the hours, so that row may go missing without effect.
    const suvaArm = compute({ assumptions: without("hours_per_fte") });
    expect(suvaArm.cost).not.toBeNull();
    expect(suvaArm.costSkipped).toBeNull();
    expect(Number.isFinite(suvaArm.costChf)).toBe(true);
    // The LTIFR arm needs it: null cost, a named reason, and nothing NaN anywhere.
    const ltifrArm = compute({
      kpis: kpis.filter((row) => row.kpiKey !== "accident_rate_per_1000_fte"),
      assumptions: without("hours_per_fte"),
    });
    expect(ltifrArm.cost).toBeNull();
    expect(ltifrArm.costChf).toBeNull();
    expect(ltifrArm.costSkipped).toEqual({ reason: "missing_assumption", key: "hours_per_fte" });
    // Positions and gaps are untouched by a missing cost assumption (four compared without the
    // accident rate row).
    expect(ltifrArm.kpisCompared).toBe(4);
    // Every arm needs the multiplier; a non finite value counts as missing too.
    const broken = compute({
      assumptions: assumptions.map((assumption) =>
        assumption.key === "indirect_multiplier"
          ? { ...assumption, value: Number.NaN }
          : assumption,
      ),
    });
    expect(broken.cost).toBeNull();
    expect(broken.costSkipped).toEqual({
      reason: "missing_assumption",
      key: "indirect_multiplier",
    });
    // The default lost days are needed only without a lost days row.
    const defaultUnused = compute({ assumptions: without("lost_days_per_incident_default") });
    expect(defaultUnused.cost).not.toBeNull();
    const defaultNeeded = compute({
      kpis: kpis.filter((row) => row.kpiKey !== "lost_days_per_incident"),
      assumptions: without("lost_days_per_incident_default"),
    });
    expect(defaultNeeded.cost).toBeNull();
    expect(defaultNeeded.costSkipped?.key).toBe("lost_days_per_incident_default");
    // The body still parses under the write schema: `costSkipped` is not a block.
    expect(parseSnapshotBlocks({ model_version: MODEL_VERSION, ...ltifrArm }).error).toBeNull();
    // The nothing-to-price cases carry no reason: they are documented states, not skips.
    expect(compute({ company: { ...company, employeesCount: null } }).costSkipped).toBeNull();
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

  // A fatality count is judged as a rate per 100 000 employed persons against the Eurostat row
  // (spec 0016 amendment, D3): the stored count stays a count, the snapshot records the rate.
  it("compares fatalities as a rate per 100 000 employed persons and records the compared value", () => {
    expect(fatalityRateOf(1, 420)).toBeCloseTo(238.095, 3);
    expect(fatalityRateOf(0, 420)).toBe(0);
    expect(fatalityRateOf(1, 0)).toBeNull();
    expect(fatalityRateOf(1, null)).toBeNull();
    expect(comparedValueOf("ltifr", 2.4, null)).toEqual({ value: 2.4, converted: false });
    expect(comparedValueOf("fatalities", 1, 420)).toEqual({
      value: (1 / 420) * 100_000,
      converted: true,
    });
    expect(comparedValueOf("fatalities", 1, null)).toBeNull();

    const rows = [...peers, peer("fatalities", "C", "all", [1.13, 1.13, 1.13])];
    const zero = compute({ peers: rows }).results.find((entry) => entry.key === "fatalities");
    expect(zero?.peer?.shape).toBe("point");
    expect(zero?.position).toBe("above_average");
    expect(zero?.comparedValue).toBe(0);
    expect(zero?.gapToMedian).toBeCloseTo(-1.13);
    // The stored input keeps the count.
    expect(compute({ peers: rows }).inputs.kpis.find((k) => k.key === "fatalities")?.value).toBe(0);

    const one = compute({
      peers: rows,
      kpis: kpis.map((row) => (row.kpiKey === "fatalities" ? { ...row, value: 1 } : row)),
    });
    const result = one.results.find((entry) => entry.key === "fatalities");
    expect(result?.position).toBe("below_average");
    expect(result?.comparedValue).toBeCloseTo(238.095, 3);
    expect(result?.gapToMedian).toBeCloseTo(238.095 - 1.13, 3);
    // The ranking rule is untouched: a count above 0 is rank 1, with the rate's relative gap.
    expect(one.gaps[0]?.key).toBe("fatalities");
    expect(one.gaps[0]?.reason).toBe("fatality");
    expect(one.gaps[0]?.gapRelative).toBeCloseTo((238.095 - 1.13) / 1.13, 2);
    // Every other KPI records no compared value: it was judged on its stored value.
    expect(
      one.results
        .filter((entry) => entry.key !== "fatalities")
        .every((entry) => entry.comparedValue === null),
    ).toBe(true);
  });

  it("does not compare fatalities without a headcount, and does not count them", () => {
    const rows = [...peers, peer("fatalities", "C", "all", [1.13, 1.13, 1.13])];
    const withFte = compute({ peers: rows });
    expect(withFte.kpisCompared).toBe(6);
    for (const employeesCount of [null, 0]) {
      const body = compute({ peers: rows, company: { ...company, employeesCount } });
      const result = body.results.find((entry) => entry.key === "fatalities");
      expect(result?.peer).toBeNull();
      expect(result?.position).toBeNull();
      expect(result?.comparedValue).toBeNull();
      expect(body.kpisCompared).toBe(5);
    }
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
    // hours_per_fte rides in on the derived block: the cost line took the Suva path and would not
    // have recorded it, but both derived counts used it, so the disclosure must name it (spec 0012, AC-11).
    expect(body.assumptions.map((assumption) => assumption.key).sort()).toEqual(
      [
        "cost_per_absence_day_chf",
        "direct_cost_per_case_chf",
        "hours_per_fte",
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
    expect(roundChfRange(1_060_400, 2_650_100)).toEqual({ low: 1_060_000, high: 2_651_000 });
    // The displayed band always contains the computed one: low rounds down, high rounds up, at
    // the same step roundChf uses either side of 10 000 (spec 0016, AC-9).
    expect(roundChfRange(4_849, 4_851)).toEqual({ low: 4_800, high: 4_900 });
    expect(roundChfRange(9_999, 10_001)).toEqual({ low: 9_900, high: 11_000 });
    // An exact multiple of the step is left where it is, so a clean number gains no false width.
    expect(roundChfRange(2_000, 12_000)).toEqual({ low: 2_000, high: 12_000 });
    expect(roundChfRange(0, 0)).toEqual({ low: 0, high: 0 });
    // The band contains the point estimate for the real seeded multipliers.
    const { low, high } = roundChfRange(1_060_400, 2_650_100);
    expect(low).toBeLessThanOrEqual(1_060_400);
    expect(high).toBeGreaterThanOrEqual(2_650_100);
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

describe("the derived injury counts (spec 0012)", () => {
  // fte 420, hours_per_fte 1804 -> exposure 757 680 hours, so a rate of 1.0 is 0.75768 injuries.
  const exposureHours = (420 * 1804) / 1_000_000;

  it("derives both counts from the rates, headcount and hours assumption (AC-1, AC-2, AC-10)", () => {
    const derived = compute().derived;
    expect(derived).not.toBeNull();
    expect(derived?.fte).toBe(420);
    expect(derived?.hoursPerFte).toBe(1804);
    expect(derived?.lostTime?.count).toBeCloseTo(2.4 * exposureHours, 10);
    expect(derived?.recordable?.count).toBeCloseTo(6.1 * exposureHours, 10);
  });

  it("copies the provenance of the row each count came from (AC-4, AC-5)", () => {
    const derived = compute().derived;
    expect(derived?.lostTime).toMatchObject({
      fromKey: "ltifr",
      fromValue: 2.4,
      fromSource: "research",
      fromYear: 2025,
    });
    expect(derived?.recordable?.fromKey).toBe("trifr");
    // A derived count never carries a confidence: the type has no such key.
    expect(derived?.lostTime).not.toHaveProperty("confidence");
  });

  it("equals the cost line's incidents when both name the same rate (AC-9)", () => {
    // Drop the Suva rate so the cost line and the derived block both pick LTIFR.
    const body = compute({
      kpis: kpis.filter((row) => row.kpiKey !== "accident_rate_per_1000_fte"),
    });
    expect(body.cost?.incidentKpi).toBe("ltifr");
    expect(body.derived?.lostTime?.fromKey).toBe("ltifr");
    expect(body.derived?.lostTime?.count).toBe(body.cost?.incidents);
  });

  it("falls back to the Suva accident rate when there is no LTIFR (AC-11)", () => {
    const body = compute({ kpis: kpis.filter((row) => row.kpiKey !== "ltifr") });
    expect(body.derived?.lostTime?.fromKey).toBe("accident_rate_per_1000_fte");
    // The per 1000 FTE arm, not the per million hours one.
    expect(body.derived?.lostTime?.count).toBeCloseTo((68 * 420) / 1000, 10);
    // The hours assumption still reaches the disclosure, because the recordable count used it.
    expect(body.assumptions.map((assumption) => assumption.key)).toContain("hours_per_fte");
  });

  // The spec makes the derived block's lost time precedence deliberately independent of the cost
  // line's: LTIFR first here, whatever the cost line picked. With both rates present the two
  // diverge, which is the case that would break if someone "simplified" the block to reuse
  // `cost.incidentKpi`. The AC-9 equality above holds only when the keys agree, so pin the
  // disagreement too.
  it("prefers LTIFR even when the cost line took the Suva rate (AC-9)", () => {
    const body = compute();
    // The default fixture carries both rates, and the two lines choose differently.
    expect(body.cost?.incidentKpi).toBe("accident_rate_per_1000_fte");
    expect(body.derived?.lostTime?.fromKey).toBe("ltifr");
    expect(body.derived?.lostTime?.count).not.toBeCloseTo(body.cost?.incidents ?? 0, 6);
    // Each still used its own rate through the one shared helper.
    expect(body.derived?.lostTime?.count).toBeCloseTo(2.4 * exposureHours, 10);
    expect(body.cost?.incidents).toBeCloseTo((68 * 420) / 1000, 10);
  });

  it("drops only the count whose rate is missing (AC-6)", () => {
    const body = compute({ kpis: kpis.filter((row) => row.kpiKey !== "trifr") });
    expect(body.derived?.lostTime).not.toBeNull();
    expect(body.derived?.recordable).toBeNull();
  });

  it("produces no block without a positive headcount (AC-7)", () => {
    expect(compute({ company: { ...company, employeesCount: null } }).derived).toBeNull();
    expect(compute({ company: { ...company, employeesCount: 0 } }).derived).toBeNull();
  });

  it("produces no block, and no NaN, without the hours assumption (AC-16)", () => {
    const body = compute({
      assumptions: assumptions.filter((assumption) => assumption.key !== "hours_per_fte"),
    });
    expect(body.derived).toBeNull();
  });

  it("produces no block when no usable rate exists at all (AC-7)", () => {
    const rates = ["ltifr", "trifr", "accident_rate_per_1000_fte"];
    const body = compute({ kpis: kpis.filter((row) => !rates.includes(row.kpiKey)) });
    expect(body.derived).toBeNull();
  });

  it("keeps a small company's fraction of an injury rather than rounding it away (AC-8)", () => {
    // 5 people, LTIFR 45: 5 x 1804 = 9020 hours, so 45 x 0.00902 = 0.4059 injuries a year.
    const body = compute({
      company: { ...company, employeesCount: 5 },
      kpis: [kpi("ltifr", 45)],
    });
    expect(body.derived?.lostTime?.count).toBeCloseTo(0.4059, 4);
    expect(body.derived?.lostTime?.count).toBeGreaterThan(0);
  });

  it("never adds a derived count to the KPI blocks (AC-13)", () => {
    const body = compute();
    const keys = [
      ...body.inputs.kpis.map((input) => input.key),
      ...body.results.map((result) => result.key),
      ...body.gaps.map((gap) => gap.key),
    ];
    expect(keys).not.toContain("recordable_injuries");
    expect(keys).not.toContain("lost_time_injuries");
  });

  // /check verify walked this through the "Your figures" form by hand. The fixture research
  // provider always writes `source 'research'`, so the form path cannot be driven end to end
  // locally; what the form feeds in is a client sourced row, and this pins what the model does
  // with one (spec 0012, AC-4).
  it("follows the input row's source, so a client entered rate reads as the client's (AC-4)", () => {
    const body = compute({
      kpis: kpis.map((row) =>
        row.kpiKey === "ltifr"
          ? { ...row, source: "client" as const, confidence: null, periodYear: 2024 }
          : row,
      ),
    });
    expect(body.derived?.lostTime).toMatchObject({
      fromKey: "ltifr",
      fromSource: "client",
      fromYear: 2024,
    });
    // The researched TRIFR beside it keeps its own source, so the two lines can disagree.
    expect(body.derived?.recordable?.fromSource).toBe("research");
    // A client row carries no confidence, and the derived count borrows none either (AC-5).
    expect(body.derived?.lostTime).not.toHaveProperty("confidence");
  });

  // The other step /check verify only ran by hand: change the headcount, watch both counts move.
  it("scales both counts and the stated exposure with the headcount (AC-10)", () => {
    const at420 = compute().derived;
    const at840 = compute({ company: { ...company, employeesCount: 840 } }).derived;
    expect(at840?.fte).toBe(840);
    // Exposure is linear in FTE, so doubling the headcount doubles both counts exactly.
    expect(at840?.lostTime?.count).toBeCloseTo((at420?.lostTime?.count ?? 0) * 2, 10);
    expect(at840?.recordable?.count).toBeCloseTo((at420?.recordable?.count ?? 0) * 2, 10);
    // The rates themselves are unchanged: only the exposure moved.
    expect(at840?.lostTime?.fromValue).toBe(at420?.lostTime?.fromValue);
    expect(at840?.hoursPerFte).toBe(at420?.hoursPerFte);
  });
});

describe("exposureCount (spec 0012, AC-9)", () => {
  it("dispatches on the rate shape, with an arm for TRIFR", () => {
    expect(exposureCount("per_1000_fte", 68, 420, 1804)).toBeCloseTo(28.56, 10);
    expect(exposureCount("per_million_hours", 2.4, 420, 1804)).toBeCloseTo(1.818432, 10);
    expect(rateShapeOf("accident_rate_per_1000_fte")).toBe("per_1000_fte");
    expect(rateShapeOf("ltifr")).toBe("per_million_hours");
    expect(rateShapeOf("trifr")).toBe("per_million_hours");
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

  it("keeps parsing a stored version 1 row under its literal key (spec 0012, AC-12)", () => {
    const v1 = parseSnapshotBlocks({ model_version: "benchmark-model@1", ...valid });
    expect(v1.error).toBeNull();
    expect(v1.blocks).not.toBeNull();
  });

  // The load bearing invariant of spec 0012: both versions stay in the map under literal keys,
  // and version 1 is never widened to carry a derived key. Getting this wrong fails quietly,
  // every stored snapshot becomes unreadable and the dashboard drops to its waiting state, so
  // pin the shape rather than trusting a future edit to notice (AC-12).
  it("keeps every version in the map and leaves version 1 unwidened (spec 0012, AC-12; spec 0016, AC-12, amendment AC-22)", () => {
    expect(Object.keys(SNAPSHOT_SCHEMAS).sort()).toEqual([
      "benchmark-model@1",
      "benchmark-model@2",
      "benchmark-model@3",
      "benchmark-model@4",
    ]);
    // The live write time version is one of them, and it is the newest one.
    expect(MODEL_VERSION).toBe("benchmark-model@4");

    // A version 1 row that somehow carries a derived block drops it: the schema has no such key,
    // so the reader sees an absent block rather than an unvalidated one.
    const v1 = parseSnapshotBlocks({
      model_version: "benchmark-model@1",
      ...valid,
      derived: { fte: 420, hoursPerFte: 1804, lostTime: null, recordable: null },
    });
    expect(v1.error).toBeNull();
    expect(v1.blocks?.derived).toBeUndefined();

    // A version 2 row keeps its block, and an invalid one is rejected rather than stored.
    const v2 = parseSnapshotBlocks({ model_version: "benchmark-model@2", ...valid });
    expect(v2.error).toBeNull();
    expect(v2.blocks?.derived).toEqual(valid.derived);
    const broken = parseSnapshotBlocks({
      model_version: "benchmark-model@2",
      ...valid,
      derived: { fte: "many", hoursPerFte: 1804, lostTime: null, recordable: null },
    });
    expect(broken.blocks).toBeNull();
    expect(broken.error).toContain("derived");
  });

  // A stored @1 or @2 row predates the shape and the source columns, so every reader must handle
  // their absence rather than assume the newest version (spec 0016, AC-12).
  it("parses a stored version 2 row whose peer block carries no shape (spec 0016, AC-12)", () => {
    const stripped = {
      ...valid,
      results: valid.results.map(({ comparedValue: _compared, ...result }) =>
        result.peer === null
          ? result
          : {
              ...result,
              peer: Object.fromEntries(
                Object.entries(result.peer).filter(
                  ([key]) => !["shape", "sourceKey", "basis"].includes(key),
                ),
              ),
            },
      ),
      assumptions: valid.assumptions.map((assumption) => {
        const {
          isAssumption: _flag,
          note: _note,
          ...rest
        } = assumption as typeof assumption & {
          isAssumption?: boolean;
          note?: unknown;
        };
        return rest;
      }),
    };
    const v2 = parseSnapshotBlocks({ model_version: "benchmark-model@2", ...stripped });
    expect(v2.error).toBeNull();
    const peered = v2.blocks?.results.find((result) => result.peer !== null);
    expect(peered?.peer?.shape).toBeUndefined();
    expect(v2.blocks?.assumptions[0]?.isAssumption).toBeUndefined();

    // The same stripped row is not a valid @3 row: the new fields are required there.
    expect(
      parseSnapshotBlocks({ model_version: "benchmark-model@3", ...stripped }).blocks,
    ).toBeNull();
  });

  // A stored @3 row predates `comparedValue` (spec 0016 amendment, AC-22): it keeps parsing under
  // its own key, a reader sees the field absent, and the same row is not a valid @4 row.
  it("parses a stored version 3 row without a compared value and requires it on version 4", () => {
    const v3Row = {
      ...valid,
      results: valid.results.map(({ comparedValue: _compared, ...result }) => result),
    };
    const v3 = parseSnapshotBlocks({ model_version: "benchmark-model@3", ...v3Row });
    expect(v3.error).toBeNull();
    expect(v3.blocks?.results[0]?.comparedValue).toBeUndefined();
    expect(parseSnapshotBlocks({ model_version: "benchmark-model@4", ...v3Row }).blocks).toBeNull();
    const v4 = parseSnapshotBlocks({ model_version: "benchmark-model@4", ...valid });
    expect(v4.error).toBeNull();
    expect(v4.blocks?.results.every((result) => result.comparedValue === null)).toBe(true);
  });
});

describe("the peer shape and the two average positions (spec 0016, AC-4, AC-5)", () => {
  const point = { p25: 44.3, median: 44.3, p75: 44.3 };
  const spread = { p25: 10, median: 20, p75: 30 };

  it("derives the shape from the values, never from a column", () => {
    expect(peerShapeOf(point)).toBe("point");
    expect(peerShapeOf(spread)).toBe("distribution");
    // Equal ends with a different middle is still a distribution: only all three equal is a point.
    expect(peerShapeOf({ p25: 10, median: 20, p75: 10 })).toBe("distribution");
  });

  it("carries the derived shape onto the snapshot's peer block", () => {
    const rows = [
      peer("ltifr", "D", "all", [44.3, 44.3, 44.3]),
      peer("ltifr", "C", "all", [10, 20, 30]),
    ];
    expect(selectPeer(rows, "ltifr", "D", "all", 2022)?.shape).toBe("point");
    expect(selectPeer(rows, "ltifr", "C", "all", 2022)?.shape).toBe("distribution");
  });

  it("gives a point row only the two average positions, in both directions", () => {
    // lower is better: at or below the one figure is better than the sector.
    expect(positionOf("ltifr", "lower_is_better", 40, point)).toBe("above_average");
    expect(positionOf("ltifr", "lower_is_better", 44.3, point)).toBe("above_average");
    expect(positionOf("ltifr", "lower_is_better", 50, point)).toBe("below_average");
    // higher is better: at or above it is better.
    expect(positionOf("near_miss_rate", "higher_is_better", 50, point)).toBe("above_average");
    expect(positionOf("near_miss_rate", "higher_is_better", 44.3, point)).toBe("above_average");
    expect(positionOf("near_miss_rate", "higher_is_better", 40, point)).toBe("below_average");
  });

  it("routes the ISO branch through the shape rule so it never says median about a point row", () => {
    // A certified share is one number, so it is always a point row (AC-5).
    expect(positionOf("iso_45001_certified", "higher_is_better", 1, point)).toBe("above_average");
    expect(positionOf("iso_45001_certified", "higher_is_better", 0, point)).toBe("below_average");
    // A distribution keeps the existing two values.
    expect(positionOf("iso_45001_certified", "higher_is_better", 1, spread)).toBe("above_median");
    expect(positionOf("iso_45001_certified", "higher_is_better", 0, spread)).toBe("below_median");
  });

  it("never yields a quartile position for a point row, whatever the value", () => {
    const quartileBands = ["top_quarter", "above_median", "below_median", "bottom_quarter"];
    for (const value of [0, 1, 44.29, 44.3, 44.31, 1000]) {
      for (const direction of ["lower_is_better", "higher_is_better"] as const) {
        expect(quartileBands).not.toContain(positionOf("ltifr", direction, value, point));
      }
    }
  });

  it("leaves a distribution row's four bands exactly as they were", () => {
    expect(positionOf("ltifr", "lower_is_better", 5, spread)).toBe("top_quarter");
    expect(positionOf("ltifr", "lower_is_better", 15, spread)).toBe("above_median");
    expect(positionOf("ltifr", "lower_is_better", 25, spread)).toBe("below_median");
    expect(positionOf("ltifr", "lower_is_better", 35, spread)).toBe("bottom_quarter");
  });
});

/**
 * The curator's two source columns reaching the snapshot (spec 0016, AC-11). The rendering side is
 * covered in `calculation-content.test.tsx`, but nothing yet proves the values survive the trip
 * from the stored row onto the peer block. This is the half that made `source_note` useless: a
 * curator writes a sentence and it dies in the database. Every seeded row carries null today, so
 * the null path is the one that ships and the populated path is the one curation switches on.
 */
describe("the peer source columns reach the snapshot (spec 0016, AC-11)", () => {
  const basis = {
    de: "Quartile über Suva Klasse 22A, nicht über die NOGA Sektion.",
    en: "Quartiles over Suva class 22A, not over the NOGA section.",
  };

  it("copies source_key and basis from the chosen row onto the peer block", () => {
    const rows = [peer("ltifr", "C", "all", [10, 20, 30], { sourceKey: "Suva class 22A", basis })];
    const chosen = selectPeer(rows, "ltifr", "C", "all", 2022);
    expect(chosen?.sourceKey).toBe("Suva class 22A");
    expect(chosen?.basis).toEqual(basis);
  });

  it("reads null for a row carrying neither, which is every seeded row today", () => {
    const rows = [peer("ltifr", "C", "all", [10, 20, 30])];
    const chosen = selectPeer(rows, "ltifr", "C", "all", 2022);
    // Absent on the row rather than explicitly null: the `?? null` must normalise both, or the
    // v3 schema rejects an `undefined` where it requires a nullable string.
    expect(chosen?.sourceKey).toBeNull();
    expect(chosen?.basis).toBeNull();
  });

  it("carries the columns of the row the ladder actually chose, not another rung's", () => {
    // The section row wins, so the ALL row's caveat must not leak onto the block: a basis sentence
    // describes one row's quartiles and is wrong about any other.
    const rows = [
      peer("ltifr", "C", "all", [10, 20, 30], { sourceKey: "section row", basis }),
      peer("ltifr", "ALL", "all", [1, 2, 3], {
        sourceKey: "all row",
        basis: { de: "falsch", en: "wrong" },
      }),
    ];
    expect(selectPeer(rows, "ltifr", "C", "all", 2022)?.sourceKey).toBe("section row");
    expect(selectPeer(rows, "ltifr", "J", "all", 2022)?.sourceKey).toBe("all row");
  });

  it("keeps both columns through a whole computation and its schema parse", () => {
    const body = compute({
      peers: [peer("accident_rate_per_1000_fte", "C", "all", [34.9, 49.9, 66.4], { basis })],
    });
    const parsed = parseSnapshotBlocks({ model_version: MODEL_VERSION, ...body });
    expect(parsed.error).toBeNull();
    const result = parsed.blocks?.results.find(
      (entry) => entry.key === "accident_rate_per_1000_fte",
    );
    // Through the v3 schema rather than off the raw body, so a schema that stripped the field
    // would fail here rather than passing on the in memory object.
    expect(result?.peer?.basis).toEqual(basis);
  });
});

/**
 * The signal on a broadened peer group (spec 0016, AC-6b). The rung label is covered in the segment
 * test; what is not covered is the reason the spec gives for needing it, that the fallback can flip
 * the shape. A company whose own single point section loses its row during curation falls to the
 * `ALL` row, which carries real spread, so the page would quietly start drawing a `QuartileBand`
 * over a comparison group that changed underneath the client.
 */
describe("a broadened peer group can change the shape (spec 0016, AC-6b)", () => {
  const pointRow = (section: string) =>
    peer("ltifr", section, "all", [44.3, 44.3, 44.3], { periodYear: 2022 });
  const spreadRow = peer("ltifr", "ALL", "all", [1, 2, 4], { periodYear: 2022 });

  it("reports rung 1 and keeps the point shape while the company's own section has a row", () => {
    const chosen = selectPeer([pointRow("D"), spreadRow], "ltifr", "D", "all", 2022);
    expect(chosen?.rung).toBe(1);
    expect(chosen?.shape).toBe("point");
    expect(chosen?.industrySection).toBe("D");
  });

  it("falls to the ALL row and flips to a distribution when that section row goes away", () => {
    // The same company and the same KPI, with only the section row removed: exactly what a curation
    // pass does when it retires a row it cannot source.
    const chosen = selectPeer([spreadRow], "ltifr", "D", "all", 2022);
    expect(chosen?.rung).toBe(3);
    expect(chosen?.industrySection).toBe("ALL");
    // The shape changed under the client, which is why the rung must be visible on the block: this
    // row now has a real spread and would otherwise draw a band with no signal the group changed.
    expect(chosen?.shape).toBe("distribution");
  });

  it("puts the rung on the snapshot so the label can say the group was broadened", () => {
    // Section J has no row in the suite's peer set, so the accident rate falls to the ALL rung and
    // the block carries a rung above 2, which is what the label reads.
    const body = compute({ company: { ...company, industryCode: "62.01" } });
    const result = body.results.find((entry) => entry.key === "accident_rate_per_1000_fte");
    expect(result?.peer?.rung).toBeGreaterThan(2);
    expect(result?.peer?.industrySection).toBe("ALL");
  });
});

/**
 * The property the outward rounding exists for (spec 0016, AC-9). The table above pins chosen
 * values; this pins the rule itself across the 10 000 step change, where a single step applied to
 * both ends would round a low of 10 400 up to 11 000 and show a band that excludes the real cost.
 */
describe("the displayed range always contains the computed one (spec 0016, AC-9)", () => {
  it("never rounds a low end up or a high end down, on either side of the step boundary", () => {
    const values = [0, 1, 99, 100, 4_849, 9_900, 9_999, 10_000, 10_001, 10_400, 99_999, 1_060_400];
    for (const low of values) {
      for (const high of values.filter((value) => value >= low)) {
        const rounded = roundChfRange(low, high);
        expect(rounded.low).toBeLessThanOrEqual(low);
        expect(rounded.high).toBeGreaterThanOrEqual(high);
        // A range never renders inverted, however close the two ends sit.
        expect(rounded.high).toBeGreaterThanOrEqual(rounded.low);
      }
    }
  });

  it("rounds each end at its own step when the range straddles 10 000", () => {
    // The end below the boundary takes the 100 step and the end above takes the 1 000 step, so a
    // low just over 10 000 is not dragged down a whole thousand by its own end's step.
    expect(roundChfRange(9_950, 10_400)).toEqual({ low: 9_900, high: 11_000 });
    expect(roundChfRange(10_400, 10_600)).toEqual({ low: 10_000, high: 11_000 });
  });

  it("contains the point estimate roundChf shows beside it", () => {
    // The card prints the range and the working estimate together, so a point estimate outside its
    // own range would read as an arithmetic error to the client.
    for (const [low, point, high] of [
      [1_060_400, 1_800_000, 2_650_100],
      [4_849, 6_000, 9_999],
      [9_999, 10_500, 12_001],
    ] as const) {
      const rounded = roundChfRange(low, high);
      expect(roundChf(point)).toBeGreaterThanOrEqual(rounded.low);
      expect(roundChf(point)).toBeLessThanOrEqual(rounded.high);
    }
  });
});
