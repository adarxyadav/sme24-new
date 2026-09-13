// @vitest-environment node
import { describe, expect, it } from "vitest";
import { regionCountriesOf, regionOf } from "@/lib/countries";
import {
  createFixtureProvider,
  fixturePeerCountry,
  fixturePeers,
  fixtureWantsThinPeers,
} from "@/lib/research/fixture";
import {
  buildPeerOutputSchema,
  type PeerSearchInput,
  peerSearchResultSchema,
  valuePerMillionHours,
} from "@/lib/research/peer-schema";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/research/provider";

/**
 * The fixture peer run (spec 0022, AC-11): eight peers, five in the client's country, two in its
 * region and one elsewhere, so a fixture run lands on the country rung; `thinpeers` gives two
 * world peers; `empty` gives none and `fail` throws as it does for the client run.
 */
const input: PeerSearchInput = {
  companyName: "Muster AG",
  section: "C",
  sectionName: "Manufacturing",
  country: "CH",
  regionCountries: regionCountriesOf("CH"),
  targetPeers: 8,
  minimumPeers: 3,
};
const now = new Date("2026-06-01T00:00:00Z");
const schema = buildPeerOutputSchema();
const provider = createFixtureProvider(async () => {});

describe("the fixture peers (AC-11)", () => {
  const peers = fixturePeers(input, now);

  it("gives eight peers, five of the client's country, two of its region and one outside", () => {
    expect(peers).toHaveLength(8);
    const home = peers.filter((peer) => peer.country === "CH");
    expect(home).toHaveLength(5);
    const region = regionCountriesOf("CH");
    const inRegion = peers.filter((peer) => peer.country !== "CH" && region.includes(peer.country));
    expect(inRegion).toHaveLength(2);
    const outside = peers.filter((peer) => !region.includes(peer.country));
    expect(outside).toHaveLength(1);
    expect(regionOf(outside[0]?.country ?? "")).not.toBe(regionOf("CH"));
  });

  it("gives at least three country peers a usable LTIFR, so the run lands on the country rung", () => {
    const usable = peers.filter(
      (peer) =>
        peer.country === "CH" &&
        peer.ltifr !== null &&
        valuePerMillionHours(peer.ltifr.value, peer.ltifr.unit) !== null,
    );
    expect(usable.length).toBeGreaterThanOrEqual(3);
  });

  it("prints three different units, so every fixture run exercises the code conversion (AC-8)", () => {
    const units = new Set(peers.flatMap((peer) => (peer.ltifr ? [peer.ltifr.unit] : [])));
    expect(units).toEqual(new Set(["per_million_hours", "per_200k_hours", "per_100_workers"]));
    const perTwoHundred = peers.find((peer) => peer.ltifr?.unit === "per_200k_hours");
    expect(valuePerMillionHours(perTwoHundred?.ltifr?.value ?? 0, "per_200k_hours")).toBe(4.5);
  });

  it("leaves one peer without a TRIFR, so the rates block is built from unequal counts", () => {
    expect(peers.filter((peer) => peer.trifr === null)).toHaveLength(1);
    expect(peers.every((peer) => peer.ltifr !== null)).toBe(true);
  });

  it("reports the year the client fixture reports, with a source and a headcount per peer", () => {
    for (const peer of peers) {
      expect(peer.ltifr?.periodYear).toBe(2025);
      expect(peer.ltifr?.sourceUrl).toMatch(/^https:\/\/www\.example\.com\//);
      expect(peer.headcount).toBeGreaterThan(0);
      expect(peer.headcountYear).toBe(2025);
    }
  });

  it("matches the peer result schema the provider answers through", () => {
    expect(peerSearchResultSchema.safeParse({ peers: [...peers] }).success).toBe(true);
  });

  it("gives two peers outside the region for a name containing thinpeers", () => {
    expect(fixtureWantsThinPeers("Thinpeers AG")).toBe(true);
    const thin = fixturePeers({ ...input, companyName: "Thinpeers AG" }, now);
    expect(thin).toHaveLength(2);
    const region = regionCountriesOf("CH");
    expect(thin.every((peer) => !region.includes(peer.country))).toBe(true);
  });

  it("picks the peer countries from the client's own country and region", () => {
    expect(fixturePeerCountry("DE", "country", 0)).toBe("DE");
    expect(regionCountriesOf("DE")).toContain(fixturePeerCountry("DE", "region", 0));
    expect(fixturePeerCountry("DE", "region", 0)).not.toBe("DE");
    expect(regionOf(fixturePeerCountry("DE", "world", 0))).not.toBe(regionOf("DE"));
  });
});

describe("the fixture peer run", () => {
  it("answers the eight peers through createPeerRun and getPeerResult", async () => {
    const { providerRunId } = await provider.createPeerRun(input, schema);
    expect(await provider.getRun(providerRunId)).toEqual({ status: "done" });
    const result = await provider.getPeerResult(providerRunId);
    expect(result.peers).toHaveLength(8);
    expect(result.peers[0]?.country).toBe("CH");
  });

  it("carries the input through the run id, so a retry resumes the same answer", async () => {
    const first = await provider.createPeerRun({ ...input, country: "DE" }, schema);
    const second = await provider.createPeerRun({ ...input, country: "DE" }, schema);
    expect(second.providerRunId).toBe(first.providerRunId);
    const result = await provider.getPeerResult(first.providerRunId);
    expect(result.peers.filter((peer) => peer.country === "DE")).toHaveLength(5);
  });

  it("gives no peers for a name containing empty", async () => {
    const { providerRunId } = await provider.createPeerRun(
      { ...input, companyName: "Empty AG" },
      schema,
    );
    expect(await provider.getPeerResult(providerRunId)).toEqual({ peers: [] });
  });

  it("throws a retryable failure for a name containing fail", async () => {
    await expect(
      provider.createPeerRun({ ...input, companyName: "Fail AG" }, schema),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("refuses a run id that is not a fixture peer run", async () => {
    await expect(provider.getPeerResult("fixture_something")).rejects.toBeInstanceOf(
      ProviderRejectedError,
    );
  });
});
