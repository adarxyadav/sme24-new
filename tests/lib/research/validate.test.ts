// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION } from "@/lib/ai/prompts/research-validation";
import type { ResearchValidation } from "@/lib/ai/schemas/research-validation";
import { extractCandidates, extractFactFields } from "@/lib/research/candidates";
import { fixtureResult, fixtureYears } from "@/lib/research/fixture";
import { validateResearch } from "@/lib/research/validate";

/**
 * The validation pass (spec 0007, AC-5): no gateway key skips it, nothing to check answers an
 * empty outcome without a call, a good answer becomes verdicts keyed by field plus the facts that
 * pass the facts schema, and a failed call answers null after reporting through `onError` so the
 * task falls back to the provider's values. The gateway call is the boundary.
 */
const gateway = vi.hoisted(() => ({
  structuredOutput: vi.fn<(input: unknown) => Promise<ResearchValidation>>(),
}));

vi.mock("@/lib/ai/gateway", () => ({ structuredOutput: gateway.structuredOutput }));

const company = { name: "Muster AG", legalName: null, website: "https://muster.ch", country: "CH" };
const result = fixtureResult(fixtureYears(new Date("2026-06-01T00:00:00Z")));
const candidates = extractCandidates(result, "2026-09-06T10:00:00.000Z");
const facts = extractFactFields(result);

const answer: ResearchValidation = {
  values: [
    {
      field: "ltifr_latest",
      key: "ltifr",
      periodYear: 2025,
      value: 2.4,
      sourceUnit: "per 1 000 000 hours",
      confidence: 0.85,
      supported: true,
      sourceIndexes: [0],
    },
    {
      field: "trifr_latest",
      key: "trifr",
      periodYear: null,
      value: null,
      sourceUnit: "",
      confidence: 0.2,
      supported: false,
      reason: "the excerpt names no figure",
      sourceIndexes: [],
    },
  ],
  companyFacts: {
    legalName: "Example Fixture AG",
    uid: "CHE-123.456.789",
    industryCode: "23.61",
    employeesCount: 420,
    canton: "ZH",
  },
};

beforeEach(() => {
  gateway.structuredOutput.mockResolvedValue(answer);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("validateResearch (AC-5)", () => {
  it("skips the pass without a gateway key and without calling or reporting anything", async () => {
    const onError = vi.fn();
    await expect(
      validateResearch({ company, candidates, facts, apiKey: undefined, onError }),
    ).resolves.toBeNull();
    expect(gateway.structuredOutput).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("answers an empty outcome with the prompt version when there is nothing to check", async () => {
    await expect(
      validateResearch({ company, candidates: [], facts: {}, apiKey: "key", onError: vi.fn() }),
    ).resolves.toEqual({ verdicts: new Map(), facts: {}, promptVersion: PROMPT_VERSION });
    expect(gateway.structuredOutput).not.toHaveBeenCalled();
  });

  it("sends the schema, the system prompt and the candidates prompt in one call", async () => {
    await validateResearch({ company, candidates, facts, apiKey: "key", onError: vi.fn() });
    expect(gateway.structuredOutput).toHaveBeenCalledTimes(1);
    const call = gateway.structuredOutput.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.apiKey).toBe("key");
    expect(call.schema).toBeDefined();
    expect(call.system).toContain("Catalogue:");
    expect(call.prompt).toContain("Company: Muster AG");
    expect(call.prompt).toContain(`Candidates (${candidates.length}):`);
    expect(call.prompt).toContain("Field ltifr_latest");
  });

  it("turns the answer into verdicts keyed by field and keeps the facts that pass the schema", async () => {
    const outcome = await validateResearch({
      company,
      candidates,
      facts,
      apiKey: "key",
      onError: vi.fn(),
    });
    expect(outcome?.promptVersion).toBe(PROMPT_VERSION);
    expect(outcome?.verdicts.get("ltifr_latest")).toEqual({
      supported: true,
      value: 2.4,
      periodYear: 2025,
      confidence: 0.85,
      reason: undefined,
      sourceIndexes: [0],
    });
    expect(outcome?.verdicts.get("trifr_latest")).toMatchObject({
      supported: false,
      value: null,
      reason: "the excerpt names no figure",
    });
    expect(outcome?.verdicts.size).toBe(2);
    expect(outcome?.facts).toEqual({
      legalName: "Example Fixture AG",
      uid: "CHE-123.456.789",
      industryCode: "23.61",
      employeesCount: 420,
      canton: "ZH",
    });
  });

  it("drops the facts that fail their rule one by one, keeping the rest", async () => {
    gateway.structuredOutput.mockResolvedValue({
      values: [],
      companyFacts: {
        legalName: null,
        uid: "123.456.789",
        industryCode: "23.61",
        employeesCount: -1,
        canton: "XX",
      },
    });
    const outcome = await validateResearch({
      company,
      candidates,
      facts,
      apiKey: "key",
      onError: vi.fn(),
    });
    expect(outcome?.facts).toEqual({ industryCode: "23.61" });
  });

  it("answers null and reports the error when the call fails after the SDK's retries", async () => {
    const failure = new Error("gateway 502");
    gateway.structuredOutput.mockRejectedValue(failure);
    const onError = vi.fn();
    await expect(
      validateResearch({ company, candidates, facts, apiKey: "key", onError }),
    ).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
