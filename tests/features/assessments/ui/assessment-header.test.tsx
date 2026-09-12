import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Progress, Score } from "@/features/assessments/model";
import type { AssessmentPage, AssessmentRow } from "@/features/assessments/queries";
import { AssessmentHeader } from "@/features/assessments/ui/assessment-header";
import { stubRadixEnvironment } from "../../legal/ui/helpers";
import {
  ASSESSMENT_ID,
  COMPANY_ID,
  EXPERT_ID,
  en,
  formatEn,
  ITEMS,
  ORDER_ID,
  ORG_ID,
  renderWithIntl,
  SECTIONS,
  text,
  VERSION_KEY,
} from "./helpers";

/**
 * The head of the assessment page (spec 0019, AC-6, AC-9): the title as the page's one h1, the
 * way back to the client, the status, the progress and the running score, the details form and the
 * submit control while the draft is open, and the locked facts with no control once submitted.
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
vi.mock("@/features/assessments/actions", () => ({
  submitAssessment: vi.fn(),
  updateAssessmentDetails: vi.fn(),
}));

stubRadixEnvironment();

const strings = en.assessments;

function assessmentRow(
  status: "draft" | "submitted",
  overrides: Partial<AssessmentRow> = {},
): AssessmentRow {
  return {
    id: ASSESSMENT_ID,
    organization_id: ORG_ID,
    company_id: COMPANY_ID,
    order_id: ORDER_ID,
    questionnaire_key: "iso45001",
    questionnaire_version_key: VERSION_KEY,
    expert_id: EXPERT_ID,
    status,
    site: "Plant Basel",
    conducted_on: "2026-10-06",
    submitted_at: status === "submitted" ? "2026-09-12T10:20:00.000Z" : null,
    created_at: "2026-09-10T07:30:00.000Z",
    updated_at: "2026-09-12T10:20:00.000Z",
    ...overrides,
  };
}

function page(
  status: "draft" | "submitted",
  overrides: Partial<AssessmentPage> = {},
): AssessmentPage {
  return {
    assessment: assessmentRow(status),
    status,
    companyName: "Musterfirma AG",
    organizationName: "Musterfirma Holding",
    version: {
      key: VERSION_KEY,
      questionnaireKey: "iso45001",
      version: 1,
      title: text("ISO 45001 Gap Assessment"),
      sections: SECTIONS,
    },
    items: ITEMS,
    answers: [],
    ...overrides,
  };
}

const SCORE: Score = { overall: 67, rated: 3, total: 27, sections: [], excludedSections: [] };
const PROGRESS: Progress = {
  rated: 3,
  required: 27,
  unrated: 24,
  sections: [
    {
      key: "c4",
      label: "4",
      title: text("Context"),
      excluded: false,
      rated: 3,
      required: 7,
      unrated: 4,
    },
    {
      key: "c7",
      label: "7",
      title: text("Support"),
      excluded: false,
      rated: 0,
      required: 20,
      unrated: 20,
    },
  ],
};

async function renderHeader(
  status: "draft" | "submitted",
  overrides: Partial<AssessmentPage> = {},
  score = SCORE,
) {
  env.locale = "en-CH";
  return renderWithIntl(
    await AssessmentHeader({
      page: page(status, overrides),
      score,
      progress: PROGRESS,
      locale: "en",
    }),
    "en-CH",
  );
}

describe("AssessmentHeader (AC-6)", () => {
  it("shows the title as the one h1, the way back to the client, the status, the progress and the running score", async () => {
    await renderHeader("draft");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ISO 45001 Gap Assessment");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Back to Musterfirma AG" })).toHaveAttribute(
      "href",
      `/en/expert/clients/${ORG_ID}`,
    );
    expect(screen.getByText("Musterfirma AG")).toBeInTheDocument();
    const status = screen.getByText(strings.status.draft);
    expect(status).toHaveAttribute("data-assessment-status", "draft");
    expect(screen.getByText("3 of 27 rated")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: strings.page.progress })).toBeInTheDocument();
    expect(screen.getByText(strings.page.runningScore)).toBeInTheDocument();
    expect(screen.getByText(formatEn.number(0.67, "percent"))).toHaveAttribute(
      "data-assessment-score",
    );
  });

  it("carries the details form pre filled and the submit control while the draft is open", async () => {
    await renderHeader("draft");
    expect(screen.getByRole("textbox", { name: strings.details.site })).toHaveValue("Plant Basel");
    expect(screen.getByLabelText(strings.details.conductedOn)).toHaveValue("2026-10-06");
    expect(screen.getByRole("button", { name: strings.submit.open })).toBeInTheDocument();
  });

  it("prints a dash while nothing is rated yet", async () => {
    await renderHeader("draft", {}, { ...SCORE, overall: null, rated: 0 });
    expect(screen.getByText(strings.page.noScore)).toHaveAttribute("data-assessment-score");
  });

  it("once submitted shows the locked facts and no control (AC-9)", async () => {
    await renderHeader("submitted");
    const status = screen.getByText(strings.status.submitted);
    expect(status).toHaveAttribute("data-assessment-status", "submitted");
    expect(
      screen.getByText(formatEn.dateTime(new Date("2026-09-12T10:20:00.000Z"), "dateTime")),
    ).toBeInTheDocument();
    expect(screen.getByText(strings.page.score)).toBeInTheDocument();
    expect(screen.queryByText(strings.page.runningScore)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.submit.open })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    const site = screen.getByText(strings.details.site);
    expect(within(site.parentElement as HTMLElement).getByText("Plant Basel")).toBeInTheDocument();
    const visit = screen.getByText(strings.details.conductedOn);
    expect(
      within(visit.parentElement as HTMLElement).getByText(
        formatEn.dateTime(new Date("2026-10-06T12:00:00Z"), "dateShort"),
      ),
    ).toBeInTheDocument();
  });

  it("says not recorded for a missing site and date, and falls back to the organization's name", async () => {
    await renderHeader("submitted", {
      assessment: assessmentRow("submitted", { site: null, conducted_on: null }),
      companyName: null,
    });
    expect(screen.getAllByText(strings.details.none)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Back to Musterfirma Holding" })).toBeInTheDocument();
  });
});
