import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DataRequestFilters } from "@/features/legal/schema";
import { navigationMock, renderWithIntl, stubRadixEnvironment } from "./helpers";

/**
 * The status filter of `/admin/data-requests` (spec 0015, AC-13).
 *
 * A plain GET form rather than a client side filter, so the URL carries the state: a reload, a
 * bookmark or a link shared with a colleague all show the same list. That is the property asserted
 * here, because it is the one a well meaning refactor to `useState` would quietly remove.
 */
vi.mock("next/navigation", () => navigationMock());

stubRadixEnvironment();

const { DataRequestFilterForm } = await import("@/features/legal/ui/data-request-filters");

const renderFilters = (filters: DataRequestFilters = { status: "open" }) =>
  renderWithIntl(<DataRequestFilterForm filters={filters} />, "en-CH");

const select = () => screen.getByRole("combobox", { name: "Status" });

describe("the filter form (AC-13)", () => {
  it("submits as a GET, so the choice lands in the URL", () => {
    const { container } = renderFilters();
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "get");
  });

  it("names the select `status`, the parameter the page parses", () => {
    const { container } = renderFilters();
    // Radix renders a hidden native select carrying the name a GET submit serialises.
    expect(container.querySelector('select[name="status"]')).not.toBeNull();
  });

  it("shows the filter that is actually applied, not a fixed default", () => {
    renderFilters({ status: "fulfilled" });
    expect(select()).toHaveTextContent("Fulfilled");
  });

  it("shows the open queue as the default view", () => {
    renderFilters();
    expect(select()).toHaveTextContent("Open");
  });

  it("offers the open queue first, then the four statuses, then all", async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.click(select());
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent?.trim()),
    ).toEqual(["Open", "New", "In progress", "Fulfilled", "Refused", "All"]);
  });

  it("offers a submit that applies the choice", () => {
    renderFilters();
    expect(screen.getByRole("button", { name: "Apply" })).toHaveAttribute("type", "submit");
  });

  it("labels the group and the control, so the select is not an unnamed combobox", () => {
    renderFilters();
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
    expect(select()).toBeInTheDocument();
  });

  it("renders in German too", () => {
    renderWithIntl(<DataRequestFilterForm filters={{ status: "open" }} />, "de-CH");
    expect(screen.getByRole("button", { name: "Anwenden" })).toBeInTheDocument();
  });
});
