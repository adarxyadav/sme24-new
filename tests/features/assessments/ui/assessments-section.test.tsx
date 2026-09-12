import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentListRow } from "@/features/assessments/queries";
import { AssessmentsSection } from "@/features/assessments/ui/assessments-section";
import {
  ASSESSMENT_ID,
  COMPANY_ID,
  EXPERT_ID,
  en,
  formatEn,
  ORG_ID,
  renderWithIntl,
  text,
} from "./helpers";

/**
 * The Assessments section of the expert's client page (spec 0019, AC-5): per questionnaire a
 * Start button while no draft of it exists for the chosen company and a Continue link once one
 * does, a draft of another company or a submitted one never counting, and the list of the
 * organization's assessments with title, status, dates, the locked score and a link to each.
 * The server translator and formatter are the boundaries.
 */
const env = vi.hoisted(() => ({ locale: "en-CH" as "en-CH" | "de-CH" }));
vi.mock("next-intl/server", async () => {
  const { serverIntlMock } = await import("./helpers");
  return serverIntlMock(env);
});
vi.mock("next/navigation", async () => {
  const { navigationMock } = await import("./helpers");
  return navigationMock();
});
vi.mock("@/features/assessments/actions", () => ({ startAssessment: vi.fn() }));

const strings = en.assessments;
const DRAFT_ID = "0e000000-0000-4000-8000-000000000006";
const OTHER_COMPANY = "0e000000-0000-4000-8000-000000000033";

function row(overrides: Partial<AssessmentListRow> = {}): AssessmentListRow {
  return {
    id: ASSESSMENT_ID,
    companyId: COMPANY_ID,
    expertId: EXPERT_ID,
    questionnaireKey: "iso45001",
    questionnaireTitle: text("ISO 45001 Gap Assessment"),
    status: "submitted",
    createdAt: "2026-09-10T07:30:00.000Z",
    submittedAt: "2026-09-12T10:20:00.000Z",
    score: 94,
    ...overrides,
  };
}

const draft = (key: "iso45001" | "compliance" = "iso45001", companyId = COMPANY_ID) =>
  row({
    id: DRAFT_ID,
    questionnaireKey: key,
    status: "draft",
    submittedAt: null,
    score: null,
    companyId,
  });

async function renderSection(
  rows: readonly AssessmentListRow[],
  companyId: string | null = COMPANY_ID,
) {
  env.locale = "en-CH";
  return renderWithIntl(
    await AssessmentsSection({ organizationId: ORG_ID, companyId, rows, locale: "en" }),
    "en-CH",
  );
}

const starts = () => screen.getAllByRole("button", { name: strings.start.button });
const continues = () => screen.queryAllByRole("link", { name: strings.section.continue });

describe("AssessmentsSection (AC-5)", () => {
  it("offers a Start button per questionnaire while no draft exists, each saying not started", async () => {
    await renderSection([]);
    expect(screen.getByRole("region", { name: strings.section.heading })).toBeInTheDocument();
    expect(starts().map((button) => button.getAttribute("data-start"))).toEqual([
      "iso45001",
      "compliance",
    ]);
    expect(screen.getAllByText(strings.section.notStarted)).toHaveLength(2);
    expect(continues()).toHaveLength(0);
    expect(screen.getByText(strings.section.empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("swaps Start for a Continue link to the draft, dated since its start, for that questionnaire only", async () => {
    await renderSection([draft("iso45001")]);
    const link = screen.getByRole("link", { name: strings.section.continue });
    expect(link).toHaveAttribute("href", `/en/expert/clients/${ORG_ID}/assessments/${DRAFT_ID}`);
    expect(link).toHaveAttribute("data-continue", "iso45001");
    expect(
      screen.getByText(
        `Draft since ${formatEn.dateTime(new Date("2026-09-10T07:30:00.000Z"), "dateShort")}`,
      ),
    ).toBeInTheDocument();
    expect(starts().map((button) => button.getAttribute("data-start"))).toEqual(["compliance"]);
  });

  it("ignores a draft of another company and a submitted assessment when deciding", async () => {
    await renderSection([
      draft("iso45001", OTHER_COMPANY),
      row({ questionnaireKey: "compliance" }),
    ]);
    expect(starts()).toHaveLength(2);
    expect(continues()).toHaveLength(0);
  });

  it("lists every assessment with its title, status, dates, score and a link to open it", async () => {
    await renderSection([row(), draft("compliance")]);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const cells = (tr: HTMLElement) =>
      within(tr)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    const started = formatEn.dateTime(new Date("2026-09-10T07:30:00.000Z"), "dateShort");
    const submitted = formatEn.dateTime(new Date("2026-09-12T10:20:00.000Z"), "dateShort");
    expect(cells(rows[0] as HTMLElement)).toEqual([
      "ISO 45001 Gap Assessment",
      strings.status.submitted,
      started,
      submitted,
      formatEn.number(0.94, "percent"),
      strings.section.open,
    ]);
    expect(cells(rows[1] as HTMLElement)).toEqual([
      "ISO 45001 Gap Assessment",
      strings.status.draft,
      started,
      "—",
      "—",
      strings.section.open,
    ]);
    const open = within(rows[0] as HTMLElement).getByRole("link", { name: strings.section.open });
    expect(open).toHaveAttribute(
      "href",
      `/en/expert/clients/${ORG_ID}/assessments/${ASSESSMENT_ID}`,
    );
  });

  it("says there is nothing to assess while the client has no company, with no Start button", async () => {
    await renderSection([], null);
    expect(screen.getByText(strings.section.noCompany)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.start.button })).not.toBeInTheDocument();
  });
});
