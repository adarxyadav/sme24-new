import { describe, expect, it } from "vitest";
import { MODEL_VERSION } from "@/features/benchmark/catalogue";
import {
  chartPeerKeys,
  climbLadder,
  computeBenchmark,
  keptFigures,
  type ModelAssumption,
  type ModelCatalogueEntry,
  type ModelKpiRow,
  type ModelPeerCompany,
  type ModelPeerFigure,
  type ModelPeerLibrary,
  rankAmong,
} from "@/features/benchmark/model";
import { parseSnapshotBlocks, SNAPSHOT_SCHEMAS } from "@/features/benchmark/snapshot";
import { KPI_CATALOGUE, KPI_KEYS, type KpiKey } from "@/features/research/catalogue";
import { FIXTURE_VALUES } from "@/lib/research/fixture";
import { seedAssumptions, seedCatalogue, seedPeers } from "./seed-helpers";

/**
 * The named published peers (spec 0021, AC-6 to AC-9, AC-12): the freshness, latest year and
 * basis rules, the four rungs and the minimum of three, rank ties, the gap to the best, the ISO
 * share, the saving per peer on one arm, the unknown country rule, the chart keys and the
 * snapshot block. Pure model, synthetic library, frozen clock.
 */
const NOW = new Date("2026-09-13T10:00:00.000Z");
const YEAR = 2026;
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const catalogue: readonly ModelCatalogueEntry[] = KPI_KEYS.map((key, index) => ({
  key,
  direction: KPI_CATALOGUE[key].direction,
  sortOrder: (index + 1) * 10,
}));

function company(key: string, country: string, headcount = 1000): ModelPeerCompany {
  return {
    key,
    name: key.toUpperCase(),
    country,
    industrySection: "C",
    headcount,
    headcountYear: 2024,
    reportUrl: `https://example.org/${key}`,
  };
}

function figure(
  peerKey: string,
  value: number,
  overrides: Partial<ModelPeerFigure> = {},
): ModelPeerFigure {
  return {
    peerKey,
    kpiKey: "ltifr",
    periodYear: 2024,
    value,
    valueAsPublished: value,
    unitAsPublished: "per_million_hours",
    basis: "employees",
    sourceUrl: `https://example.org/${peerKey}/report`,
    verifiedAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

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

const client = (country = "CH") => ({
  id: UUID(1),
  employeesCount: 420,
  industryCode: "23.61",
  country,
  updatedAt: "2026-09-13T00:00:00.000Z",
});

/** Two Swiss, one French and four Italian manufacturers with an LTIFR each: the country and the DACH region both hold fewer than three. */
const europe: ModelPeerLibrary = {
  companies: [
    company("ch-a", "CH", 300),
    company("ch-b", "CH", 5000),
    company("fr-a", "FR", 800),
    company("it-a", "IT", 450),
    company("it-b", "IT", 20000),
    company("it-c", "IT", 600),
    company("it-d", "IT", 900),
  ],
  figures: [
    figure("ch-a", 1.5),
    figure("ch-b", 4.0),
    figure("fr-a", 2.0),
    figure("it-a", 3.1),
    figure("it-b", 0.9),
    figure("it-c", 2.4),
    figure("it-d", 6.0),
  ],
};

const assumptions: readonly ModelAssumption[] = seedAssumptions();

describe("the kept figures (spec 0021, AC-6)", () => {
  it("ignores a figure older than the current year minus three", () => {
    const library: ModelPeerLibrary = {
      companies: [company("old", "CH"), company("fresh", "CH")],
      figures: [
        figure("old", 1, { periodYear: YEAR - 4 }),
        figure("fresh", 2, { periodYear: YEAR - 3 }),
      ],
    };
    expect(keptFigures(library, "ltifr", YEAR).map((peer) => peer.company.key)).toEqual(["fresh"]);
  });

  it("keeps the latest year per company, and the employees basis within that year", () => {
    const library: ModelPeerLibrary = {
      companies: [company("a", "CH"), company("b", "CH")],
      figures: [
        figure("a", 3, { periodYear: 2023 }),
        figure("a", 2, { periodYear: 2024, basis: "employees_and_contractors" }),
        figure("a", 1, { periodYear: 2024, basis: "employees" }),
        // A company with only a contractor inclusive figure keeps it, and its basis shows.
        figure("b", 5, { basis: "employees_and_contractors" }),
      ],
    };
    const kept = keptFigures(library, "ltifr", YEAR);
    expect(kept.map((peer) => [peer.company.key, peer.figure.value, peer.figure.basis])).toEqual([
      ["a", 1, "employees"],
      ["b", 5, "employees_and_contractors"],
    ]);
  });

  it("drops a figure whose company is not in the library and a figure of another KPI", () => {
    const library: ModelPeerLibrary = {
      companies: [company("a", "CH")],
      figures: [figure("ghost", 1), figure("a", 2, { kpiKey: "trifr" })],
    };
    expect(keptFigures(library, "ltifr", YEAR)).toEqual([]);
  });
});

describe("the ladder (spec 0021, AC-6)", () => {
  const peers = keptFigures(europe, "ltifr", YEAR);

  it("widens to Europe for a Swiss client when the country and the region hold fewer than three", () => {
    const climbed = climbLadder(peers, "CH");
    expect(climbed?.geoRung).toBe("europe");
    expect(climbed?.peers).toHaveLength(7);
  });

  it("stops at the country with three Swiss companies", () => {
    const withThird: ModelPeerLibrary = {
      companies: [...europe.companies, company("ch-c", "CH")],
      figures: [...europe.figures, figure("ch-c", 2.2)],
    };
    const climbed = climbLadder(keptFigures(withThird, "ltifr", YEAR), "CH");
    expect(climbed?.geoRung).toBe("country");
    expect(climbed?.peers.map((peer) => peer.company.key).sort()).toEqual(["ch-a", "ch-b", "ch-c"]);
  });

  it("stops at the region when the DACH four hold three", () => {
    const dach: ModelPeerLibrary = {
      companies: [...europe.companies, company("de-a", "DE")],
      figures: [...europe.figures, figure("de-a", 2.0)],
    };
    const climbed = climbLadder(keptFigures(dach, "ltifr", YEAR), "DE");
    // DE alone has one; DACH has ch-a, ch-b and de-a.
    expect(climbed?.geoRung).toBe("region");
    expect(climbed?.peers.map((peer) => peer.company.key).sort()).toEqual(["ch-a", "ch-b", "de-a"]);
  });

  it("lands a client country outside the catalogue on the world, never an error", () => {
    const climbed = climbLadder(peers, "US");
    expect(climbed?.geoRung).toBe("world");
    expect(climbed?.peers).toHaveLength(7);
  });

  it("gives no block with fewer than three even worldwide", () => {
    const two: ModelPeerLibrary = {
      companies: [company("a", "CH"), company("b", "US")],
      figures: [figure("a", 1), figure("b", 2)],
    };
    expect(climbLadder(keptFigures(two, "ltifr", YEAR), "CH")).toBeNull();
  });
});

describe("rank and gap (spec 0021, AC-7)", () => {
  const peers = keptFigures(europe, "ltifr", YEAR);

  it("counts strictly better peers, so equal values share a rank, and names the best", () => {
    // Values: 0.9, 1.5, 2.0, 2.4, 3.1, 4.0, 6.0. A client at 2.4 ties it-c: three strictly better.
    expect(rankAmong("lower_is_better", 2.4, peers)).toEqual({
      rank: 4,
      best: "it-b",
      gapToBest: expect.closeTo(1.5, 10),
    });
    expect(rankAmong("lower_is_better", 0.5, peers).rank).toBe(1);
    expect(rankAmong("lower_is_better", 100, peers).rank).toBe(8);
  });

  it("breaks a tie for the best by the lowest key", () => {
    const tied = keptFigures(
      {
        companies: [company("zed", "CH"), company("alpha", "CH"), company("mid", "CH")],
        figures: [figure("zed", 1), figure("alpha", 1), figure("mid", 2)],
      },
      "ltifr",
      YEAR,
    );
    expect(rankAmong("lower_is_better", 3, tied).best).toBe("alpha");
  });

  it("gives rank null and no gap without a client value, but still names the best", () => {
    expect(rankAmong("lower_is_better", null, peers)).toEqual({
      rank: null,
      best: "it-b",
      gapToBest: null,
    });
  });
});

describe("the peer block in the snapshot (spec 0021, AC-8, AC-9, AC-12)", () => {
  const fixtureKpis: readonly ModelKpiRow[] = KPI_KEYS.map((key) => kpi(key, FIXTURE_VALUES[key]));

  it("carries the LTIFR block on the Europe rung with the rows best first and the saving per peer", () => {
    const body = computeBenchmark({
      company: client(),
      catalogue,
      kpis: fixtureKpis,
      peers: seedPeers(),
      assumptions,
      library: europe,
      now: NOW,
    });
    expect(body.inputs.country).toBe("CH");
    const block = body.peers.find((entry) => entry.key === "ltifr");
    expect(block).toBeDefined();
    expect(block?.geoRung).toBe("europe");
    expect(block?.rank).toBe(4);
    expect(block?.best).toBe("it-b");
    expect(block?.rows.map((row) => row.value)).toEqual([0.9, 1.5, 2.0, 2.4, 3.1, 4.0, 6.0]);
    // The saving is the client's own, on the per million hours arm on both sides: rate × fte ×
    // hours / 1 000 000 incidents, times the cost per case and the middle multiplier.
    const values = Object.fromEntries(assumptions.map((row) => [row.key, row.value]));
    const value = (key: string) => values[key] ?? Number.NaN;
    const at = (rate: number) =>
      ((rate * 420 * value("hours_per_fte")) / 1_000_000) *
      (value("direct_cost_per_case_chf") + 12.5 * value("cost_per_absence_day_chf")) *
      value("indirect_multiplier");
    const best = block?.rows[0];
    expect(best?.savingAtPeer).toBeCloseTo(at(2.4) - at(0.9), 6);
    // A peer the client ties or beats reads already ahead; a worse peer too.
    expect(block?.rows[3]?.savingAtPeer).toBe("already_ahead");
    expect(block?.rows[6]?.savingAtPeer).toBe("already_ahead");
    // Every row carries its country, year, basis and source (the schema requires them).
    for (const row of block?.rows ?? []) {
      expect(row.country).toMatch(/^[A-Z]{2}$/);
      expect(row.sourceUrl).toMatch(/^https:/);
      expect(row.basis).toBe("employees");
      expect(row.periodYear).toBe(2024);
    }
    // The body parses under the live version and the reader gives the block back.
    const schema = SNAPSHOT_SCHEMAS[MODEL_VERSION];
    expect(schema?.safeParse({ ...body }).success).toBe(true);
  });

  it("prices nothing for TRIFR and ISO, and nothing at all when the cost is null", () => {
    const withTrifr: ModelPeerLibrary = {
      companies: europe.companies,
      figures: [
        ...europe.figures,
        ...europe.figures.slice(0, 3).map((row) => ({ ...row, kpiKey: "trifr" as const })),
        ...europe.figures
          .slice(0, 3)
          .map((row) => ({ ...row, kpiKey: "iso_45001_certified" as const, value: 1 })),
      ],
    };
    const body = computeBenchmark({
      company: client(),
      catalogue,
      kpis: fixtureKpis,
      peers: seedPeers(),
      assumptions,
      library: withTrifr,
      now: NOW,
    });
    const trifr = body.peers.find((entry) => entry.key === "trifr");
    expect(trifr?.rows.every((row) => row.savingAtPeer === null)).toBe(true);
    const iso = body.peers.find((entry) => entry.key === "iso_45001_certified");
    expect(iso?.rank).toBeNull();
    expect(iso?.certifiedShare).toBe(1);
    expect(iso?.rows.every((row) => row.savingAtPeer === null)).toBe(true);

    // No headcount: no cost, so every LTIFR saving is null and the rank still stands.
    const noFte = computeBenchmark({
      company: { ...client(), employeesCount: null },
      catalogue,
      kpis: fixtureKpis,
      peers: seedPeers(),
      assumptions,
      library: europe,
      now: NOW,
    });
    expect(noFte.cost).toBeNull();
    const block = noFte.peers.find((entry) => entry.key === "ltifr");
    expect(block?.rank).toBe(4);
    expect(block?.rows.every((row) => row.savingAtPeer === null)).toBe(true);
  });

  it("lists the peers with rank null and no saving when the client has no LTIFR row", () => {
    const body = computeBenchmark({
      company: client(),
      catalogue,
      kpis: fixtureKpis.filter((row) => row.kpiKey !== "ltifr"),
      peers: seedPeers(),
      assumptions,
      library: europe,
      now: NOW,
    });
    const block = body.peers.find((entry) => entry.key === "ltifr");
    expect(block?.rank).toBeNull();
    expect(block?.gapToBest).toBeNull();
    expect(block?.rows).toHaveLength(7);
    expect(block?.rows.every((row) => row.savingAtPeer === null)).toBe(true);
  });

  it("gives an empty peers block with an empty library, and a US client lands on world", () => {
    const empty = computeBenchmark({
      company: client(),
      catalogue,
      kpis: fixtureKpis,
      peers: seedPeers(),
      assumptions,
      now: NOW,
    });
    expect(empty.peers).toEqual([]);
    const world = computeBenchmark({
      company: client("US"),
      catalogue,
      kpis: fixtureKpis,
      peers: seedPeers(),
      assumptions,
      library: europe,
      now: NOW,
    });
    expect(world.peers.find((entry) => entry.key === "ltifr")?.geoRung).toBe("world");
  });

  it("picks the chart's peers nearest in headcount among those with a lost days figure, at most six", () => {
    const peers = keptFigures(europe, "ltifr", YEAR);
    const library: ModelPeerLibrary = {
      companies: europe.companies,
      figures: [
        ...europe.figures,
        ...europe.companies
          .filter((row) => row.key !== "it-d")
          .map((row) =>
            figure(row.key, 10, { kpiKey: "lost_days_per_incident", unitAsPublished: "days" }),
          ),
      ],
    };
    // Distance from 420: it-a 30, ch-a 120, it-c 180, fr-a 380, ch-b 4 580, it-b 19 580; it-d has
    // no lost days figure and stays out.
    expect(chartPeerKeys(peers, library, 420)).toEqual([
      "it-a",
      "ch-a",
      "it-c",
      "fr-a",
      "ch-b",
      "it-b",
    ]);
    expect(
      chartPeerKeys(peers, { companies: europe.companies, figures: europe.figures }, 420),
    ).toEqual([]);
    expect(chartPeerKeys([], library, 420)).toEqual([]);
  });

  it("reads a stored @4 row as having no peers and a @5 row with its block", () => {
    const body = computeBenchmark({
      company: client(),
      catalogue,
      kpis: fixtureKpis,
      peers: seedPeers(),
      assumptions,
      library: europe,
      now: NOW,
    });
    const row = {
      inputs: body.inputs,
      results: body.results,
      gaps: body.gaps,
      cost: body.cost,
      assumptions: body.assumptions,
      derived: body.derived,
      peers: body.peers,
    };
    const v5 = parseSnapshotBlocks({ model_version: "benchmark-model@5", ...row });
    expect(v5.blocks?.peers).toHaveLength(1);
    expect(v5.blocks?.inputs.country).toBe("CH");
    const { country: _country, ...oldInputs } = body.inputs;
    const v4 = parseSnapshotBlocks({
      model_version: "benchmark-model@4",
      ...row,
      inputs: oldInputs,
      peers: undefined,
    });
    expect(v4.error).toBeNull();
    expect(v4.blocks?.peers).toEqual([]);
    // A @5 row with an empty block is the "no published peer yet" case (AC-12).
    const emptyV5 = parseSnapshotBlocks({ model_version: "benchmark-model@5", ...row, peers: [] });
    expect(emptyV5.blocks?.peers).toEqual([]);
  });
});
