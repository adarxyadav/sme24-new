import { describe, expect, it } from "vitest";
import { KPI_LIST } from "@/features/research/catalogue";
import {
  PROMPT_VERSION,
  researchValidationPrompt,
  researchValidationSystemPrompt,
} from "@/lib/ai/prompts/research-validation";
import {
  acceptedFacts,
  researchValidationSchema,
  validatedValueSchema,
} from "@/lib/ai/schemas/research-validation";
import type { Candidate } from "@/lib/research/candidates";

/**
 * What Claude is told and what it may answer (spec 0007, AC-5): the schema caps the values at 24
 * and types each one, the facts filter keeps only what passes the company facts rules, the system
 * prompt carries the whole catalogue with ranges and units, and the user prompt lists every
 * candidate with its numbered citations. Pure.
 */
const value = {
  field: "ltifr_latest",
  key: "ltifr",
  periodYear: 2025,
  value: 2.4,
  sourceUnit: "per 200 000 hours",
  confidence: 0.9,
  supported: true,
  sourceIndexes: [0, 1],
};

const facts = {
  legalName: null,
  uid: null,
  industryCode: null,
  employeesCount: null,
  canton: null,
};

describe("researchValidationSchema (AC-5)", () => {
  it("accepts a checked value with a null year or value and an optional reason", () => {
    expect(validatedValueSchema.safeParse(value).success).toBe(true);
    expect(
      validatedValueSchema.safeParse({ ...value, periodYear: null, value: null, reason: "none" })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown KPI key, a confidence outside 0 to 1 and a negative citation index", () => {
    expect(validatedValueSchema.safeParse({ ...value, key: "revenue" }).success).toBe(false);
    expect(validatedValueSchema.safeParse({ ...value, confidence: 1.5 }).success).toBe(false);
    expect(validatedValueSchema.safeParse({ ...value, sourceIndexes: [-1] }).success).toBe(false);
  });

  it("caps the values at 24 and requires the five facts, null allowed", () => {
    const values = (count: number) => Array.from({ length: count }, () => value);
    expect(
      researchValidationSchema.safeParse({ values: values(24), companyFacts: facts }).success,
    ).toBe(true);
    expect(
      researchValidationSchema.safeParse({ values: values(25), companyFacts: facts }).success,
    ).toBe(false);
    expect(researchValidationSchema.safeParse({ values: [], companyFacts: {} }).success).toBe(
      false,
    );
  });
});

describe("acceptedFacts (AC-6)", () => {
  it("keeps every fact that passes its rule and drops nulls and blanks", () => {
    expect(
      acceptedFacts({
        legalName: "Muster Holding AG",
        uid: "CHE-123.456.789",
        industryCode: "23",
        employeesCount: 0,
        canton: "ZH",
      }),
    ).toEqual({
      legalName: "Muster Holding AG",
      uid: "CHE-123.456.789",
      industryCode: "23",
      employeesCount: 0,
      canton: "ZH",
    });
    expect(acceptedFacts({ ...facts, legalName: "" })).toEqual({});
  });

  it("drops each failing fact on its own: a malformed UID, a bad NOGA code, a negative headcount, a wrong canton, an overlong name", () => {
    expect(
      acceptedFacts({
        legalName: "x".repeat(201),
        uid: "CHE123456789",
        industryCode: "23.6",
        employeesCount: -5,
        canton: "Zürich",
      }),
    ).toEqual({});
    expect(acceptedFacts({ ...facts, uid: "CHE-123.456.789", canton: "zh" })).toEqual({
      uid: "CHE-123.456.789",
    });
  });
});

describe("the prompts (AC-5, AC-13)", () => {
  it("pins the prompt version that lands in the summary", () => {
    expect(PROMPT_VERSION).toBe("research-validation@1");
  });

  it("puts every catalogue key with its unit, range and hint into the system prompt, plus the rules", () => {
    const system = researchValidationSystemPrompt();
    for (const kpi of KPI_LIST) {
      expect(system).toContain(
        `- ${kpi.key}: unit "${kpi.unit}", plausible range ${kpi.range[0]} to ${kpi.range[1]}`,
      );
      expect(system).toContain(kpi.hint);
    }
    expect(system).toContain("Never invent a value.");
    expect(system).toContain("multiplying by 5");
  });

  it("lists the company, the found facts and each candidate with numbered citations, flattening line breaks", () => {
    const candidate: Candidate = {
      key: "ltifr",
      slot: "latest",
      field: "ltifr_latest",
      raw: "2.4 per\nmillion hours, 2025",
      year: 2025,
      value: 2.4,
      basisConfidence: "high",
      sources: [
        {
          url: "https://muster.ch/report",
          title: "Report 2025",
          excerpt: "LTIFR\n2.4",
          retrievedAt: "2026-09-06T10:00:00.000Z",
        },
        {
          url: "https://other.example",
          title: "",
          excerpt: "",
          retrievedAt: "2026-09-06T10:00:00.000Z",
        },
      ],
    };
    const prompt = researchValidationPrompt(
      { name: "Muster AG", legalName: null, website: "https://muster.ch", country: "CH" },
      [candidate],
      { legal_name: "Muster Holding AG", canton: "ZH" },
    );
    expect(prompt).toContain(
      "Company: Muster AG\nLegal name: unknown\nWebsite: https://muster.ch\nCountry: CH",
    );
    expect(prompt).toContain("- legal_name: Muster Holding AG\n- canton: ZH");
    expect(prompt).toContain("Candidates (1):");
    expect(prompt).toContain("Field ltifr_latest (kpi ltifr, slot latest):");
    expect(prompt).toContain('text: "2.4 per million hours, 2025"');
    expect(prompt).toContain("service confidence: high");
    expect(prompt).toContain('[0] Report 2025 <https://muster.ch/report>\n      "LTIFR 2.4"');
    expect(prompt).toContain("[1]  <https://other.example>");
  });

  it("says when there are no facts and no citations", () => {
    const bare: Candidate = {
      key: "trifr",
      slot: "previous",
      field: "trifr_previous",
      raw: "6.1",
      year: null,
      value: 6.1,
      basisConfidence: null,
      sources: [],
    };
    const prompt = researchValidationPrompt(
      { name: "Muster AG", legalName: null, website: null, country: "CH" },
      [bare],
      {},
    );
    expect(prompt).toContain("Company facts the research service found:\n- none");
    expect(prompt).toContain("service confidence: none");
    expect(prompt).toContain("citations: none");
  });
});
