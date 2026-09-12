// @vitest-environment node
import { describe, expect, it } from "vitest";
import { csvCell, csvLine, EXPORT_COLUMNS, exportFileName } from "@/features/directory/export";

describe("the unlocks CSV rules (spec 0018, AC-13)", () => {
  it("quotes a cell holding a quote, a comma or a line break and doubles the quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("Alpha, Werke")).toBe('"Alpha, Werke"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("guards a cell that starts with a formula character", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+41 41 123 45 67")).toBe("'+41 41 123 45 67");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("a=b")).toBe("a=b");
  });

  it("ends a line with CRLF", () => {
    expect(csvLine(["a", "b,c"])).toBe('a,"b,c"\r\n');
  });

  it("names the file by the Zurich date", () => {
    // 23:30 UTC on 12 September is already 13 September in Zurich.
    expect(exportFileName(new Date("2026-09-12T23:30:00Z"))).toBe(
      "sme24-directory-unlocks-2026-09-13.csv",
    );
  });

  it("orders the ten columns as the spec lists them", () => {
    expect(EXPORT_COLUMNS).toEqual([
      "company",
      "country",
      "city",
      "firstName",
      "lastName",
      "title",
      "email",
      "phone",
      "mobile",
      "unlockedAt",
    ]);
  });
});
