// @vitest-environment node
import { describe, expect, it } from "vitest";
import { textBlocks } from "@/features/assessments/text";

/**
 * The content text renderer (spec 0019, AC-11): the export's line breaks and bullet markers
 * become paragraphs and lists, never one run on paragraph.
 */

describe("textBlocks", () => {
  it("renders bullet and sub bullet lines as a nested list", () => {
    expect(
      textBlocks(
        "Planen von:\n\n• Massnahmen, um:\n\no  diese Risiken zu behandeln;\n\no  Notfälle vorzubereiten;\n\n• wie:\n\no  integriert werden.",
      ),
    ).toEqual([
      { kind: "paragraph", text: "Planen von:" },
      {
        kind: "list",
        items: [
          {
            text: "Massnahmen, um:",
            children: ["diese Risiken zu behandeln;", "Notfälle vorzubereiten;"],
          },
          { text: "wie:", children: ["integriert werden."] },
        ],
      },
    ]);
  });

  it("reads an unmarked run of semicolon lines after a colon as a list, closed by the full stop", () => {
    expect(
      textBlocks(
        "Determine the scope, considering:\nexternal and internal issues;\nrequirements of interested parties;\nplanned work activities.\nThe scope is available as documented information stating the:\nactivities covered;\njustification for any exclusion.",
      ),
    ).toEqual([
      { kind: "paragraph", text: "Determine the scope, considering:" },
      {
        kind: "list",
        items: [
          { text: "external and internal issues;", children: [] },
          { text: "requirements of interested parties;", children: [] },
          { text: "planned work activities.", children: [] },
        ],
      },
      {
        kind: "paragraph",
        text: "The scope is available as documented information stating the:",
      },
      {
        kind: "list",
        items: [
          { text: "activities covered;", children: [] },
          { text: "justification for any exclusion.", children: [] },
        ],
      },
    ]);
  });

  it("keeps plain sentences as paragraphs, dropping blank lines", () => {
    expect(
      textBlocks("Verify the scope.\n\nVerify it is accurate.\n\nLook for: certificates."),
    ).toEqual([
      { kind: "paragraph", text: "Verify the scope." },
      { kind: "paragraph", text: "Verify it is accurate." },
      { kind: "paragraph", text: "Look for: certificates." },
    ]);
  });

  it("does not start a list after a colon when the next line is a full sentence", () => {
    expect(textBlocks("Look for:\nEvidence in strategic plans.")).toEqual([
      { kind: "paragraph", text: "Look for:" },
      { kind: "paragraph", text: "Evidence in strategic plans." },
    ]);
  });

  it("promotes a sub bullet with no parent to a first level item and answers nothing for empty text", () => {
    expect(textBlocks("o  lonely line")).toEqual([
      { kind: "list", items: [{ text: "lonely line", children: [] }] },
    ]);
    expect(textBlocks("")).toEqual([]);
  });
});
