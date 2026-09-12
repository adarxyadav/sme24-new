import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncompleteSection, SubmitAssessmentResult } from "@/features/assessments/actions";
import { SubmitDialog } from "@/features/assessments/ui/submit-dialog";
import { stubRadixEnvironment } from "../../legal/ui/helpers";
import { ASSESSMENT_ID, de, en, renderWithIntl, text } from "./helpers";

/**
 * The submit confirmation (spec 0019, AC-9): the dialog names what locks and, while items are
 * unrated, how many and in which sections with the confirm button disabled; on confirmation the
 * action runs once, and the database's own answer wins: a fresh incomplete count replaces the
 * list, a locked answer closes the dialog and refreshes, success toasts, closes and refreshes.
 * The server action, the router and the toaster are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  submitAssessment: vi.fn<(previous: null, input: unknown) => Promise<SubmitAssessmentResult>>(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/assessments/actions", () => ({
  submitAssessment: boundary.submitAssessment,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: boundary.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: boundary.toastSuccess, error: boundary.toastError },
}));

stubRadixEnvironment();

const strings = en.assessments.submit;

const SECTIONS: readonly IncompleteSection[] = [
  { key: "c4", label: "4", title: text("Context of the organization"), unrated: 2 },
  { key: "c7", label: "7", title: text("Support"), unrated: 3 },
];

function renderDialog(unrated = 5, sections = SECTIONS, locale: "en-CH" | "de-CH" = "en-CH") {
  return renderWithIntl(
    <SubmitDialog
      assessmentId={ASSESSMENT_ID}
      unrated={unrated}
      sections={sections}
      locale={locale === "de-CH" ? "de" : "en"}
    />,
    locale,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: strings.open }));
  return screen.getByRole("dialog", { name: strings.title });
}

beforeEach(() => {
  boundary.submitAssessment.mockReset();
  boundary.refresh.mockReset();
  boundary.toastSuccess.mockReset();
  boundary.toastError.mockReset();
});

describe("SubmitDialog (AC-9)", () => {
  it("names what locks and lists the unrated items per section, with confirm disabled", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await open(user);
    expect(dialog).toHaveAccessibleDescription(strings.description);
    expect(within(dialog).getByText("5 items are still unrated.")).toBeInTheDocument();
    const rows = within(dialog).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "4 Context of the organization2 unrated",
      "7 Support3 unrated",
    ]);
    expect(within(dialog).getByRole("button", { name: strings.confirm })).toBeDisabled();
    expect(boundary.submitAssessment).not.toHaveBeenCalled();
  });

  it("uses the singular for one unrated item", async () => {
    const user = userEvent.setup();
    renderDialog(1, [{ key: "c7", label: "7", title: text("Support"), unrated: 1 }]);
    const dialog = await open(user);
    expect(within(dialog).getByText("1 item is still unrated.")).toBeInTheDocument();
  });

  it("says every item is rated and enables confirm when nothing is missing", async () => {
    const user = userEvent.setup();
    renderDialog(0, []);
    const dialog = await open(user);
    expect(within(dialog).getByText(strings.ready)).toBeInTheDocument();
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: strings.confirm })).toBeEnabled();
  });

  it("locks on confirmation: one call, a toast, the dialog closed and the page refreshed", async () => {
    const user = userEvent.setup();
    boundary.submitAssessment.mockResolvedValue({
      ok: true,
      data: { submittedAt: "2026-09-12T10:20:00Z", score: 94 },
    });
    renderDialog(0, []);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: strings.confirm }));

    await waitFor(() => expect(boundary.toastSuccess).toHaveBeenCalledWith(strings.done));
    expect(boundary.submitAssessment).toHaveBeenCalledTimes(1);
    expect(boundary.submitAssessment).toHaveBeenCalledWith(null, { assessmentId: ASSESSMENT_ID });
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("replaces the list with the database's own count when it answers incomplete", async () => {
    const user = userEvent.setup();
    boundary.submitAssessment.mockResolvedValue({
      ok: false,
      error: "incomplete",
      unrated: 2,
      sections: [{ key: "c9", label: "9", title: text("Performance evaluation"), unrated: 2 }],
    });
    renderDialog(0, []);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: strings.confirm }));

    expect(await within(dialog).findByText("2 items are still unrated.")).toBeInTheDocument();
    expect(within(dialog).getByRole("listitem")).toHaveTextContent(
      "9 Performance evaluation2 unrated",
    );
    expect(within(dialog).getByRole("button", { name: strings.confirm })).toBeDisabled();
    expect(boundary.toastError).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("closes and refreshes when another tab already submitted", async () => {
    const user = userEvent.setup();
    boundary.submitAssessment.mockResolvedValue({ ok: false, error: "locked" });
    renderDialog(0, []);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: strings.confirm }));
    await waitFor(() => expect(boundary.toastError).toHaveBeenCalledWith(strings.errors.locked));
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("names any other refusal and stays open", async () => {
    const user = userEvent.setup();
    boundary.submitAssessment.mockResolvedValue({ ok: false, error: "unexpected" });
    renderDialog(0, []);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: strings.confirm }));
    await waitFor(() =>
      expect(boundary.toastError).toHaveBeenCalledWith(strings.errors.unexpected),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("cancel closes without a call and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderDialog(0, []);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: strings.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(boundary.submitAssessment).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: strings.open })).toHaveFocus();
  });

  it("reads the German section titles for a German reader", async () => {
    const user = userEvent.setup();
    renderDialog(5, SECTIONS, "de-CH");
    await user.click(screen.getByRole("button", { name: de.assessments.submit.open }));
    const dialog = screen.getByRole("dialog", { name: de.assessments.submit.title });
    expect(within(dialog).getAllByRole("listitem")[0]).toHaveTextContent(
      "Context of the organization (de)",
    );
  });
});
