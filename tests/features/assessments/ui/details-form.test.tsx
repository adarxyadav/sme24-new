import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateAssessmentDetailsResult } from "@/features/assessments/actions";
import { DetailsForm } from "@/features/assessments/ui/details-form";
import { ASSESSMENT_ID, en, renderWithIntl } from "./helpers";

/**
 * The site and visit date of a draft (spec 0019, AC-6): two labelled fields, Save disabled until
 * something changed, an empty date sent as null, the toast and the refresh hanging off the click,
 * and a refusal that keeps what was typed. The server action, the router and the toaster are the
 * boundaries.
 */
const boundary = vi.hoisted(() => ({
  updateAssessmentDetails:
    vi.fn<(previous: null, input: unknown) => Promise<UpdateAssessmentDetailsResult>>(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/assessments/actions", () => ({
  updateAssessmentDetails: boundary.updateAssessmentDetails,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: boundary.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: boundary.toastSuccess, error: boundary.toastError },
}));

const strings = en.assessments.details;
const site = () => screen.getByRole("textbox", { name: strings.site });
const date = () => screen.getByLabelText(strings.conductedOn);
const save = () => screen.getByRole("button", { name: strings.save });

beforeEach(() => {
  boundary.updateAssessmentDetails.mockReset();
  boundary.refresh.mockReset();
  boundary.toastSuccess.mockReset();
  boundary.toastError.mockReset();
});

describe("DetailsForm (AC-6)", () => {
  it("labels both fields, pre fills them and keeps Save disabled until something changes", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <DetailsForm assessmentId={ASSESSMENT_ID} site="Plant Basel" conductedOn="2026-10-06" />,
      "en-CH",
    );
    expect(site()).toHaveValue("Plant Basel");
    expect(site()).toHaveAttribute("maxlength", "200");
    expect(date()).toHaveValue("2026-10-06");
    expect(save()).toBeDisabled();

    await user.type(site(), " North");
    expect(save()).toBeEnabled();
    await user.clear(site());
    await user.type(site(), "Plant Basel");
    expect(save()).toBeDisabled();
  });

  it("saves the site and the date, then toasts and refreshes off the click", async () => {
    const user = userEvent.setup();
    boundary.updateAssessmentDetails.mockResolvedValue({
      ok: true,
      data: { assessmentId: ASSESSMENT_ID },
    });
    renderWithIntl(
      <DetailsForm assessmentId={ASSESSMENT_ID} site={null} conductedOn={null} />,
      "en-CH",
    );
    await user.type(site(), "Plant Basel");
    await user.type(date(), "2026-10-07");
    await user.click(save());

    await waitFor(() => expect(boundary.toastSuccess).toHaveBeenCalledWith(strings.saved));
    expect(boundary.updateAssessmentDetails).toHaveBeenCalledTimes(1);
    expect(boundary.updateAssessmentDetails).toHaveBeenCalledWith(null, {
      assessmentId: ASSESSMENT_ID,
      site: "Plant Basel",
      conductedOn: "2026-10-07",
    });
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });

  it("sends a cleared date as null rather than an empty string", async () => {
    const user = userEvent.setup();
    boundary.updateAssessmentDetails.mockResolvedValue({
      ok: true,
      data: { assessmentId: ASSESSMENT_ID },
    });
    renderWithIntl(
      <DetailsForm assessmentId={ASSESSMENT_ID} site="Plant Basel" conductedOn="2026-10-06" />,
      "en-CH",
    );
    await user.clear(date());
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(boundary.updateAssessmentDetails).toHaveBeenCalled());
    expect(boundary.updateAssessmentDetails).toHaveBeenCalledWith(null, {
      assessmentId: ASSESSMENT_ID,
      site: "Plant Basel",
      conductedOn: null,
    });
  });

  it("names the refusal and keeps what was typed, without a refresh", async () => {
    const user = userEvent.setup();
    boundary.updateAssessmentDetails.mockResolvedValue({ ok: false, error: "locked" });
    renderWithIntl(
      <DetailsForm assessmentId={ASSESSMENT_ID} site={null} conductedOn={null} />,
      "en-CH",
    );
    await user.type(site(), "Plant Basel");
    await user.click(save());
    await waitFor(() => expect(boundary.toastError).toHaveBeenCalledWith(strings.errors.locked));
    expect(boundary.toastSuccess).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
    expect(site()).toHaveValue("Plant Basel");
  });

  it("submits on Enter in the site field through the form, never twice while pending", async () => {
    const user = userEvent.setup();
    let settle: (value: UpdateAssessmentDetailsResult) => void = () => {};
    boundary.updateAssessmentDetails.mockImplementation(
      () => new Promise<UpdateAssessmentDetailsResult>((resolve) => (settle = resolve)),
    );
    renderWithIntl(
      <DetailsForm assessmentId={ASSESSMENT_ID} site={null} conductedOn={null} />,
      "en-CH",
    );
    await user.type(site(), "Plant Basel{Enter}");
    await waitFor(() => expect(boundary.updateAssessmentDetails).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: strings.saving })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(boundary.updateAssessmentDetails).toHaveBeenCalledTimes(1);
    settle({ ok: true, data: { assessmentId: ASSESSMENT_ID } });
    await waitFor(() => expect(boundary.toastSuccess).toHaveBeenCalled());
  });
});
