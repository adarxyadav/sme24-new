import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestResearchData, ResearchActionResult } from "@/features/research/actions";
import { LookupForm } from "@/features/research/ui/lookup-form";
import { COMPANY_ID, deferred, en, pickCountry, RUN_ID, renderWithIntl } from "./helpers";

/**
 * The lookup form (spec 0007, AC-3, AC-9): the name is prefilled from the organization, the
 * website is optional and normalised before the action sees it, the inline rules explain a short
 * name or a bad website next to their field, a success or `company_exists` either refreshes the
 * page or goes to that company's own page (`redirectToCompany`), an action error is announced
 * inline, and the button is busy while the action runs. The server action and the router are the
 * boundaries.
 */
type Result = ResearchActionResult<RequestResearchData>;

const boundary = vi.hoisted(() => ({
  requestResearch: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/features/research/actions", () => ({ requestResearch: boundary.requestResearch }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: boundary.push, refresh: boundary.refresh }),
}));

const labels = en.research.lookup;

beforeEach(() => {
  boundary.requestResearch.mockResolvedValue({
    ok: true,
    data: { companyId: COMPANY_ID, runId: RUN_ID },
  });
});

describe("LookupForm (AC-3)", () => {
  it("prefills the name from the organization and labels both fields", () => {
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    const name = screen.getByRole("textbox", { name: labels.name });
    expect(name).toHaveValue("Muster AG");
    const website = screen.getByRole("textbox", { name: labels.website });
    expect(website).toHaveValue("");
    expect(website).toHaveAccessibleDescription(labels.websiteHint);
    expect(screen.getByRole("button", { name: labels.submit })).toBeEnabled();
  });

  it("submits the trimmed name, the normalised website and the locale, then refreshes the page", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await pickCountry(user, labels.country, "CH");
    await user.type(screen.getByRole("textbox", { name: labels.website }), "Muster.ch/reports?x=1");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.requestResearch).toHaveBeenCalledTimes(1));
    expect(boundary.requestResearch.mock.calls[0]?.[1]).toEqual({
      name: "Muster AG",
      country: "CH",
      website: "https://muster.ch",
      locale: "en-CH",
    });
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
  });

  it("sends null for an empty website", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await pickCountry(user, labels.country, "CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.requestResearch).toHaveBeenCalledTimes(1));
    expect(boundary.requestResearch.mock.calls[0]?.[1]).toMatchObject({ website: null });
  });

  it("refuses to submit without a country and names the rule next to the select (spec 0022, AC-1)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    const country = screen.getByRole("combobox", { name: labels.country });
    // Nothing is preselected: no CH standing in for a choice the client did not make.
    expect(country).toHaveTextContent(labels.countryPlaceholder);
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(country).toHaveAttribute("aria-invalid", "true"));
    expect(country).toHaveAccessibleDescription(en.research.validation.countryRequired);
    expect(boundary.requestResearch).not.toHaveBeenCalled();
  });

  it("offers every country, Europe first, named in the page locale (spec 0022, AC-1, AC-2)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await user.click(screen.getByRole("combobox", { name: labels.country }));
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(249);
    // The names come from the runtime, not from a message key, and the 32 European codes lead.
    const names = options.map((option) => option.textContent);
    expect(names.slice(0, 32)).toContain("Switzerland");
    expect(names.slice(0, 32)).not.toContain("Japan");
    expect(names).toContain("Japan");
    expect(names).toContain("Brazil");
  });

  it("explains a too short name next to its field and does not call the action", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="" />, "en-CH");
    await user.type(screen.getByRole("textbox", { name: labels.name }), "A");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    const name = await screen.findByRole("textbox", { name: labels.name });
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(name).toHaveAccessibleDescription(en.research.validation.nameShort);
    expect(boundary.requestResearch).not.toHaveBeenCalled();
  });

  it("explains an invalid website next to its field", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await user.type(screen.getByRole("textbox", { name: labels.website }), "??");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    const website = screen.getByRole("textbox", { name: labels.website });
    await waitFor(() => expect(website).toHaveAttribute("aria-invalid", "true"));
    expect(website).toHaveAccessibleDescription(en.research.validation.websiteInvalid);
    expect(boundary.requestResearch).not.toHaveBeenCalled();
  });

  it("refreshes the page when the company already exists so the dashboard renders", async () => {
    boundary.requestResearch.mockResolvedValue({
      ok: false,
      error: "company_exists",
      companyId: COMPANY_ID,
    });
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await pickCountry(user, labels.country, "CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.research.errors.company_exists);
  });

  it("goes to the new company's own page with redirectToCompany, instead of refreshing", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="" redirectToCompany />, "en-CH");
    await user.type(screen.getByRole("textbox", { name: labels.name }), "Muster AG");
    await pickCountry(user, labels.country, "CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() =>
      expect(boundary.push).toHaveBeenCalledWith({
        pathname: "/app/companies/[companyId]",
        params: { companyId: COMPANY_ID },
      }),
    );
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("goes to the company a double submit created first, so company_exists still lands somewhere", async () => {
    boundary.requestResearch.mockResolvedValue({
      ok: false,
      error: "company_exists",
      companyId: COMPANY_ID,
    });
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" redirectToCompany />, "en-CH");
    await pickCountry(user, labels.country, "CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() =>
      expect(boundary.push).toHaveBeenCalledWith({
        pathname: "/app/companies/[companyId]",
        params: { companyId: COMPANY_ID },
      }),
    );
  });

  it.each(["run_in_progress", "quota_exceeded", "unexpected", "forbidden"] as const)(
    "announces the %s error inline without refreshing and lets the client try again",
    async (error) => {
      boundary.requestResearch.mockResolvedValue({ ok: false, error });
      const user = userEvent.setup();
      renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
      await pickCountry(user, labels.country, "CH");
      await user.click(screen.getByRole("button", { name: labels.submit }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveAttribute("data-error", error);
      expect(boundary.refresh).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: labels.submit })).toBeEnabled();
    },
  );

  it("is busy and disabled while the action runs, then stays disabled after a success", async () => {
    const pending = deferred<RequestResearchData>();
    boundary.requestResearch.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await pickCountry(user, labels.country, "CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    const busy = await screen.findByRole("button", { name: labels.submitting });
    expect(busy).toBeDisabled();
    expect(busy.closest("form")).toHaveAttribute("aria-busy", "true");

    pending.resolve({ ok: true, data: { companyId: COMPANY_ID, runId: RUN_ID } });
    const done = await screen.findByRole("button", { name: labels.submit });
    expect(done).toBeDisabled();
    expect(done.closest("form")).toHaveAttribute("aria-busy", "false");
  });

  it("is reachable by keyboard in order: name, country, website, submit", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await user.tab();
    expect(screen.getByRole("textbox", { name: labels.name })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: labels.country })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: labels.website })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: labels.submit })).toHaveFocus();
  });
});
