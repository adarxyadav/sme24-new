import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RatingControlProps } from "@/features/assessments/ui/rating-control";
import { RatingControl } from "@/features/assessments/ui/rating-control";

/**
 * The three way rating control (spec 0019, AC-6, AC-13): a real radio group named by the item's
 * title, three labelled radios, the chosen one marked in the DOM (not only in colour), arrow keys
 * moving between the segments, and a disabled control that reports nothing.
 */
const labels = {
  compliant: "Compliant",
  partial: "Partially compliant",
  non_compliant: "Non compliant",
} as const;

function renderControl(overrides: Partial<RatingControlProps> = {}) {
  const onValueChange = vi.fn();
  render(
    <>
      <span id="item-title">Item 4.1</span>
      <RatingControl
        labelledBy="item-title"
        value={null}
        onValueChange={onValueChange}
        labels={labels}
        {...overrides}
      />
    </>,
  );
  return { onValueChange };
}

describe("RatingControl (AC-13)", () => {
  it("is a radio group named by the item's title with the three ratings as labelled radios", () => {
    renderControl();
    const group = screen.getByRole("radiogroup", { name: "Item 4.1" });
    expect(group).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Compliant",
      "Partially compliant",
      "Non compliant",
    ]);
  });

  it("leaves every radio unchecked while the item has no rating", () => {
    renderControl();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
  });

  it("marks the chosen segment checked in the DOM so the choice never rests on colour alone", () => {
    renderControl({ value: "partial" });
    const chosen = screen.getByRole("radio", { name: "Partially compliant" });
    expect(chosen).toHaveAttribute("aria-checked", "true");
    expect(chosen).toHaveAttribute("data-state", "checked");
    expect(chosen).toHaveAttribute("data-rating", "partial");
    expect(screen.getByRole("radio", { name: "Compliant" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("reports the rating code of the clicked segment", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderControl();
    await user.click(screen.getByRole("radio", { name: "Non compliant" }));
    expect(onValueChange).toHaveBeenCalledWith("non_compliant");
  });

  it("moves between the segments with the arrow keys and chooses the one reached", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderControl({ value: "compliant" });
    screen.getByRole("radio", { name: "Compliant" }).focus();
    // Radix moves the focus on the next tick so its document keydown listener can note the arrow
    // first; a real key stays down that long, so the test holds it down too.
    await user.keyboard("{ArrowRight>}");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await user.keyboard("{/ArrowRight}");
    expect(screen.getByRole("radio", { name: "Partially compliant" })).toHaveFocus();
    expect(onValueChange).toHaveBeenCalledWith("partial");
  });

  it("is one tab stop: Tab lands on the chosen segment and the next Tab leaves the group", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        <span id="item-title">Item 4.1</span>
        <RatingControl
          labelledBy="item-title"
          value="non_compliant"
          onValueChange={() => {}}
          labels={labels}
        />
        <button type="button">after</button>
      </>,
    );
    screen.getByRole("button", { name: "before" }).focus();
    await user.tab();
    expect(screen.getByRole("radio", { name: "Non compliant" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("disables every segment and reports nothing when disabled", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderControl({ value: "compliant", disabled: true });
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
    await user.click(screen.getByRole("radio", { name: "Non compliant" }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Compliant" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("hides the icons from assistive technology", () => {
    const { container } = { container: document.body };
    renderControl();
    for (const icon of container.querySelectorAll("svg")) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});
