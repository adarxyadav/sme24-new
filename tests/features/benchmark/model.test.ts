import { describe, expect, it } from "vitest";
import { MODEL_VERSION } from "@/features/benchmark/catalogue";
import {
  FATALITY_COST,
  HOURLY_COST,
  HOURS_PER_FTE,
  HOURS_PER_LTI,
  HOURS_PER_RECORDABLE,
  roundMoney,
} from "@/features/benchmark/loss";
import {
  computeBenchmark,
  lossOf,
  type ModelCompany,
  type ModelKpiRow,
  type ModelPeerRow,
  medianOf,
  peersBlockOf,
  recommendationOf,
  standingOf,
} from "@/features/benchmark/model";
import { parseSnapshotBlocks, SNAPSHOT_SCHEMAS } from "@/features/benchmark/snapshot";
import type { KpiKey } from "@/features/research/catalogue";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const company: ModelCompany = {
  id: UUID(1),
  employeesCount: 500,
  industryCode: "23.61",
  country: "CH",
  currency: "CHF",
  updatedAt: "2026-09-14T10:00:00.000Z",
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

function peer(
  peerName: string,
  kpiKey: ModelPeerRow["kpiKey"],
  value: number,
  overrides: Partial<ModelPeerRow> = {},
): ModelPeerRow {
  return {
    peerName,
    country: "CH",
    headcount: 1_000,
    kpiKey,
    periodYear: 2024,
    value,
    sourceUrl: `https://example.org/${peerName}`,
    confidence: 0.8,
    rung: "country",
    ...overrides,
  };
}

describe("the loss constants and roundMoney (spec 0022, AC-14)", () => {
  it("holds the owner's table", () => {
    expect(HOURS_PER_FTE).toBe(1800);
    expect(HOURS_PER_LTI).toBe(769);
    expect(HOURS_PER_RECORDABLE).toBe(201);
    expect(HOURLY_COST).toBe(75);
    expect(FATALITY_COST).toBe(1_200_000);
  });

  it("rounds to 100 below 10 000 and to 1 000 above", () => {
    expect(roundMoney(8_449)).toBe(8_400);
    expect(roundMoney(9_999)).toBe(10_000);
    expect(roundMoney(365_715)).toBe(366_000);
    expect(roundMoney(0)).toBe(0);
  });
});

describe("lossOf, the owner's table (spec 0022, AC-14)", () => {
  it("prices 500 FTE at LTIFR 6 and TRIFR 10 as 365 715", () => {
    const { ltis, recordables, loss } = lossOf({ fte: 500, ltifr: 6, trifr: 10, fatalities: 0 });
    // 6 × 500 × 1800 ÷ 1 000 000 = 5.4 lost time injuries.
    expect(ltis).toBeCloseTo(5.4, 10);
    // (10 − 6) × 500 × 1800 ÷ 1 000 000 = 3.6 further recordable injuries.
    expect(recordables).toBeCloseTo(3.6, 10);
    // (5.4 × 769 + 3.6 × 201) × 75 = (4152.6 + 723.6) × 75 = 4876.2 × 75 = 365 715.
    expect(loss).toBeCloseTo(365_715, 6);
  });

  it("adds 1 200 000 per death on top of the rate terms", () => {
    expect(lossOf({ fte: 500, ltifr: 6, trifr: 10, fatalities: 1 }).loss).toBeCloseTo(
      365_715 + 1_200_000,
      6,
    );
  });

  it("contributes no recordable term when TRIFR sits below LTIFR", () => {
    const { recordables, loss } = lossOf({ fte: 500, ltifr: 6, trifr: 4, fatalities: 0 });
    expect(recordables).toBe(0);
    // 5.4 × 769 × 75 = 311 445, the lost time term alone.
    expect(loss).toBeCloseTo(311_445, 6);
  });
});

describe("medianOf and standingOf (spec 0022, AC-13)", () => {
  it("takes the middle value on an odd count and the mean of the two middle on an even one", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([7])).toBe(7);
  });

  it("ranks one plus the peers strictly better, out of the peers plus the client", () => {
    const standing = standingOf([1, 2, 3, 4], 3);
    expect(standing).toEqual({
      count: 4,
      median: 2.5,
      best: 1,
      rank: 3,
      of: 5,
      gapToMedian: 0.5,
    });
  });

  it("gives equal values the same rank and leaves the rank null without a client value", () => {
    expect(standingOf([2, 2, 2], 2)?.rank).toBe(1);
    expect(standingOf([1, 2], null)).toEqual({
      count: 2,
      median: 1.5,
      best: 1,
      rank: null,
      of: 3,
      gapToMedian: null,
    });
    expect(standingOf([], 3)).toBeNull();
  });
});

describe("peersBlockOf (spec 0022, AC-13)", () => {
  const rows: readonly ModelPeerRow[] = [
    peer("Rieter", "ltifr", 3.3, { headcount: 4_859 }),
    peer("Rieter", "trifr", 7.0, { headcount: 4_859 }),
    peer("BASF", "ltifr", 2.5, { headcount: 111_822, country: "DE", rung: "country" }),
    peer("BASF", "trifr", 3.78, { headcount: 111_822, country: "DE" }),
    peer("Ohne Zahl", "trifr", 9.0, { headcount: null }),
  ];

  it("lists each peer once with both rates, sorted by LTIFR with the LTIFR-less last", () => {
    const block = peersBlockOf(rows, () => null, false);
    expect(block?.rows.map((row) => row.peerName)).toEqual(["BASF", "Rieter", "Ohne Zahl"]);
    expect(block?.rows[0]?.ltifr).toBe(2.5);
    expect(block?.rows[0]?.trifr).toBe(3.78);
    expect(block?.rows[2]?.ltifr).toBeNull();
    expect(block?.rung).toBe("country");
  });

  it("prices each peer's own loss from its headcount and rates, a total that grows with size", () => {
    const block = peersBlockOf(rows, () => null, false);
    const basf = block?.rows.find((row) => row.peerName === "BASF")?.estimatedLoss ?? 0;
    const rieter = block?.rows.find((row) => row.peerName === "Rieter")?.estimatedLoss ?? 0;
    // BASF: 2.5 × 111 822 × 1800 ÷ 1e6 = 503.199 LTIs; (3.78 − 2.5) × … = 257.6378879 recordables;
    // (503.199 × 769 + 257.6378879 × 201) × 75 = 32 905 893.4866, rounded 32 906 000.
    expect(roundMoney(basf)).toBe(32_906_000);
    // Rieter: 3.3 × 4859 × 1800 ÷ 1e6 = 28.86246 LTIs; (7 − 3.3) × … = 32.36094 recordables;
    // (28.86246 × 769 + 32.36094 × 201) × 75 = 2 152 483.551, rounded 2 152 000.
    expect(roundMoney(rieter)).toBe(2_152_000);
    // The lower rates do not help: about fifteen times the loss on about twenty three times the size.
    expect(basf / rieter).toBeGreaterThan(14);
    expect(basf / rieter).toBeLessThan(16);
    // A peer with no published headcount shows no loss at all.
    expect(block?.rows.find((row) => row.peerName === "Ohne Zahl")?.estimatedLoss).toBeNull();
  });

  it("counts a rate the peer did not publish as zero for its term", () => {
    const block = peersBlockOf([peer("Solo", "trifr", 5, { headcount: 1_000 })], () => null, true);
    // No LTIFR: 5 × 1000 × 1800 ÷ 1e6 = 9 recordables, 9 × 201 × 75 = 135 675.
    expect(block?.rows[0]?.estimatedLoss).toBeCloseTo(135_675, 6);
    expect(block?.rates.ltifr).toBeUndefined();
    expect(block?.thin).toBe(true);
  });

  it("is null without a peer", () => {
    expect(peersBlockOf([], () => null, true)).toBeNull();
  });
});

describe("recommendationOf, the standing (spec 0022, AC-15)", () => {
  const base = { fatalities: 0, hasLtifr: true, savingAtMedian: 0, worseCount: 0 };

  it("answers each of the five outcomes, first match wins", () => {
    expect(recommendationOf({ ...base, fatalities: 1, worseCount: 0 })).toEqual({
      packageKey: "retainer",
      reason: "fatality",
    });
    expect(recommendationOf({ ...base, savingAtMedian: 250_001 })).toEqual({
      packageKey: "retainer",
      reason: "large_saving",
    });
    expect(recommendationOf({ ...base, hasLtifr: false, savingAtMedian: null })).toEqual({
      packageKey: "sms",
      reason: "no_figures",
    });
    expect(recommendationOf({ ...base, worseCount: 2 })).toEqual({
      packageKey: "compliance",
      reason: "both_worse",
    });
    expect(recommendationOf({ ...base, worseCount: 1 })).toEqual({
      packageKey: "sms",
      reason: "one_worse",
    });
    expect(recommendationOf(base)).toEqual({ packageKey: "culture", reason: "both_better" });
  });

  it("leaves the retainer to a saving strictly above 250 000", () => {
    expect(recommendationOf({ ...base, savingAtMedian: 250_000 }).packageKey).toBe("culture");
  });
});

describe("computeBenchmark (spec 0022, AC-12 to AC-16)", () => {
  const peers: readonly ModelPeerRow[] = [
    peer("Alpha", "ltifr", 2),
    peer("Alpha", "trifr", 5),
    peer("Beta", "ltifr", 4),
    peer("Beta", "trifr", 9),
    peer("Gamma", "ltifr", 8),
    peer("Gamma", "trifr", 13),
  ];

  it("prices the client, the median and the best peer from one formula", () => {
    const body = computeBenchmark({
      company,
      kpis: [kpi("ltifr", 6), kpi("trifr", 10)],
      peers,
    });
    expect(body.loss?.ltis).toBeCloseTo(5.4, 10);
    expect(body.loss?.recordables).toBeCloseTo(3.6, 10);
    expect(body.loss?.loss).toBeCloseTo(365_715, 6);
    expect(body.loss?.trifrMissing).toBe(false);
    // The peer medians are LTIFR 4 and TRIFR 9: 3.6 LTIs and 4.5 recordables,
    // (3.6 × 769 + 4.5 × 201) × 75 = (2768.4 + 904.5) × 75 = 3672.9 × 75 = 275 467.5.
    expect(body.loss?.atMedian).toBeCloseTo(275_467.5, 6);
    expect(body.loss?.savingAtMedian).toBeCloseTo(365_715 - 275_467.5, 6);
    // The best peers are LTIFR 2 and TRIFR 5: 1.8 LTIs and 2.7 recordables,
    // (1.8 × 769 + 2.7 × 201) × 75 = (1384.2 + 542.7) × 75 = 1926.9 × 75 = 144 517.5.
    expect(body.loss?.atBest).toBeCloseTo(144_517.5, 6);
    expect(body.loss?.savingAtBest).toBeCloseTo(365_715 - 144_517.5, 6);
    // Scalars are stored unrounded and in the company's currency (AC-16).
    expect(body.currency).toBe("CHF");
    expect(body.lossAmount).toBe(body.loss?.loss);
    expect(body.savingAtMedian).toBe(body.loss?.savingAtMedian);
    expect(body.kpisCompared).toBe(2);
  });

  it("ranks the client among the peers of each rate (AC-13)", () => {
    const body = computeBenchmark({
      company,
      kpis: [kpi("ltifr", 6), kpi("trifr", 10)],
      peers,
    });
    // LTIFR 6 beats only Gamma's 8, so two peers are better: rank 3 of 4.
    expect(body.peers?.rates.ltifr).toMatchObject({ count: 3, median: 4, best: 2, rank: 3, of: 4 });
    // TRIFR 10 beats only Gamma's 13: rank 3 of 4 again, the gap to the median 1.
    expect(body.peers?.rates.trifr).toMatchObject({ median: 9, rank: 3, of: 4, gapToMedian: 1 });
  });

  it("treats a missing TRIFR as no recordable term and says so (AC-14)", () => {
    const body = computeBenchmark({ company, kpis: [kpi("ltifr", 6)], peers });
    expect(body.loss?.trifrMissing).toBe(true);
    expect(body.loss?.recordables).toBe(0);
    // 5.4 × 769 × 75 = 311 445.
    expect(body.loss?.loss).toBeCloseTo(311_445, 6);
    // The rate the client lacks still ranks nothing, but the peers keep their standing.
    expect(body.peers?.rates.trifr?.rank).toBeNull();
  });

  it("leaves the loss null without a headcount or without an LTIFR (AC-14)", () => {
    expect(
      computeBenchmark({
        company: { ...company, employeesCount: null },
        kpis: [kpi("ltifr", 6)],
        peers,
      }).loss,
    ).toBeNull();
    expect(computeBenchmark({ company, kpis: [kpi("trifr", 10)], peers }).loss).toBeNull();
    expect(
      computeBenchmark({ company, kpis: [kpi("ltifr", 6)], peers: [] }).loss?.savingAtMedian,
    ).toBeNull();
  });

  it("takes the newest year per key independently (AC-14)", () => {
    const body = computeBenchmark({
      company,
      kpis: [
        kpi("ltifr", 9, { periodYear: 2023 }),
        kpi("ltifr", 6, { periodYear: 2025 }),
        kpi("trifr", 10, { periodYear: 2024 }),
      ],
      peers,
    });
    expect(body.inputs.kpis.find((input) => input.key === "ltifr")?.value).toBe(6);
    expect(body.inputs.kpis.find((input) => input.key === "trifr")?.periodYear).toBe(2024);
  });

  it("recommends the retainer on a death and compliance when both rates are worse (AC-15)", () => {
    const fatal = computeBenchmark({
      company,
      kpis: [kpi("ltifr", 6), kpi("trifr", 10), kpi("fatalities", 1, { source: "client" })],
      peers,
    });
    expect(fatal.recommendation).toEqual({ packageKey: "retainer", reason: "fatality" });
    expect(fatal.loss?.fatalities).toBe(1);
    expect(fatal.loss?.loss).toBeCloseTo(365_715 + 1_200_000, 6);

    const better = computeBenchmark({
      company,
      kpis: [kpi("ltifr", 1), kpi("trifr", 2)],
      peers,
    });
    expect(better.recommendation).toEqual({ packageKey: "culture", reason: "both_better" });

    const worseOnOne = computeBenchmark({
      company,
      kpis: [kpi("ltifr", 6), kpi("trifr", 2)],
      peers,
    });
    expect(worseOnOne.recommendation).toEqual({ packageKey: "sms", reason: "one_worse" });
  });

  it("takes the minimum confidence over the client rows the loss used (AC-16)", () => {
    const body = computeBenchmark({
      company,
      kpis: [kpi("ltifr", 6, { confidence: 0.7 }), kpi("trifr", 10, { confidence: 0.4 })],
      peers,
    });
    expect(body.confidence).toBe(0.4);
    // A null confidence counts 1 for a client row and 0.5 for a research row.
    expect(
      computeBenchmark({
        company,
        kpis: [kpi("ltifr", 6, { confidence: null, source: "client" })],
        peers,
      }).confidence,
    ).toBe(1);
    expect(
      computeBenchmark({ company, kpis: [kpi("ltifr", 6, { confidence: null })], peers })
        .confidence,
    ).toBe(0.5);
  });

  it("writes a body the @7 schema accepts and reads back (AC-12)", () => {
    const body = computeBenchmark({
      company,
      kpis: [kpi("ltifr", 6), kpi("trifr", 10)],
      peers,
    });
    const schema = SNAPSHOT_SCHEMAS[MODEL_VERSION];
    expect(schema).toBeDefined();
    const blocks = schema?.parse({
      inputs: body.inputs,
      peers: body.peers,
      loss: body.loss,
      recommendation: body.recommendation,
    });
    // The task stores `loss` in `cost` and `recommendation` in `derived` (AC-16).
    const parsed = parseSnapshotBlocks({
      model_version: MODEL_VERSION,
      inputs: blocks?.inputs,
      peers: blocks?.peers,
      cost: blocks?.loss,
      derived: blocks?.recommendation,
    });
    expect(parsed.error).toBeNull();
    expect(parsed.blocks?.loss?.loss).toBeCloseTo(365_715, 6);
    expect(parsed.blocks?.inputs.currency).toBe("CHF");
  });

  it("holds only @7 in SNAPSHOT_SCHEMAS, so a stored @1 to @6 row is unreadable (AC-12, AC-18)", () => {
    expect(Object.keys(SNAPSHOT_SCHEMAS)).toEqual(["benchmark-model@7"]);
    expect(MODEL_VERSION).toBe("benchmark-model@7");
  });
});
