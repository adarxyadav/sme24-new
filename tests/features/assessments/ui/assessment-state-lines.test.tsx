import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssessmentState } from "@/features/assessments/states";
import { AssessmentStateLines } from "@/features/assessments/ui/assessment-state-lines";
import { de, en, formatDe, formatEn, ORDER_ID, renderWithIntl } from "./helpers";

/**
 * The state lines a booked order shows (spec 0019, AC-10) on the client's card and in the ops
 * orders table alike: one line per questionnaire the package runs, the three states in the
 * reader's language with the Swiss date, and never a rating, a note or a score.
 */
const strings = en.assessments;

function state(overrides: Partial<AssessmentState> = {}): AssessmentState {
  return {
    orderId: ORDER_ID,
    questionnaireKey: "iso45001",
    status: "draft",
    createdAt: "2026-09-10T07:30:00.000Z",
    submittedAt: null,
    ...overrides,
  };
}

const lines = (label: string = strings.state.label) =>
  within(screen.getByRole("list", { name: label }))
    .getAllByRole("listitem")
    .map((line) => line.textContent);

describe("AssessmentStateLines (AC-10)", () => {
  it("lists every questionnaire the package's visit runs as not started when nothing is linked", () => {
    renderWithIntl(<AssessmentStateLines packageKey="compliance" states={[]} />, "en-CH");
    expect(lines()).toEqual([
      `${strings.questionnaires.compliance}: ${strings.state.notStarted}`,
      `${strings.questionnaires.iso45001}: ${strings.state.notStarted}`,
    ]);
  });

  it("reads a draft as in progress since its start and a submission as submitted on its date", () => {
    renderWithIntl(
      <AssessmentStateLines
        packageKey="compliance"
        states={[
          state({ questionnaireKey: "iso45001" }),
          state({
            questionnaireKey: "compliance",
            status: "submitted",
            submittedAt: "2026-09-12T10:20:00.000Z",
          }),
        ]}
      />,
      "en-CH",
    );
    const started = formatEn.dateTime(new Date("2026-09-10T07:30:00.000Z"), "dateShort");
    const submitted = formatEn.dateTime(new Date("2026-09-12T10:20:00.000Z"), "dateShort");
    expect(lines()).toEqual([
      `${strings.questionnaires.compliance}: Submitted on ${submitted}`,
      `${strings.questionnaires.iso45001}: In progress since ${started}`,
    ]);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-assessment-state", "submitted");
    expect(items[1]).toHaveAttribute("data-assessment-state", "in_progress");
  });

  it("speaks German with the German questionnaire titles", () => {
    renderWithIntl(
      <AssessmentStateLines
        packageKey="sms"
        states={[state({ status: "submitted", submittedAt: "2026-09-12T10:20:00.000Z" })]}
      />,
      "de-CH",
    );
    const submitted = formatDe.dateTime(new Date("2026-09-12T10:20:00.000Z"), "dateShort");
    expect(screen.getByRole("list", { name: de.assessments.state.label })).toBeInTheDocument();
    expect(lines(de.assessments.state.label)).toEqual([
      `${de.assessments.questionnaires.iso45001}: Eingereicht am ${submitted}`,
    ]);
  });

  it("shows one bare line for a package whose visit runs no questionnaire", () => {
    renderWithIntl(<AssessmentStateLines packageKey="culture" states={[]} />, "en-CH");
    expect(lines()).toEqual([strings.state.notStarted]);
  });

  it("names a questionnaire outside the catalogue by its key rather than crashing", () => {
    renderWithIntl(
      <AssessmentStateLines
        packageKey="culture"
        states={[state({ questionnaireKey: "culture_v2" })]}
      />,
      "en-CH",
    );
    expect(lines()[0]).toMatch(/^culture_v2: In progress since /);
  });

  it("carries nothing but the state: no rating word, no score, no note", () => {
    const { container } = renderWithIntl(
      <AssessmentStateLines
        packageKey="compliance"
        states={[state({ status: "submitted", submittedAt: "2026-09-12T10:20:00.000Z" })]}
      />,
      "en-CH",
    );
    expect(container.textContent).not.toMatch(/%|compliant|note/i);
  });
});
