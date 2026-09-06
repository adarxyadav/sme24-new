import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CalculationDisclosure } from "@/features/benchmark/ui/calculation-disclosure";

/**
 * The "How this is calculated" disclosure (spec 0008, AC-10): closed by default with the server
 * rendered content absent, a button named by the title that reports its expanded state, opened
 * by a click and by the keyboard, and closed again the same way.
 */
const TITLE = "How this is calculated";

function renderDisclosure() {
  render(
    <CalculationDisclosure title={TITLE}>
      <p>The formula in words</p>
    </CalculationDisclosure>,
  );
  return screen.getByRole("button", { name: TITLE });
}

describe("CalculationDisclosure (AC-10)", () => {
  it("is closed by default and does not render its content", () => {
    const trigger = renderDisclosure();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("The formula in words")).not.toBeInTheDocument();
  });

  it("opens on a click, shows the content and closes on the next click", async () => {
    const user = userEvent.setup();
    const trigger = renderDisclosure();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("The formula in words")).toBeVisible();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("The formula in words")).not.toBeInTheDocument();
  });

  it("is reachable by Tab and toggles with Enter and Space", async () => {
    const user = userEvent.setup();
    const trigger = renderDisclosure();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("hides the chevron from assistive technology so the button's name is the title alone", () => {
    const trigger = renderDisclosure();
    expect(trigger).toHaveAccessibleName(TITLE);
    expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
