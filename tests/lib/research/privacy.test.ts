import { describe, expect, it } from "vitest";
import {
  researchValidationPrompt,
  researchValidationSystemPrompt,
} from "@/lib/ai/prompts/research-validation";
import { extractCandidates } from "@/lib/research/candidates";
import { fixtureResult, fixtureYears } from "@/lib/research/fixture";
import { buildParallelInput } from "@/lib/research/parallel";

/**
 * What leaves the platform (spec 0007, AC-13): the provider input and the Claude prompt carry the
 * company name, legal name, website, country, the catalogue and the instructions, never the
 * requester's profile or an internal id.
 */
const runRow = {
  id: "0d000000-0000-4000-8000-000000000001",
  organization_id: "0a000000-0000-4000-8000-000000000000",
  company_id: "0c000000-0000-4000-8000-00000000000a",
  requested_by: "a0000000-0000-4000-8000-000000000002",
  trigger_run_id: "run_secret123",
  requester: { full_name: "Anna Beispiel", email: "anna.beispiel@muster.ch" },
  company: {
    name: "Muster AG",
    legal_name: "Muster Holding AG",
    website: "https://muster.ch",
    country: "CH",
  },
};

const SECRETS = [
  runRow.id,
  runRow.organization_id,
  runRow.company_id,
  runRow.requested_by,
  runRow.trigger_run_id,
  runRow.requester.full_name,
  runRow.requester.email,
];

function companyOnly() {
  return {
    name: runRow.company.name,
    legalName: runRow.company.legal_name,
    website: runRow.company.website,
    country: runRow.company.country,
  };
}

describe("data leaving the platform (AC-13)", () => {
  it("the provider input carries public company data only", () => {
    const input = JSON.stringify(buildParallelInput(companyOnly()));
    expect(input).toContain("Muster AG");
    expect(input).toContain("https://muster.ch");
    for (const secret of SECRETS) expect(input).not.toContain(secret);
  });

  it("the validation prompts carry the company, the catalogue and the candidates only", () => {
    const candidates = extractCandidates(fixtureResult(fixtureYears()), "2026-09-06T00:00:00.000Z");
    const prompt = researchValidationPrompt(companyOnly(), candidates, {
      legal_name: "Muster Holding AG",
    });
    const system = researchValidationSystemPrompt();
    expect(prompt).toContain("Company: Muster AG");
    expect(system).toContain("ltifr");
    for (const secret of SECRETS) {
      expect(prompt).not.toContain(secret);
      expect(system).not.toContain(secret);
    }
  });
});
