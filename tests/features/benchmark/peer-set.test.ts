import { describe, expect, it } from "vitest";
import {
  MODEL_VERSION,
  PEER_SET_EXCLUDED_KPIS,
  PEER_SET_MIN,
  roundPercentile,
} from "@/features/benchmark/catalogue";
import {
  computeBenchmark,
  type ModelAssumption,
  type ModelCatalogueEntry,
  type ModelCompany,
  type ModelKpiRow,
  type ModelPeerRow,
  type ModelPeerValueRow,
  peerSetOf,
} from "@/features/benchmark/model";
import {
  parseSnapshotBlocks,
  SNAPSHOT_SCHEMAS,
  snapshotBlocksV1Schema,
  snapshotBlocksV2Schema,
} from "@/features/benchmark/snapshot";
import { KPI_CATALOGUE, KPI_KEYS, type KpiKey } from "@/features/research/catalogue";

/**
 * The pure peer layer (spec 0012, AC-8 to AC-11, AC-16): the percentile formula in both
 * directions with ties, the five peer threshold, the excluded KPI, the section and band filter,
 * the newest year per peer, the stored row ids, the untouched CHF figures and ranks, and the two
 * snapshot schemas side by side.
 */
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const catalogue: readonly ModelCatalogueEntry[] = KPI_KEYS.map((key, index) => ({
  key,
  direction: KPI_CATALOGUE[key].direction,
  sortOrder: (index + 1) * 10,
}));

const company: ModelCompany = {
  id: UUID(1),
  employeesCount: 120,
  industryCode: "25.11",
  updatedAt: "2026-09-07T10:00:00.000Z",
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
function statistics(
  key: KpiKey,
  [p25, median, p75]: readonly [number, number, number],
): ModelPeerRow {
  peerCounter += 1;
  return {
    id: UUID(peerCounter),
    kpiKey: key,
    industrySection: "C",
    sizeBand: "50-249",
    periodYear: 2022,
    p25,
    median,
    p75,
    sampleSize: null,
    provisional: true,
  };
}

let valueCounter = 900;
function peerValue(
  label: string,
  key: KpiKey,
  value: number,
  overrides: Partial<ModelPeerValueRow> = {},
): ModelPeerValueRow {
  valueCounter += 1;
  const letter = label.slice(-1);
  return {
    kpiRowId: UUID(valueCounter),
    peerId: `0e000000-0000-4000-8000-00000000000${letter.toLowerCase()}`.slice(0, 36),
    label,
    kpiKey: key,
    value,
    periodYear: 2024,
    industrySection: "C",
    sizeBand: "50-249",
    ...overrides,
  };
}

const LABELS = ["Peer A", "Peer B", "Peer C", "Peer D", "Peer E", "Peer F"] as const;

/** Six LTIFR peers: 1, 2, 3, 3, 5, 8 (lower is better). */
const ltifrPeers = [1, 2, 3, 3, 5, 8].map((value, index) =>
  peerValue(LABELS[index] as string, "ltifr", value),
);

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

describe("peerSetOf (spec 0012, AC-8, AC-9)", () => {
  it("counts the peers the client beats plus half the ties, in the KPI's direction", () => {
    // Client 3 among 1, 2, 3, 3, 5, 8: beats 5 and 8 (worse = 2), ties two (equal = 2), n = 6.
    const set = peerSetOf(ltifrPeers, "ltifr", "lower_is_better", "C", "50-249", 3);
    expect(set?.n).toBe(6);
    expect(set?.percentile).toBe(roundPercentile((100 * (2 + 0.5 * 2)) / 6));
    expect(set?.percentile).toBe(50);
    expect(set?.min).toBe(1);
    expect(set?.max).toBe(8);
    expect(set?.section).toBe("C");
    expect(set?.sizeBand).toBe("50-249");
  });

  it("inverts which peers count as worse for a higher is better KPI", () => {
    const nearMisses = [10, 20, 30, 40, 50].map((value, index) =>
      peerValue(LABELS[index] as string, "near_miss_rate", value),
    );
    // Client 35 beats 10, 20 and 30 (worse = 3), no tie: 60 %.
    expect(
      peerSetOf(nearMisses, "near_miss_rate", "higher_is_better", "C", "50-249", 35)?.percentile,
    ).toBe(60);
    // The same numbers read as lower is better: the client beats 40 and 50 only.
    expect(
      peerSetOf(nearMisses, "near_miss_rate", "lower_is_better", "C", "50-249", 35)?.percentile,
    ).toBe(40);
  });

  it("gives 0 to the worst client and 100 to the best", () => {
    expect(peerSetOf(ltifrPeers, "ltifr", "lower_is_better", "C", "50-249", 9)?.percentile).toBe(0);
    expect(peerSetOf(ltifrPeers, "ltifr", "lower_is_better", "C", "50-249", 0.5)?.percentile).toBe(
      100,
    );
  });

  it(`needs at least ${PEER_SET_MIN} peers with a value`, () => {
    expect(
      peerSetOf(ltifrPeers.slice(0, 4), "ltifr", "lower_is_better", "C", "50-249", 3),
    ).toBeNull();
    expect(peerSetOf(ltifrPeers.slice(0, 5), "ltifr", "lower_is_better", "C", "50-249", 3)?.n).toBe(
      5,
    );
  });

  it("never builds a set for the excluded yes or no KPI, whatever the count", () => {
    expect(PEER_SET_EXCLUDED_KPIS).toContain("iso_45001_certified");
    const iso = LABELS.map((label) => peerValue(label, "iso_45001_certified", 1));
    expect(peerSetOf(iso, "iso_45001_certified", "higher_is_better", "C", "50-249", 1)).toBeNull();
  });

  it("uses only the peers of the company's own section and band, and needs a known section", () => {
    const mixed = [
      ...ltifrPeers.slice(0, 4),
      peerValue("Peer E", "ltifr", 2, { industrySection: "F" }),
      peerValue("Peer F", "ltifr", 2, { sizeBand: "250+" }),
    ];
    expect(peerSetOf(mixed, "ltifr", "lower_is_better", "C", "50-249", 3)).toBeNull();
    expect(peerSetOf(ltifrPeers, "ltifr", "lower_is_better", null, "50-249", 3)).toBeNull();
  });

  it("takes one value per peer, the newest year, and records the row id it used", () => {
    const older = peerValue("Peer A", "ltifr", 9, {
      periodYear: 2023,
      peerId: ltifrPeers[0]?.peerId,
    });
    const set = peerSetOf([older, ...ltifrPeers], "ltifr", "lower_is_better", "C", "50-249", 3);
    expect(set?.n).toBe(6);
    const peerA = set?.values.find((entry) => entry.label === "Peer A");
    expect(peerA?.value).toBe(1);
    expect(peerA?.periodYear).toBe(2024);
    expect(peerA?.kpiRowId).toBe(ltifrPeers[0]?.kpiRowId);
    expect(set?.values.map((entry) => entry.label)).toEqual([...LABELS]);
  });
});

describe("computeBenchmark with named peers (spec 0012, AC-10, AC-11, AC-16)", () => {
  const kpis = [
    kpi("ltifr", 3),
    kpi("accident_rate_per_1000_fte", 55),
    kpi("iso_45001_certified", 1),
  ];
  const peers = [
    statistics("ltifr", [1, 2, 4]),
    statistics("accident_rate_per_1000_fte", [34.9, 49.9, 66.4]),
  ];
  const without = computeBenchmark({ company, catalogue, kpis, peers, assumptions });
  const withPeers = computeBenchmark({
    company,
    catalogue,
    kpis,
    peers,
    peerValues: ltifrPeers,
    assumptions,
  });

  it("changes no CHF figure, no gap rank, no position and no compared count", () => {
    const strip = (body: typeof without) => ({
      ...body,
      results: body.results.map(({ peerSet: _peerSet, ...rest }) => rest),
    });
    expect(strip(withPeers)).toEqual(strip(without));
    expect(withPeers.costChf).toBe(without.costChf);
    expect(withPeers.gaps).toEqual(without.gaps);
    expect(withPeers.kpisCompared).toBe(without.kpisCompared);
  });

  it("adds the peer set only to the KPI that has five peers, and omits the key elsewhere", () => {
    const ltifr = withPeers.results.find((result) => result.key === "ltifr");
    expect(ltifr?.peerSet?.n).toBe(6);
    expect(ltifr?.peerSet?.percentile).toBe(50);
    expect(ltifr?.peerSet?.values.map((entry) => entry.kpiRowId)).toEqual(
      ltifrPeers.map((row) => row.kpiRowId),
    );
    const accident = withPeers.results.find(
      (result) => result.key === "accident_rate_per_1000_fte",
    );
    expect(accident).not.toHaveProperty("peerSet");
    expect(without.results.every((result) => !("peerSet" in result))).toBe(true);
  });

  it("is field for field a version 1 snapshot when there are no peers", () => {
    const v1 = snapshotBlocksV1Schema.parse(without);
    const v2 = snapshotBlocksV2Schema.parse(without);
    expect(v2).toEqual(v1);
    expect(JSON.stringify(v2)).toBe(JSON.stringify(v1));
  });

  it("keeps both schemas in the map and reads a version 1 row without a peer set", () => {
    expect(MODEL_VERSION).toBe("benchmark-model@2");
    expect(Object.keys(SNAPSHOT_SCHEMAS).sort()).toEqual([
      "benchmark-model@1",
      "benchmark-model@2",
    ]);
    const v1Row = parseSnapshotBlocks({ model_version: "benchmark-model@1", ...without });
    expect(v1Row.blocks?.results.every((result) => result.peerSet === undefined)).toBe(true);
    const v2Row = parseSnapshotBlocks({ model_version: MODEL_VERSION, ...withPeers });
    expect(v2Row.blocks?.results.find((result) => result.key === "ltifr")?.peerSet?.n).toBe(6);
    // A version 1 schema refuses a peer set with too few peers; the v2 schema refuses it as well.
    const tooFew = {
      ...withPeers,
      results: withPeers.results.map((result) =>
        result.peerSet
          ? {
              ...result,
              peerSet: { ...result.peerSet, n: 2, values: result.peerSet.values.slice(0, 2) },
            }
          : result,
      ),
    };
    expect(parseSnapshotBlocks({ model_version: MODEL_VERSION, ...tooFew }).blocks).toBeNull();
  });
});
