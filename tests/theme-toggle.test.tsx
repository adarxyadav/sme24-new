import { act, render, screen, waitFor, within } from "@testing-library/react";
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

  it("is a labelled radio group of three icon radios with system preselected after mount", async () => {
    renderToggle();
    const group = screen.getByRole("radiogroup", { name: de.theme.toggle });
    const options = within(group).getAllByRole("radio");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      de.theme.system,
      de.theme.light,
      de.theme.dark,
    ]);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: de.theme.system })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });

  it("writes the choice through next-themes only: localStorage.theme and the html class", async () => {
    const user = userEvent.setup();
    renderToggle();
    await act(async () => {
      await user.click(screen.getByRole("radio", { name: de.theme.dark }));
    });
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
