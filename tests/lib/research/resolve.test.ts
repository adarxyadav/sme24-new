import { describe, expect, it } from "vitest";
import type { Candidate } from "@/lib/research/candidates";
import {
  collectSources,
  extractCandidates,
  parseReportingYears,
  parseYear,
} from "@/lib/research/candidates";
import { fixtureEmptyResult, fixtureResult, fixtureYears } from "@/lib/research/fixture";
import { buildOutputSchema } from "@/lib/research/output-schema";
import { resolveValues, SKIPPED_CONFIDENCE_CAP, type Verdict } from "@/lib/research/resolve";

const RETRIEVED = "2026-09-06T10:00:00.000Z";

function candidate(overrides: Partial<Candidate> & { field: string }): Candidate {
  return {
    key: "ltifr",
    slot: "latest",
    raw: "2.4, 2025",
    year: 2025,
    value: 2.4,
    basisConfidence: "high",
    sources: [
      {
        url: "https://other.example/report",
        title: "Report",
        excerpt: "LTIFR 2.4",
        retrievedAt: RETRIEVED,
      },
    ],
    ...overrides,
  };
}

describe("candidates from a provider result (AC-5, AC-6)", () => {
  it("builds the flat output schema from the catalogue: reporting years, 24 KPI fields, 7 facts", () => {
    const schema = buildOutputSchema();
    expect(schema.required).toHaveLength(1 + 8 * 3 + 7);
    expect(schema.properties.ltifr_latest?.description).toContain("Lost time injury");
    expect(schema.additionalProperties).toBe(false);
  });

  it("parses years from a field and from reporting_years", () => {
    expect(parseYear("2.4 per 1 000 000 hours, 2024")).toBe(2024);
    expect(parseYear("no year here")).toBeNull();
    expect(parseReportingYears("2024, 2023, 2022")).toEqual([2024, 2023, 2022]);
    expect(parseReportingYears("not found")).toEqual([]);
  });

  it("turns the fixture result into 24 candidates with values, years and sources", () => {
    const years = fixtureYears(new Date("2026-06-01T00:00:00Z"));
    const candidates = extractCandidates(fixtureResult(years), RETRIEVED);
    expect(candidates).toHaveLength(24);
    const first = candidates[0];
    expect(first).toMatchObject({
      key: "ltifr",
      slot: "latest",
      year: 2025,
      value: 2.4,
      basisConfidence: "high",
    });
    expect(first?.sources[0]).toMatchObject({ retrievedAt: RETRIEVED });
    expect(collectSources(fixtureResult(years), RETRIEVED)).toHaveLength(5);
    expect(extractCandidates(fixtureEmptyResult(), RETRIEVED)).toEqual([]);
  });
});

describe("the resolve rules (AC-5)", () => {
  const currentYear = 2026;

  it("drops unsupported, out of range, bad year and unparseable values and records each reason", () => {
    const candidates = [
      candidate({ field: "ltifr_latest" }),
      candidate({ field: "ltifr_previous", slot: "previous", year: 2024, value: 500 }),
      candidate({ field: "ltifr_two_years_prior", slot: "two_years_prior", year: 1999, value: 1 }),
      candidate({ field: "trifr_latest", key: "trifr", value: null }),
      candidate({ field: "fatalities_latest", key: "fatalities", value: 0 }),
    ];
    const verdicts = new Map<string, Verdict>([
      ["ltifr_latest", { supported: false, value: 2.4, periodYear: 2025, confidence: 0.9 }],
      ["ltifr_previous", { supported: true, value: 500, periodYear: 2024, confidence: 0.8 }],
      ["ltifr_two_years_prior", { supported: true, value: 1, periodYear: 1999, confidence: 0.8 }],
      ["trifr_latest", { supported: true, value: null, periodYear: 2025, confidence: 0.5 }],
      ["fatalities_latest", { supported: true, value: 0, periodYear: 2025, confidence: 0.95 }],
    ]);
    const { kept, dropped } = resolveValues({
      candidates,
      verdicts,
      companyHost: null,
      currentYear,
    });
    expect(kept).toEqual([
      expect.objectContaining({ key: "fatalities", periodYear: 2025, value: 0, confidence: 0.95 }),
    ]);
    expect(dropped.map((entry) => entry.reason)).toEqual([
      "unsupported",
      "out_of_range",
      "bad_year",
      "unparseable",
    ]);
  });

  it("resolves a conflict for the company's own site first, then the higher confidence, and keeps the loser's source", () => {
    const own = candidate({
      field: "ltifr_latest",
      value: 2.4,
      sources: [
        {
          url: "https://www.muster.ch/report",
          title: "Own",
          excerpt: "2.4",
          retrievedAt: RETRIEVED,
        },
      ],
    });
    const other = candidate({ field: "ltifr_previous", slot: "previous", year: 2025, value: 3.1 });
    const verdicts = new Map<string, Verdict>([
      ["ltifr_latest", { supported: true, value: 2.4, periodYear: 2025, confidence: 0.6 }],
      ["ltifr_previous", { supported: true, value: 3.1, periodYear: 2025, confidence: 0.9 }],
    ]);
    const { kept, dropped } = resolveValues({
      candidates: [other, own],
      verdicts,
      companyHost: "www.muster.ch",
      currentYear,
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ value: 2.4, confidence: 0.6 });
    expect(kept[0]?.sources.map((source) => source.url)).toEqual([
      "https://www.muster.ch/report",
      "https://other.example/report",
    ]);
    expect(dropped).toEqual([{ key: "ltifr", year: 2025, value: 3.1, reason: "conflict" }]);

    const byConfidence = resolveValues({
      candidates: [other, own],
      verdicts,
      companyHost: null,
      currentYear,
    });
    expect(byConfidence.kept[0]).toMatchObject({ value: 3.1, confidence: 0.9 });
  });

  it("stores only the citations the validator's sourceIndexes point at", () => {
    const three = [0, 1, 2].map((index) => ({
      url: `https://source.example/${index}`,
      title: `Source ${index}`,
      excerpt: `LTIFR 2.4 (${index})`,
      retrievedAt: RETRIEVED,
    }));
    const candidates = [
      candidate({ field: "ltifr_latest", sources: three }),
      candidate({ field: "trifr_latest", key: "trifr", value: 6.1, sources: three }),
      candidate({ field: "fatalities_latest", key: "fatalities", value: 0, sources: three }),
    ];
    const verdicts = new Map<string, Verdict>([
      [
        "ltifr_latest",
        { supported: true, value: 2.4, periodYear: 2025, confidence: 0.9, sourceIndexes: [1] },
      ],
      [
        "trifr_latest",
        { supported: true, value: 6.1, periodYear: 2025, confidence: 0.8, sourceIndexes: [] },
      ],
      [
        "fatalities_latest",
        { supported: true, value: 0, periodYear: 2025, confidence: 0.9, sourceIndexes: [7] },
      ],
    ]);
    const { kept } = resolveValues({ candidates, verdicts, companyHost: null, currentYear });
    expect(kept[0]?.sources.map((source) => source.url)).toEqual(["https://source.example/1"]);
    expect(kept[1]?.sources).toHaveLength(3);
    expect(kept[2]?.sources).toHaveLength(3);
  });

  it("falls back to the parsed values with capped confidence when validation was skipped", () => {
    const candidates = [
      candidate({ field: "ltifr_latest", basisConfidence: "high" }),
      candidate({ field: "trifr_latest", key: "trifr", value: 6.1, basisConfidence: "low" }),
      candidate({
        field: "fatalities_latest",
        key: "fatalities",
        value: null,
        basisConfidence: null,
      }),
    ];
    const { kept, dropped } = resolveValues({
      candidates,
      verdicts: null,
      companyHost: null,
      currentYear,
    });
    expect(kept.map((value) => value.confidence)).toEqual([SKIPPED_CONFIDENCE_CAP, 0.3]);
    expect(dropped).toEqual([
      { key: "fatalities", year: 2025, value: null, reason: "unparseable" },
    ]);
  });
});
