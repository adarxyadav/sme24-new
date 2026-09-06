import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfidenceBadge, isRunStatus, RunStatusBadge } from "@/features/research/ui/badges";
import { en, renderWithIntl } from "./helpers";

/**
 * The two badges of the dashboard (spec 0007, AC-7): the run status in words, an unknown status
 * shown as queued, and the confidence level with the thresholds high 0.75 and medium 0.4, named
 * for assistive tech and titled with the percentage.
 */
describe("RunStatusBadge (AC-7)", () => {
  it.each(["queued", "running", "succeeded", "empty", "failed"] as const)(
    "names the %s status in the reader's language",
    (status) => {
      renderWithIntl(<RunStatusBadge status={status} />, "en-CH");
      expect(screen.getByText(en.research.status[status])).toHaveAttribute("data-status", status);
    },
  );

  it("shows an unknown status as queued rather than crashing", () => {
    renderWithIntl(<RunStatusBadge status="archived" />, "en-CH");
    expect(screen.getByText(en.research.status.queued)).toBeInTheDocument();
    expect(isRunStatus("archived")).toBe(false);
    expect(isRunStatus("empty")).toBe(true);
  });
});

describe("ConfidenceBadge (AC-7)", () => {
  it.each([
    [0.75, "high"],
    [0.9, "high"],
    [0.4, "medium"],
    [0.74, "medium"],
    [0.39, "low"],
    [0, "low"],
  ] as const)(
    "shows %s as %s with an accessible name and the percentage as title",
    (confidence, level) => {
      renderWithIntl(<ConfidenceBadge confidence={confidence} />, "en-CH");
      const label = en.research.table.confidence[level];
      const badge = screen.getByText(label);
      expect(badge).toHaveAttribute("data-confidence", level);
      expect(badge).toHaveAttribute("aria-label", `Confidence: ${label}`);
      expect(badge).toHaveAttribute("title", `Confidence: ${Math.round(confidence * 100)} %`);
    },
  );
});
