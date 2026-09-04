import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";
import de from "../messages/de-CH.json";

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="de-CH" messages={de}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ThemeToggle />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

describe("ThemeToggle (spec 0003, AC-3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("is a labelled button that opens a three way radio menu with system preselected", async () => {
    const user = userEvent.setup();
    renderToggle();
    const button = screen.getByRole("button", { name: de.theme.toggle });
    await user.click(button);
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual([
      de.theme.system,
      de.theme.light,
      de.theme.dark,
    ]);
    expect(screen.getByRole("menuitemradio", { name: de.theme.system })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("writes the choice through next-themes only: localStorage.theme and the html class", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: de.theme.toggle }));
    await act(async () => {
      await user.click(screen.getByRole("menuitemradio", { name: de.theme.dark }));
    });
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
