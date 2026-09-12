import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GapEntry, Score } from "@/features/assessments/model";
import { ScoreSummary } from "@/features/assessments/ui/score-summary";
import { de, en, formatDe, formatEn, itemId, renderWithIntl, text } from "./helpers";

/**
 * The locked score of a submitted assessment (spec 0019, AC-8, AC-9): the overall percentage and
 * the counted line, one row per section with its percentage or Not applicable and its reason, the
 * gap list in the order it was handed over with label, title, section and note, then every
 * excluded standard after the gaps with why. The server translator and formatter are the
 * boundaries; every number was computed elsewhere, so this asserts what is printed, not the maths.
 */
const env = vi.hoisted(() => ({ locale: "en-CH" as "en-CH" | "de-CH" }));
vi.mock("next-intl/server", async () => {
  const { serverIntlMock } = await import("./helpers");
  return serverIntlMock(env);
});

const strings = en.assessments.summary;
const percent = (value: number) => formatEn.number(value / 100, "percent");

const SCORE: Score = {
  overall: 83,
  rated: 5,
  total: 6,
  excludedSections: ["hot_work"],
  sections: [
    {
      key: "c4",
      label: "4",
      title: text("Context of the organization"),
      excluded: false,
      exclusionNote: null,
      percent: 75,
      rated: 2,
      total: 2,
    },
    {
      key: "c7",
      label: "7",
      title: text("Support"),
      excluded: false,
      exclusionNote: null,
      percent: null,
      rated: 0,
      total: 1,
    },
    {
      key: "hot_work",
      label: "12",
      title: text("Hot work"),
      excluded: true,
      exclusionNote: "Welding is contracted out",
      percent: null,
      rated: 0,
      total: 3,
    },
  ],
};

const GAPS: readonly GapEntry[] = [
  {
    itemId: itemId(2),
    label: "4.2",
    title: text("Needs and expectations"),
    sectionKey: "c4",
    sectionLabel: "4",
    sectionTitle: text("Context of the organization"),
    rating: "non_compliant",
    note: "No register of interested parties",
  },
  {
    itemId: itemId(1),
    label: "4.1",
    title: text("Understanding the organization"),
    sectionKey: "c4",
    sectionLabel: "4",
    sectionTitle: text("Context of the organization"),
    rating: "partial",
    note: null,
  },
];

async function renderSummary(score: Score = SCORE, gaps: readonly GapEntry[] = GAPS) {
  const locale = env.locale === "de-CH" ? "de" : "en";
  return renderWithIntl(await ScoreSummary({ score, gaps, locale }), env.locale);
}

describe("ScoreSummary (AC-9)", () => {
  it("is a region named Locked score with the overall percentage and the counted line", async () => {
    env.locale = "en-CH";
    await renderSummary();
    const region = screen.getByRole("region", { name: strings.heading });
    expect(within(region).getByText(strings.lead)).toBeInTheDocument();
    expect(within(region).getByText(percent(83))).toBeInTheDocument();
    expect(within(region).getByText("5 of 6 items rated")).toBeInTheDocument();
  });

  it("prints one row per section: rated over total and the percentage, or Not applicable with its reason", async () => {
    env.locale = "en-CH";
    await renderSummary();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells(rows[0] as HTMLElement)).toEqual([
      "4 Context of the organization",
      "2 of 2",
      percent(75),
    ]);
    expect(cells(rows[1] as HTMLElement)).toEqual(["7 Support", "0 of 1", "—"]);
    expect(cells(rows[2] as HTMLElement)).toEqual([
      "12 Hot workWelding is contracted out",
      strings.excluded,
      "—",
    ]);
  });

  it("lists the gaps as handed over, each with its rating, label, title, section and note", async () => {
    env.locale = "en-CH";
    const { container } = await renderSummary();
    const list = container.querySelector("[data-gap-list]") as HTMLElement;
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent(strings.ratings.non_compliant);
    expect(entries[0]).toHaveTextContent("4.2");
    expect(entries[0]).toHaveTextContent("Needs and expectations");
    expect(entries[0]).toHaveTextContent("Section 4, Context of the organization");
    expect(entries[0]).toHaveTextContent("No register of interested parties");
    expect(entries[1]).toHaveTextContent(strings.ratings.partial);
    expect(entries[1]).toHaveTextContent("Understanding the organization");
  });

  it("lists every excluded standard after the gaps with why it is missing from the score (AC-8)", async () => {
    env.locale = "en-CH";
    const { container } = await renderSummary();
    const excluded = container.querySelector('[data-excluded-section="hot_work"]') as HTMLElement;
    expect(excluded).toHaveTextContent(strings.excluded);
    expect(excluded).toHaveTextContent("12");
    expect(excluded).toHaveTextContent("Hot work");
    expect(excluded).toHaveTextContent(strings.excludedEntry);
    expect(excluded).toHaveTextContent("Welding is contracted out");
    const entries = within(container.querySelector("[data-gap-list]") as HTMLElement).getAllByRole(
      "listitem",
    );
    expect(entries[entries.length - 1]).toBe(excluded);
  });

  it("says there are no gaps and shows no list when every rated item is compliant and nothing is excluded", async () => {
    env.locale = "en-CH";
    const clean: Score = {
      ...SCORE,
      overall: 100,
      excludedSections: [],
      sections: SCORE.sections.slice(0, 1).map((section) => ({ ...section, percent: 100 })),
    };
    const { container } = await renderSummary(clean, []);
    expect(screen.getByText(strings.noGaps)).toBeInTheDocument();
    expect(container.querySelector("[data-gap-list]")).toBeNull();
  });

  it("prints a dash when nothing was rated at all", async () => {
    env.locale = "en-CH";
    await renderSummary({ ...SCORE, overall: null, rated: 0 }, []);
    const region = screen.getByRole("region", { name: strings.heading });
    expect(within(region).getByText(strings.overall).nextElementSibling).toHaveTextContent("—");
    expect(within(region).getByText("0 of 6 items rated")).toBeInTheDocument();
  });

  it("speaks German with the German titles and the Swiss number format", async () => {
    env.locale = "de-CH";
    await renderSummary();
    expect(
      screen.getByRole("region", { name: de.assessments.summary.heading }),
    ).toBeInTheDocument();
    expect(screen.getByText(formatDe.number(0.83, "percent"))).toBeInTheDocument();
    expect(screen.getByText("Needs and expectations (de)")).toBeInTheDocument();
    expect(screen.getAllByText(de.assessments.summary.excluded).length).toBeGreaterThan(0);
  });
});
