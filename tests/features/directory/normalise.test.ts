// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cleanCell,
  emailHash,
  normaliseCompanyName,
  normaliseEmail,
} from "@/features/directory/normalise";

describe("the directory text rules (spec 0018, Value sourcing)", () => {
  it("cleans a cell: trims, collapses whitespace, empty becomes null", () => {
    expect(cleanCell("  Alpha   Werke\tAG ")).toBe("Alpha Werke AG");
    expect(cleanCell("   ")).toBeNull();
    expect(cleanCell(null)).toBeNull();
    expect(cleanCell(undefined)).toBeNull();
  });

  it("normalises a company name to lower case with inner whitespace collapsed", () => {
    expect(normaliseCompanyName("  Alpha   Werke AG ")).toBe("alpha werke ag");
    expect(normaliseCompanyName("ALPHA WERKE AG")).toBe("alpha werke ag");
  });

  it("normalises an email to lower case, trimmed", () => {
    expect(normaliseEmail(" Anna.Muster@Alpha.TEST ")).toBe("anna.muster@alpha.test");
  });

  it("hashes an address exactly as directory_remove_contact does in SQL", () => {
    // encode(sha256(convert_to(lower('gone@alpha.test'), 'UTF8')), 'hex'); the same literal is
    // pinned in supabase/tests/directory_contacts.test.sql, so the two implementations stay equal.
    expect(emailHash("Gone@Alpha.test")).toBe(
      "24241b3daadcbe071c5aa67e79a627ac4a806eeb297d63c745b4707169b234de",
    );
  });
});
