// @vitest-environment node
import { describe, expect, it } from "vitest";
import { regionCountriesOf } from "@/lib/countries";
import {
  buildPeerObjective,
  buildPeerOutputSchema,
  isPeerUnit,
  PEER_LIMIT,
  peerSearchResultSchema,
  valuePerMillionHours,
} from "@/lib/research/peer-schema";

/**
 * The peer search contract (spec 0022, AC-6) and the unit conversion done in code (AC-8): per
 * 200 000 hours and per 100 workers both land times five, per million passes through, anything
 * else is unsupported.
 */
const input = {
  companyName: "Muster AG",
  section: "C",
  sectionName: "Manufacturing",
  country: "CH",
  regionCountries: regionCountriesOf("CH"),
  targetPeers: 8,
  minimumPeers: 3,
};

describe("the unit conversion in code (AC-8)", () => {
  it("passes a rate already per million hours through", () => {
    expect(valuePerMillionHours(6.1, "per_million_hours")).toBe(6.1);
    expect(valuePerMillionHours(0, "per_million_hours")).toBe(0);
  });

  it("multiplies a rate per 200 000 hours by five", () => {
    expect(valuePerMillionHours(0.9, "per_200k_hours")).toBe(4.5);
    expect(valuePerMillionHours(1.22, "per_200k_hours")).toBe(6.1);
  });

  it("multiplies a rate per 100 workers by five", () => {
    expect(valuePerMillionHours(1.4, "per_100_workers")).toBe(7);
  });

  it("rounds the product to three decimals rather than leaving float noise", () => {
    expect(valuePerMillionHours(0.123, "per_200k_hours")).toBe(0.615);
  });

  it("answers null for a unit outside the three, so the caller drops the rate", () => {
    expect(valuePerMillionHours(3, "per_1000_fte")).toBeNull();
    expect(valuePerMillionHours(3, "")).toBeNull();
    expect(isPeerUnit("per_1000_fte")).toBe(false);
    expect(isPeerUnit("per_200k_hours")).toBe(true);
  });

  it("answers null for a value that is negative or not finite", () => {
    expect(valuePerMillionHours(-1, "per_million_hours")).toBeNull();
    expect(valuePerMillionHours(Number.NaN, "per_million_hours")).toBeNull();
  });
});

describe("the peer output schema (AC-6)", () => {
  const schema = buildPeerOutputSchema();

  it("asks for one array of at most eight peers, the cap stated in the description", () => {
    const peers = schema.properties.peers as {
      maxItems?: number;
      description: string;
      items: { required: string[] };
    };
    // Parallel answers 422 for `maxItems`, which aborted every peer run before the search began
    // (spec 0022): the cap reaches the provider as prose and is enforced by `parsePeerContent`.
    expect(peers.maxItems).toBeUndefined();
    expect(peers.description).toContain(String(PEER_LIMIT));
    expect(peers.items.required).toEqual([
      "name",
      "website",
      "country",
      "headcount",
      "headcountYear",
      "ltifr",
      "trifr",
    ]);
  });

  it("asks per rate for the value, the unit enum, the year and the source page", () => {
    const peers = schema.properties.peers as {
      items: {
        properties: { ltifr: { properties: { unit: { enum: string[] } }; required: string[] } };
      };
    };
    const ltifr = peers.items.properties.ltifr;
    expect(ltifr.properties.unit.enum).toEqual([
      "per_million_hours",
      "per_200k_hours",
      "per_100_workers",
    ]);
    expect(ltifr.required).toEqual([
      "value",
      "unit",
      "periodYear",
      "sourceUrl",
      "sourceTitle",
      "basis",
    ]);
  });

  it("closes the object so the provider adds no field of its own", () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["peers"]);
  });

  it("carries no keyword Parallel's validator rejects, at any depth", () => {
    // The validator answers 422 on the first unsupported keyword and the task aborts without a
    // retry, so a keyword added anywhere in this schema takes the peer search down silently. The
    // whole tree is walked rather than the two levels the tests above happen to name.
    const unsupported = [
      "maxItems",
      "minItems",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "pattern",
      "format",
      "default",
      "examples",
    ];
    const walk = (node: unknown, path: string): readonly string[] => {
      if (Array.isArray(node)) return node.flatMap((item, i) => walk(item, `${path}[${i}]`));
      if (node === null || typeof node !== "object") return [];
      return Object.entries(node).flatMap(([key, value]) =>
        unsupported.includes(key)
          ? [`${path}.${key}`]
          : // `properties` holds field names, which may legitimately be spelled like a keyword.
            walk(value, key === "properties" ? `${path}.properties` : `${path}.${key}`),
      );
    };
    expect(walk(schema, "schema")).toEqual([]);
  });
});

describe("the peer objective (AC-6, AC-3)", () => {
  const objective = buildPeerObjective(input);

  it("names the section and the ladder in order: the country, then the region, then anywhere", () => {
    expect(objective).toContain("NACE section C, Manufacturing");
    const home = objective.indexOf("Switzerland");
    const region = objective.indexOf("Germany");
    const anywhere = objective.indexOf("companies anywhere");
    expect(home).toBeGreaterThan(-1);
    expect(home).toBeLessThan(region);
    expect(region).toBeLessThan(anywhere);
  });

  it("prefers employees only figures and forbids the provider converting a value", () => {
    expect(objective).toContain("own employees only");
    expect(objective).toContain("never convert a value yourself");
  });

  it("excludes the client company itself", () => {
    expect(objective).toContain("Do not include Muster AG itself");
  });

  it("names no country other than the client's own and its region", () => {
    const outside = buildPeerObjective({ ...input, country: "BR", regionCountries: ["BR", "AR"] });
    expect(outside).toContain("Brazil");
    expect(outside).not.toContain("Switzerland");
    expect(outside).not.toContain("Zefix");
  });
});

describe("the peer result parser", () => {
  it("rejects a peer whose country is not an alpha 2 code", () => {
    const parsed = peerSearchResultSchema.safeParse({
      peers: [
        {
          name: "Peer",
          website: null,
          country: "Switzerland",
          headcount: null,
          headcountYear: null,
          ltifr: null,
          trifr: null,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than eight peers", () => {
    const peer = {
      name: "Peer",
      website: null,
      country: "CH",
      headcount: null,
      headcountYear: null,
      ltifr: null,
      trifr: null,
    };
    expect(peerSearchResultSchema.safeParse({ peers: Array(9).fill(peer) }).success).toBe(false);
    expect(peerSearchResultSchema.safeParse({ peers: Array(8).fill(peer) }).success).toBe(true);
  });
});
