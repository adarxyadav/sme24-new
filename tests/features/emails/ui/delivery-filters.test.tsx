import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeliveryFilterForm } from "@/features/emails/ui/delivery-filters";
import { de, en, renderWithIntl } from "./helpers";

/**
 * The filter form of `/admin/emails` (spec 0006, AC-9): a plain GET form so the URL carries the
 * state, every control labelled, the current filters preselected, a submit and a reset link, all
 * reachable by keyboard in reading order. The App Router hooks are the boundary.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: "de-CH" }),
  usePathname: () => "/de/admin/emails",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

describe("DeliveryFilterForm (AC-9)", () => {
  it("is a GET form with labelled status, template and search controls", () => {
    const { container } = renderWithIntl(<DeliveryFilterForm filters={{}} />);
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("group", { name: de.emails.filters.legend })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: de.emails.filters.status })).toHaveTextContent(
      de.emails.filters.all,
    );
    expect(screen.getByRole("combobox", { name: de.emails.filters.template })).toHaveTextContent(
      de.emails.filters.all,
    );
    const search = screen.getByRole("searchbox", { name: de.emails.filters.search });
    expect(search).toHaveAttribute("name", "q");
    expect(search).toHaveValue("");
    expect(search).toHaveAttribute("placeholder", de.emails.filters.searchPlaceholder);
  });

  it("preselects the current filters and carries them as form fields", () => {
    const { container } = renderWithIntl(
      <DeliveryFilterForm filters={{ status: "failed", template: "welcome", q: "clara" }} />,
    );
    expect(screen.getByRole("combobox", { name: de.emails.filters.status })).toHaveTextContent(
      de.emails.status.failed,
    );
    expect(screen.getByRole("combobox", { name: de.emails.filters.template })).toHaveTextContent(
      "welcome",
    );
    expect(screen.getByRole("searchbox", { name: de.emails.filters.search })).toHaveValue("clara");
    expect(container.querySelector('select[name="status"]')).toHaveValue("failed");
    expect(container.querySelector('select[name="template"]')).toHaveValue("welcome");
  });

  it("submits with the apply button and resets through a link to the bare list", () => {
    renderWithIntl(<DeliveryFilterForm filters={{ status: "sent" }} />);
    expect(screen.getByRole("button", { name: de.emails.filters.apply })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.getByRole("link", { name: de.emails.filters.reset })).toHaveAttribute(
      "href",
      "/de/admin/emails",
    );
  });

  it("labels everything in English too", () => {
    renderWithIntl(<DeliveryFilterForm filters={{}} />, "en-CH");
    expect(screen.getByRole("combobox", { name: en.emails.filters.status })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: en.emails.filters.search })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.emails.filters.apply })).toBeInTheDocument();
  });

  it("is reachable by Tab in reading order: status, template, search, apply, reset", async () => {
    const user = userEvent.setup();
    renderWithIntl(<DeliveryFilterForm filters={{}} />);
    await user.tab();
    expect(screen.getByRole("combobox", { name: de.emails.filters.status })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: de.emails.filters.template })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("searchbox", { name: de.emails.filters.search })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: de.emails.filters.apply })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: de.emails.filters.reset })).toHaveFocus();
  });
});
