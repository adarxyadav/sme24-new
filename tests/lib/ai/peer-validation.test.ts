// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PEER_PROMPT_VERSION,
  peerValidationPrompt,
  peerValidationSystemPrompt,
} from "@/lib/ai/prompts/peer-validation";
import { peerValidationSchema } from "@/lib/ai/schemas/peer-validation";
import type { PeerCompany } from "@/lib/research/peer-schema";

/**
 * The peer validation prompt (spec 0022, AC-8): it asks whether the cited page carries the rate,
 * never for a converted value, since the conversion is code's job. Nothing names one country.
 */
const company = {
  name: "Muster AG",
  country: "CH",
  section: "C",
  sectionName: "Manufacturing",
};

const peers: readonly PeerCompany[] = [
  {
    name: "Peer One AG",
    website: "https://www.example.com/one",
    country: "CH",
    headcount: 500,
    headcountYear: 2025,
    ltifr: {
      value: 0.9,
      unit: "per_200k_hours",
      periodYear: 2025,
      sourceUrl: "https://www.example.com/one/report",
      sourceTitle: "Sustainability report",
      basis: "employees",
    },
    trifr: null,
  },
  {
    name: "Peer Two AG",
    website: null,
    country: "DE",
    headcount: null,
    headcountYear: null,
    ltifr: null,
    trifr: null,
  },
];

describe("the peer validation prompt (AC-8)", () => {
  it("is versioned peer-validation@1", () => {
    expect(PEER_PROMPT_VERSION).toBe("peer-validation@1");
  });

  it("forbids converting a value and asks only for support, the year and a confidence", () => {
    const system = peerValidationSystemPrompt();
    expect(system).toContain("Never convert a value and never return one");
    expect(system).toContain("supported is true only when");
    expect(system).toContain("periodYear");
    expect(system).toContain("confidence");
    expect(system).toContain("sourceIndexes");
  });

  it("names no country and no Swiss institution", () => {
    const system = peerValidationSystemPrompt();
    expect(system).not.toMatch(/Switzerland|Swiss|Suva|Zefix|CHE-/i);
  });

  it("lists every peer with its printed rate, unit, year and source", () => {
    const prompt = peerValidationPrompt(company, peers);
    expect(prompt).toContain("Client company: Muster AG");
    expect(prompt).toContain("Industry section: C (Manufacturing)");
    expect(prompt).toContain("Peer 0 — Peer One AG (CH), headcount 500 in 2025");
    expect(prompt).toContain("ltifr: 0.9 (unit as printed: per_200k_hours), year 2025");
    expect(prompt).toContain("[0] Sustainability report <https://www.example.com/one/report>");
  });

  it("says so plainly when a peer carries no rate", () => {
    const prompt = peerValidationPrompt(company, peers);
    expect(prompt).toContain("Peer 1 — Peer Two AG (DE), headcount unknown");
    expect(prompt).toContain("no rates given");
  });
});

describe("the peer validation schema (AC-8)", () => {
  const verdict = {
    peerIndex: 0,
    kpiKey: "ltifr",
    supported: true,
    periodYear: 2025,
    confidence: 0.8,
    sourceIndexes: [0],
  };

  it("accepts one verdict per peer and rate, at most sixteen", () => {
    expect(peerValidationSchema.safeParse({ verdicts: [verdict] }).success).toBe(true);
    expect(peerValidationSchema.safeParse({ verdicts: Array(16).fill(verdict) }).success).toBe(
      true,
    );
    expect(peerValidationSchema.safeParse({ verdicts: Array(17).fill(verdict) }).success).toBe(
      false,
    );
  });

  it("takes no value: the conversion is done in code", () => {
    const parsed = peerValidationSchema.parse({ verdicts: [{ ...verdict, value: 4.5 }] });
    expect(parsed.verdicts[0]).not.toHaveProperty("value");
  });

  it("refuses a rate outside the two and a peer index outside the eight", () => {
    expect(
      peerValidationSchema.safeParse({ verdicts: [{ ...verdict, kpiKey: "fatalities" }] }).success,
    ).toBe(false);
    expect(
      peerValidationSchema.safeParse({ verdicts: [{ ...verdict, peerIndex: 8 }] }).success,
    ).toBe(false);
  });
});
