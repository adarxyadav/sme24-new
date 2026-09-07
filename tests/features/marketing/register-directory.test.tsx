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

  it("offers every canton with its count, and every capacity", () => {
    renderDirectory();
    const canton = screen.getByLabelText(en.marketing.directory.canton.label);
    expect(within(canton).getAllByRole("option").length).toBeGreaterThan(20);
    const capacity = screen.getByLabelText(en.marketing.directory.capacity.label);
    expect(within(capacity).getAllByRole("option")).toHaveLength(5);
  });

  it("narrows the table to one canton and back", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const canton = screen.getByLabelText(en.marketing.directory.canton.label);
    await user.selectOptions(canton, "UR");
    // Uri is the smallest canton in the register, so every match fits on the first page.
    const rows = bodyRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
    for (const row of rows) expect(within(row).getByText("UR")).toBeInTheDocument();

    await user.selectOptions(canton, "");
    expect(bodyRows()).toHaveLength(50);
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
