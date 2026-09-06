import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type ProgressItem, ProgressList } from "@/components/ui/progress-list";

/**
 * The progress list primitive (spec 0007, AC-7, AC-16): an ordered list of steps, the current one
 * marked with `aria-current="step"`, a state on every item conveyed by icon and text, an optional
 * detail line, a screen reader only step label, and the connector hidden from assistive tech.
 */
const items: readonly ProgressItem[] = [
  { id: "queued", label: "Queued", state: "done" },
  { id: "searching", label: "Searching", state: "current", detail: "5 sources found" },
  { id: "extracting", label: "Extracting", state: "pending" },
  { id: "saving", label: "Saving", state: "failed", detail: "It stopped." },
];

describe("ProgressList", () => {
  it("renders an ordered list with one item per step carrying its state and label", () => {
    render(<ProgressList items={items} aria-label="Research" />);
    const list = screen.getByRole("list", { name: "Research" });
    expect(list.tagName).toBe("OL");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual([
      "done",
      "current",
      "pending",
      "failed",
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Queued",
      "Searching5 sources found",
      "Extracting",
      "SavingIt stopped.",
    ]);
  });

  it("marks only the current step for assistive tech", () => {
    render(<ProgressList items={items} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[1]).toHaveAttribute("aria-current", "step");
    for (const index of [0, 2, 3]) expect(rows[index]).not.toHaveAttribute("aria-current");
  });

  it("reads a step label before each item when given, hidden from sight", () => {
    render(<ProgressList items={items} stepLabel={(index) => `Step ${index + 1}`} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Step 1 Queued");
    expect(within(rows[0] as HTMLElement).getByText("Step 1")).toHaveClass("sr-only");
  });

  it("hides the icons and the connector line from assistive tech", () => {
    const { container } = render(<ProgressList items={items} />);
    expect(container.querySelectorAll("svg")).toHaveLength(items.length);
    for (const icon of container.querySelectorAll("svg")) {
      expect(icon.closest("[aria-hidden='true']")).not.toBeNull();
    }
    expect(container.querySelectorAll("li > span[aria-hidden='true']")).toHaveLength(
      items.length * 2 - 1,
    );
  });

  it("passes list attributes through and renders nothing for no items", () => {
    const { container } = render(<ProgressList items={[]} className="mt-2" id="steps" />);
    const list = container.querySelector("ol");
    expect(list).toHaveAttribute("id", "steps");
    expect(list).toHaveClass("mt-2");
    expect(list?.children).toHaveLength(0);
  });
});
