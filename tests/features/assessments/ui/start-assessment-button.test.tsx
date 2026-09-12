import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartAssessmentResult } from "@/features/assessments/actions";
import { StartAssessmentButton } from "@/features/assessments/ui/start-assessment-button";
import { ASSESSMENT_ID, COMPANY_ID, en, ORG_ID, renderWithIntl } from "./helpers";

/**
 * The Start button of one questionnaire (spec 0019, AC-5): one call with the organization, the
 * company and the key, the toast and the navigation to the new draft hanging off the click, a
 * pending label while the action runs, and a refusal that names itself and stays on the page.
 */
const boundary = vi.hoisted(() => ({
  startAssessment: vi.fn<(previous: null, input: unknown) => Promise<StartAssessmentResult>>(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/assessments/actions", () => ({ startAssessment: boundary.startAssessment }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: boundary.push }) }));
vi.mock("sonner", () => ({
  toast: { success: boundary.toastSuccess, error: boundary.toastError },
}));

const strings = en.assessments.start;

function renderButton() {
  return renderWithIntl(
    <StartAssessmentButton
      organizationId={ORG_ID}
      companyId={COMPANY_ID}
      questionnaireKey="iso45001"
    />,
    "en-CH",
  );
}

beforeEach(() => {
  boundary.startAssessment.mockReset();
  boundary.push.mockReset();
  boundary.toastSuccess.mockReset();
  boundary.toastError.mockReset();
});

describe("StartAssessmentButton (AC-5)", () => {
  it("starts the questionnaire for the company and opens the new draft", async () => {
    const user = userEvent.setup();
    boundary.startAssessment.mockResolvedValue({ ok: true, data: { assessmentId: ASSESSMENT_ID } });
    renderButton();
    await user.click(screen.getByRole("button", { name: strings.button }));

    await waitFor(() => expect(boundary.push).toHaveBeenCalledTimes(1));
    expect(boundary.startAssessment).toHaveBeenCalledWith(null, {
      organizationId: ORG_ID,
      companyId: COMPANY_ID,
      questionnaireKey: "iso45001",
    });
    expect(boundary.toastSuccess).toHaveBeenCalledWith(strings.started);
    expect(boundary.push).toHaveBeenCalledWith({
      pathname: "/expert/clients/[organizationId]/assessments/[assessmentId]",
      params: { organizationId: ORG_ID, assessmentId: ASSESSMENT_ID },
    });
  });

  it("says it is starting and disables itself while the action runs", async () => {
    const user = userEvent.setup();
    let settle: (value: StartAssessmentResult) => void = () => {};
    boundary.startAssessment.mockImplementation(
      () => new Promise<StartAssessmentResult>((resolve) => (settle = resolve)),
    );
    renderButton();
    await user.click(screen.getByRole("button", { name: strings.button }));
    expect(await screen.findByRole("button", { name: strings.starting })).toBeDisabled();
    settle({ ok: true, data: { assessmentId: ASSESSMENT_ID } });
    await waitFor(() => expect(boundary.push).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: strings.button })).toBeEnabled();
  });

  it("names a refusal and stays on the page", async () => {
    const user = userEvent.setup();
    boundary.startAssessment.mockResolvedValue({ ok: false, error: "draft_exists" });
    renderButton();
    await user.click(screen.getByRole("button", { name: strings.button }));
    await waitFor(() =>
      expect(boundary.toastError).toHaveBeenCalledWith(strings.errors.draft_exists),
    );
    expect(boundary.push).not.toHaveBeenCalled();
    expect(boundary.toastSuccess).not.toHaveBeenCalled();
  });

  it("carries the questionnaire key for the e2e driver and hides its icon", () => {
    renderButton();
    const button = screen.getByRole("button", { name: strings.button });
    expect(button).toHaveAttribute("data-start", "iso45001");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
