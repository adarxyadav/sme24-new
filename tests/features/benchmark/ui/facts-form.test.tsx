import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkActionResult, UpdateCompanyFactsData } from "@/features/benchmark/actions";
import { FactsForm } from "@/features/benchmark/ui/facts-form";
import { de, en, renderWithIntl } from "../../emails/ui/helpers";
import { COMPANY_ID } from "./helpers";

/**
 * The company facts form (spec 0008, AC-11): the division and the headcount are prefilled from
 * the company, only a changed field reaches the action so a stored `23.61` is never flattened,
 * an untouched form explains that nothing changed, a bad headcount is explained next to its
 * field, a success announces the recalculation and refreshes the page, a trigger failure
 * announces the fallback, and an action error is announced inline. The server action and the
 * router are the boundaries. The division picker is a Radix select, which jsdom cannot open, so
 * the selected division is asserted on the closed trigger.
 */
type Result = BenchmarkActionResult<UpdateCompanyFactsData>;

const boundary = vi.hoisted(() => ({
  updateCompanyFacts: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  refresh: vi.fn(),
}));

vi.mock("@/features/benchmark/actions", () => ({
  updateCompanyFacts: boundary.updateCompanyFacts,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: boundary.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/app",
  useSearchParams: () => new URLSearchParams(),
}));

const labels = en.benchmark.facts;
const company = { id: COMPANY_ID, industryCode: "23.61", employeesCount: 420 };

beforeEach(() => {
  boundary.updateCompanyFacts.mockResolvedValue({
    ok: true,
    data: { companyId: COMPANY_ID, benchmarkQueued: true },
  });
});

describe("FactsForm (AC-11)", () => {
  it("prefills the division and the headcount from the company and labels both fields", () => {
    renderWithIntl(<FactsForm company={company} />, "en-CH");
    expect(screen.getByRole("combobox", { name: labels.industry })).toHaveTextContent(
      "23 · Manufacture of other non metallic mineral products",
    );
    const headcount = screen.getByRole("spinbutton", { name: labels.employees });
    expect(headcount).toHaveValue(420);
    expect(headcount).toHaveAccessibleDescription(labels.employeesHint);
    expect(screen.getByRole("button", { name: labels.submit })).toBeEnabled();
  });

  it("shows the placeholder and an empty headcount for a company without facts", () => {
    renderWithIntl(
      <FactsForm company={{ id: COMPANY_ID, industryCode: null, employeesCount: null }} />,
      "en-CH",
    );
    expect(screen.getByRole("combobox", { name: labels.industry })).toHaveTextContent(
      labels.industryPlaceholder,
    );
    expect(screen.getByRole("spinbutton", { name: labels.employees })).toHaveValue(null);
  });

  it("sends only the changed headcount, never the untouched division, then announces and refreshes", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FactsForm company={company} />, "en-CH");
    const headcount = screen.getByRole("spinbutton", { name: labels.employees });
    await user.clear(headcount);
    await user.type(headcount, "512");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.updateCompanyFacts).toHaveBeenCalledTimes(1));
    expect(boundary.updateCompanyFacts.mock.calls[0]?.[1]).toEqual({
      companyId: COMPANY_ID,
      industryCode: undefined,
      employeesCount: 512,
      locale: "en-CH",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(labels.saved);
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
  });

  it("sends both fields as undefined when the form is submitted untouched and shows the action's validation answer", async () => {
    boundary.updateCompanyFacts.mockResolvedValue({ ok: false, error: "validation" });
    const user = userEvent.setup();
    renderWithIntl(<FactsForm company={company} />, "en-CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.updateCompanyFacts).toHaveBeenCalledTimes(1));
    expect(boundary.updateCompanyFacts.mock.calls[0]?.[1]).toEqual({
      companyId: COMPANY_ID,
      industryCode: undefined,
      employeesCount: undefined,
      locale: "en-CH",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(en.benchmark.errors.validation);
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("explains a headcount outside 1 to 1 000 000 next to its field", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FactsForm company={company} />, "en-CH");
    const headcount = screen.getByRole("spinbutton", { name: labels.employees });
    await user.clear(headcount);
    await user.type(headcount, "0");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(headcount).toHaveAttribute("aria-invalid", "true"));
    expect(headcount).toHaveAccessibleDescription(labels.validation.employeesInvalid);
    expect(boundary.updateCompanyFacts).not.toHaveBeenCalled();
  });

  it("announces the fallback when the save landed but the recalculation could not be queued", async () => {
    boundary.updateCompanyFacts.mockResolvedValue({
      ok: true,
      data: { companyId: COMPANY_ID, benchmarkQueued: false },
    });
    const user = userEvent.setup();
    renderWithIntl(<FactsForm company={company} />, "en-CH");
    const headcount = screen.getByRole("spinbutton", { name: labels.employees });
    await user.clear(headcount);
    await user.type(headcount, "99");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(labels.savedNotQueued);
    expect(status).toHaveAttribute("data-facts-saved", "false");
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
  });

  it("announces an action error inline and does not refresh", async () => {
    boundary.updateCompanyFacts.mockResolvedValue({ ok: false, error: "not_found" });
    const user = userEvent.setup();
    renderWithIntl(<FactsForm company={company} />, "en-CH");
    const headcount = screen.getByRole("spinbutton", { name: labels.employees });
    await user.clear(headcount);
    await user.type(headcount, "99");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.benchmark.errors.not_found);
    expect(alert).toHaveAttribute("data-error", "not_found");
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("marks the form busy and disables the button while the action runs", async () => {
    let settle: (result: Result) => void = () => {};
    boundary.updateCompanyFacts.mockImplementation(
      () =>
        new Promise<Result>((resolve) => {
          settle = resolve;
        }),
    );
    const user = userEvent.setup();
    const { container } = renderWithIntl(<FactsForm company={company} />, "en-CH");
    const headcount = screen.getByRole("spinbutton", { name: labels.employees });
    await user.clear(headcount);
    await user.type(headcount, "99");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: labels.submitting })).toBeDisabled(),
    );
    expect(container.querySelector("form")).toHaveAttribute("aria-busy", "true");
    settle({ ok: true, data: { companyId: COMPANY_ID, benchmarkQueued: true } });
    await waitFor(() => expect(screen.getByRole("button", { name: labels.submit })).toBeEnabled());
  });

  it("labels everything in German too and sends the German locale", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FactsForm company={company} />, "de-CH");
    const facts = de.benchmark.facts;
    expect(screen.getByRole("combobox", { name: facts.industry })).toBeInTheDocument();
    const headcount = screen.getByRole("spinbutton", { name: facts.employees });
    await user.clear(headcount);
    await user.type(headcount, "99");
    await user.click(screen.getByRole("button", { name: facts.submit }));
    await waitFor(() => expect(boundary.updateCompanyFacts).toHaveBeenCalledTimes(1));
    expect(boundary.updateCompanyFacts.mock.calls[0]?.[1]).toMatchObject({ locale: "de-CH" });
  });
});
