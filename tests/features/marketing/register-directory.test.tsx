import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { REGISTER } from "@/features/marketing/register";
import { RegisterDirectory } from "@/features/marketing/ui/register-directory";
import { formats } from "@/i18n/formats";
import en from "../../../messages/en-CH.json";

/**
 * The searchable register (spec 0009 follow-up, expert directory): the first page of rows, the
 * three filters, the empty state and the row limit, driven the way a visitor drives them.
 */

function renderDirectory() {
  return render(
    <NextIntlClientProvider locale="en-CH" messages={en} formats={formats}>
      <RegisterDirectory />
    </NextIntlClientProvider>,
  );
}

/** The rows of the results table, without the header row. */
function bodyRows() {
  const table = screen.getByRole("table");
  const [, ...rows] = within(table).getAllByRole("row");
  return rows;
}

describe("RegisterDirectory", () => {
  it("shows the first fifty entries and says how many matched in total", () => {
    renderDirectory();
    expect(bodyRows()).toHaveLength(50);
    expect(
      screen.getByText(`50 of ${REGISTER.length.toLocaleString("en-CH")} entries`),
    ).toBeInTheDocument();
  });

  it("offers every location with its count, and every published title", () => {
    renderDirectory();
    const location = screen.getByLabelText(en.marketing.directory.location.label);
    expect(within(location).getAllByRole("option").length).toBeGreaterThan(20);
    const level = screen.getByLabelText(en.marketing.directory.level.label);
    // Every title, plus the "every level" option that clears the filter.
    expect(within(level).getAllByRole("option")).toHaveLength(4);
  });

  it("narrows the table to one location and back", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const location = screen.getByLabelText(en.marketing.directory.location.label);
    await user.selectOptions(location, "Japan");
    // Japan carries a handful of entries, so every match fits on the first page.
    const rows = bodyRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
    for (const row of rows) expect(within(row).getByText("Japan")).toBeInTheDocument();

    await user.selectOptions(location, "");
    expect(bodyRows()).toHaveLength(50);
  });

  it("narrows to the entries carrying one published title", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const level = screen.getByLabelText(en.marketing.directory.level.label);
    await user.selectOptions(level, "sme");
    const rows = bodyRows();
    expect(rows.length).toBeGreaterThan(0);
    // The filter matches the title the row shows, so every row reads back the title asked for:
    // a row found under one title must never display another.
    for (const row of rows) {
      expect(within(row).getByText(en.marketing.directory.level.sme)).toBeInTheDocument();
    }
  });

  it("gives the unrated majority a title of their own rather than a competency rating", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const level = screen.getByLabelText(en.marketing.directory.level.label);
    await user.selectOptions(level, "specialist");
    const rows = bodyRows();
    expect(rows).toHaveLength(50);
    // These entries carry no PSM/MOC rating, so no row may claim one.
    for (const row of rows) {
      expect(within(row).getByText(en.marketing.directory.level.specialist)).toBeInTheDocument();
      expect(within(row).queryByText(en.marketing.directory.level.sme)).not.toBeInTheDocument();
      expect(
        within(row).queryByText(en.marketing.directory.level.practitioner),
      ).not.toBeInTheDocument();
    }
  });

  it("searches the name and the town", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const first = REGISTER[0];
    if (!first) throw new Error("the register is empty");

    await user.type(screen.getByLabelText(en.marketing.directory.search.label), first[0]);
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText(first[0])).toBeInTheDocument();
  });

  it("says so when nothing matches, and clears back to the full table", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const search = screen.getByLabelText(en.marketing.directory.search.label);
    await user.type(search, "zzzznobodyzzzz");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(en.marketing.directory.empty)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: en.marketing.directory.clear }));
    expect(bodyRows()).toHaveLength(50);
  });

  it("grows the table by fifty rows when asked for more", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await user.click(screen.getByRole("button", { name: /show 50 more/i }));
    expect(bodyRows()).toHaveLength(100);
  });

  it("shows no contact detail in any row", () => {
    renderDirectory();
    const table = screen.getByRole("table");
    expect(table.textContent ?? "").not.toMatch(/@|https?:\/\/|\+41/);
    expect(within(table).queryByRole("link")).not.toBeInTheDocument();
  });
});
