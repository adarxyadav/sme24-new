import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SaveIndicator, type SaveState } from "@/features/assessments/ui/save-indicator";
import { de, en, formatEn, renderWithIntl } from "./helpers";

/**
 * The per item save indicator (spec 0019, AC-6, AC-13): a polite live region that exists before
 * its first announcement, says where the save stands in the reader's language, prints the saved
 * time in Swiss local time and offers a manual retry only once the automatic ones gave up.
 */
const SAVED_AT = "2026-09-12T14:02:00Z";
const shownTime = formatEn.dateTime(new Date(SAVED_AT), { hour: "2-digit", minute: "2-digit" });

describe("SaveIndicator (AC-6, AC-13)", () => {
  it("is a polite live region even while idle, so the first change is announced not inserted", () => {
    renderWithIntl(<SaveIndicator state="idle" savedAt={null} />, "en-CH");
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("data-state", "idle");
    expect(region).toHaveTextContent("");
  });

  it.each<[SaveState, string]>([
    ["pending", en.assessments.save.pending],
    ["saving", en.assessments.save.saving],
    ["saved", en.assessments.save.saved],
    ["failed", en.assessments.save.failed],
  ])("says where the save stands in the %s state", (state, expected) => {
    renderWithIntl(<SaveIndicator state={state} savedAt={null} />, "en-CH");
    expect(screen.getByRole("status")).toHaveTextContent(expected);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", state);
  });

  it("prints the saved time in Swiss local time next to Saved", () => {
    renderWithIntl(<SaveIndicator state="saved" savedAt={SAVED_AT} />, "en-CH");
    expect(screen.getByRole("status")).toHaveTextContent(`Saved ${shownTime}`);
    expect(shownTime).toBe("16:02");
  });

  it("offers a retry only in the failed state and only when a handler is given", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { unmount } = renderWithIntl(
      <SaveIndicator state="failed" savedAt={null} onRetry={onRetry} />,
      "en-CH",
    );
    await user.click(screen.getByRole("button", { name: en.assessments.save.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    renderWithIntl(<SaveIndicator state="failed" savedAt={null} />, "en-CH");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<SaveIndicator state="saved" savedAt={SAVED_AT} onRetry={onRetry} />, "en-CH");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("speaks German when the reader does", () => {
    renderWithIntl(<SaveIndicator state="failed" savedAt={null} onRetry={() => {}} />, "de-CH");
    expect(screen.getByRole("status")).toHaveTextContent(de.assessments.save.failed);
    expect(screen.getByRole("button", { name: de.assessments.save.retry })).toBeInTheDocument();
  });

  it("hides its icons from assistive technology", () => {
    const { container } = renderWithIntl(<SaveIndicator state="saving" savedAt={null} />, "en-CH");
    for (const icon of container.querySelectorAll("svg")) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});
