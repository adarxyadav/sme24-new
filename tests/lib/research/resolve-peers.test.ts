// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PeerVerdict } from "@/lib/ai/schemas/peer-validation";
import type { PeerCompany } from "@/lib/research/peer-schema";
import {
  climbRung,
  isSelfPeer,
  type KeptPeer,
  normaliseCompanyName,
  resolvePeers,
} from "@/lib/research/resolve-peers";
import type { PeerVerdictKey } from "@/lib/research/validate-peers";
import { verdictKey } from "@/lib/research/validate-peers";

/**
 * The peer rules of spec 0022 (AC-7, AC-8): the conversion to per million hours happens in code
 * from the printed unit and holds even when the validation call was skipped; a peer that is the
 * client under another spelling is dropped as `self` and one left without a supported rate as
 * `unsupported`; the rung is the first of country, region and world holding three peers, and fewer
 * than three worldwide keeps what there is with `thin`.
 */

const RATE = {
  value: 6,
  unit: "per_million_hours",
  periodYear: 2025,
  sourceUrl: "https://www.example.com/report",
  sourceTitle: "Sustainability report",
  basis: "employees" as const,
};

function peer(overrides: Partial<PeerCompany> = {}): PeerCompany {
  return {
    name: "Peer AG",
    website: "https://www.peer.example",
    country: "CH",
    headcount: 300,
    headcountYear: 2025,
    ltifr: { ...RATE },
    trifr: null,
    ...overrides,
  };
}

/** Every rate of every given peer supported, so only the drops under test decide the outcome. */
function allSupported(peers: readonly PeerCompany[]): ReadonlyMap<PeerVerdictKey, PeerVerdict> {
  const verdicts = new Map<PeerVerdictKey, PeerVerdict>();
  for (const [index, entry] of peers.entries()) {
    for (const kpiKey of ["ltifr", "trifr"] as const) {
      const rate = entry[kpiKey];
      if (!rate) continue;
      verdicts.set(verdictKey(index, kpiKey), {
        peerIndex: index,
        kpiKey,
        supported: true,
        periodYear: rate.periodYear,
        confidence: 0.9,
        sourceIndexes: [0],
      });
    }
  }
  return verdicts;
}

function keptPeer(country: string, name = `Peer ${country}`): KeptPeer {
  return {
    name,
    website: null,
    country,
    headcount: 100,
    headcountYear: 2025,
    rates: [
      {
        kpiKey: "ltifr",
        periodYear: 2025,
        value: 6,
        valueAsPublished: 6,
        unitAsPublished: "per_million_hours",
        basis: null,
        sourceUrl: "https://www.example.com/report",
        sourceTitle: null,
        confidence: 0.9,
      },
    ],
  };
}

describe("normaliseCompanyName", () => {
  it("strips the legal form, the punctuation and the accents", () => {
    expect(normaliseCompanyName("Muster AG")).toBe("muster");
    expect(normaliseCompanyName("Muster-Bau GmbH & Co. KG")).toBe("muster bau");
    expect(normaliseCompanyName("Sociéte Générale S.A.")).toBe("societe generale");
  });
});

describe("isSelfPeer (AC-8)", () => {
  it("drops a peer whose normalised name contains the client's", () => {
    expect(isSelfPeer({ name: "Muster Holding AG", website: null }, "Muster AG", null)).toBe(true);
  });

  it("drops a peer whose website host equals the client's", () => {
    expect(
      isSelfPeer(
        { name: "Quite Another Company", website: "https://www.muster.ch/en" },
        "Muster AG",
        "www.muster.ch",
      ),
    ).toBe(true);
  });

  it("keeps an unrelated peer", () => {
    expect(
      isSelfPeer({ name: "Beispiel AG", website: "https://beispiel.de" }, "Muster AG", null),
    ).toBe(false);
  });

  it("never matches on a client name that normalises to nothing", () => {
    expect(isSelfPeer({ name: "Beispiel AG", website: null }, "AG", null)).toBe(false);
  });
});

describe("climbRung (AC-7)", () => {
  it("stops on the country when three peers are headquartered there", () => {
    const peers = [keptPeer("CH", "A"), keptPeer("CH", "B"), keptPeer("CH", "C"), keptPeer("DE")];
    const climbed = climbRung(peers, "CH", ["CH", "DE", "AT"]);
    expect(climbed.rung).toBe("country");
    expect(climbed.peers).toHaveLength(3);
    expect(climbed.thin).toBe(false);
  });

  it("falls to the region with two at home and four in it", () => {
    const peers = [
      keptPeer("CH", "A"),
      keptPeer("CH", "B"),
      keptPeer("DE", "C"),
      keptPeer("AT", "D"),
      keptPeer("FR", "E"),
      keptPeer("US", "F"),
    ];
    const climbed = climbRung(peers, "CH", ["CH", "DE", "AT", "FR"]);
    expect(climbed.rung).toBe("region");
    expect(climbed.peers).toHaveLength(5);
    expect(climbed.thin).toBe(false);
  });

  it("falls to the world and keeps every peer", () => {
    const peers = [keptPeer("US", "A"), keptPeer("JP", "B"), keptPeer("BR", "C")];
    const climbed = climbRung(peers, "CH", ["CH", "DE"]);
    expect(climbed.rung).toBe("world");
    expect(climbed.peers).toHaveLength(3);
    expect(climbed.thin).toBe(false);
  });

  it("keeps two peers worldwide as thin", () => {
    const climbed = climbRung([keptPeer("US", "A"), keptPeer("JP", "B")], "CH", ["CH"]);
    expect(climbed.rung).toBe("world");
    expect(climbed.thin).toBe(true);
  });

  it("answers no rung for no peers", () => {
    expect(climbRung([], "CH", ["CH"])).toEqual({ rung: null, peers: [], thin: true });
  });
});

describe("resolvePeers (AC-7, AC-8)", () => {
  const base = { clientName: "Muster AG", clientWebsite: "https://www.muster.ch", country: "CH" };

  it("converts a per 200 000 hours figure times five and a per 100 workers one too", () => {
    const peers = [
      peer({ name: "A", ltifr: { ...RATE, value: 1.2, unit: "per_200k_hours" } }),
      peer({ name: "B", ltifr: { ...RATE, value: 0.4, unit: "per_100_workers" } }),
      peer({ name: "C", ltifr: { ...RATE, value: 7.5, unit: "per_million_hours" } }),
    ];
    const resolved = resolvePeers({
      ...base,
      peers,
      verdicts: allSupported(peers),
      regionCountries: ["CH", "DE"],
    });
    expect(resolved.kept.map((entry) => entry.rates[0]?.value)).toEqual([6, 2, 7.5]);
    expect(resolved.kept.map((entry) => entry.rates[0]?.valueAsPublished)).toEqual([1.2, 0.4, 7.5]);
  });

  it("converts in code even when the validation call was skipped, at the capped confidence", () => {
    const peers = [
      peer({ name: "A", ltifr: { ...RATE, value: 1.2, unit: "per_200k_hours" } }),
      peer({ name: "B" }),
      peer({ name: "C" }),
    ];
    const resolved = resolvePeers({ ...base, peers, verdicts: null, regionCountries: ["CH"] });
    expect(resolved.kept[0]?.rates[0]?.value).toBe(6);
    expect(
      resolved.kept.every((entry) => entry.rates.every((rate) => rate.confidence === 0.5)),
    ).toBe(true);
    expect(resolved.rung).toBe("country");
  });

  it("drops a rate printed in a unit outside the three", () => {
    const peers = [peer({ name: "A", ltifr: { ...RATE, unit: "per_1000_fte" }, trifr: null })];
    const resolved = resolvePeers({ ...base, peers, verdicts: null, regionCountries: ["CH"] });
    expect(resolved.kept).toHaveLength(0);
    expect(resolved.dropped).toEqual([{ name: "A", reason: "unsupported" }]);
  });

  it("drops the client under another spelling as self and lists it", () => {
    const peers = [
      peer({ name: "Muster Holding AG" }),
      peer({ name: "Beispiel AG", country: "DE" }),
    ];
    const resolved = resolvePeers({
      ...base,
      peers,
      verdicts: allSupported(peers),
      regionCountries: ["CH", "DE"],
    });
    expect(resolved.dropped).toEqual([{ name: "Muster Holding AG", reason: "self" }]);
    expect(resolved.kept.map((entry) => entry.name)).toEqual(["Beispiel AG"]);
  });

  it("drops a peer whose every rate the cited page does not state", () => {
    const peers = [peer({ name: "A" }), peer({ name: "B" })];
    const verdicts = new Map(allSupported(peers));
    verdicts.set(verdictKey(0, "ltifr"), {
      peerIndex: 0,
      kpiKey: "ltifr",
      supported: false,
      periodYear: null,
      confidence: 0.1,
      sourceIndexes: [],
    });
    const resolved = resolvePeers({ ...base, peers, verdicts, regionCountries: ["CH"] });
    expect(resolved.dropped).toEqual([{ name: "A", reason: "unsupported" }]);
    expect(resolved.kept.map((entry) => entry.name)).toEqual(["B"]);
  });

  it("takes the validator's period year over the printed one", () => {
    const peers = [peer({ name: "A" })];
    const verdicts = new Map(allSupported(peers));
    verdicts.set(verdictKey(0, "ltifr"), {
      peerIndex: 0,
      kpiKey: "ltifr",
      supported: true,
      periodYear: 2024,
      confidence: 0.8,
      sourceIndexes: [0],
    });
    const resolved = resolvePeers({ ...base, peers, verdicts, regionCountries: ["CH"] });
    expect(resolved.kept[0]?.rates[0]?.periodYear).toBe(2024);
  });

  it("keeps both rates of a peer that publishes LTIFR and TRIFR", () => {
    const peers = [peer({ name: "A", trifr: { ...RATE, value: 10 } })];
    const resolved = resolvePeers({
      ...base,
      peers,
      verdicts: allSupported(peers),
      regionCountries: ["CH"],
    });
    expect(resolved.kept[0]?.rates.map((rate) => rate.kpiKey)).toEqual(["ltifr", "trifr"]);
  });

  it("answers no rung and thin when nothing was kept", () => {
    const peers = [peer({ name: "Muster AG" })];
    const resolved = resolvePeers({
      ...base,
      peers,
      verdicts: allSupported(peers),
      regionCountries: ["CH"],
    });
    expect(resolved).toMatchObject({ rung: null, thin: true });
    expect(resolved.kept).toHaveLength(0);
  });
});
