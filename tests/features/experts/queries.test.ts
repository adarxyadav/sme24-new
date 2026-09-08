// @vitest-environment node
import { describe, expect, it } from "vitest";
import { INDUSTRY_CODES } from "@/features/experts/catalogue";
import { industrySection } from "@/features/experts/queries";

/**
 * The NOGA section a company's industry code belongs to (spec 0013). `companies.industry_code` is
 * a full NOGA code but the expert catalogue keys its industry labels by the section letter, so
 * this is the join feature 19 will match on. A wrong answer here is a blank badge on the client's
 * expert card, or a match on the wrong sector. Pure.
 */

describe("the NOGA section of an industry code", () => {
  it("takes the section letter off a full code", () => {
    expect(industrySection("C2511")).toBe("C");
    expect(industrySection("F4211")).toBe("F");
  });

  it("accepts a bare section letter", () => {
    expect(industrySection("C")).toBe("C");
  });

  it("uppercases and trims what the column holds", () => {
    expect(industrySection("c2511")).toBe("C");
    expect(industrySection("  c2511  ")).toBe("C");
  });

  it("answers null rather than a letter the catalogue does not know", () => {
    // The catalogue stops at U; a code starting past it has no label key and would render blank.
    expect(industrySection("Z1234")).toBeNull();
    expect(industrySection("1234")).toBeNull();
  });

  it("answers null for an absent or empty code", () => {
    expect(industrySection(null)).toBeNull();
    expect(industrySection("")).toBeNull();
    expect(industrySection("   ")).toBeNull();
  });

  it("answers every catalogue section for its own letter", () => {
    for (const code of INDUSTRY_CODES) {
      expect(industrySection(code)).toBe(code);
      expect(industrySection(`${code}1234`)).toBe(code);
    }
  });
});
