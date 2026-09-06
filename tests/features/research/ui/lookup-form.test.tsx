import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestResearchData, ResearchActionResult } from "@/features/research/actions";
import { LookupForm } from "@/features/research/ui/lookup-form";
import { COMPANY_ID, deferred, en, RUN_ID, renderWithIntl } from "./helpers";

/**
 * The lookup form (spec 0007, AC-3, AC-9): the name is prefilled from the organization, the
 * website is optional and normalised before the action sees it, the inline rules explain a short
 * name or a bad website next to their field, a success or `company_exists` refreshes the page so
 * the server renders the dashboard, an action error is announced inline, and the button is busy
 * while the action runs. The server action and the router are the boundaries.
 */
type Result = ResearchActionResult<RequestResearchData>;

const boundary = vi.hoisted(() => ({
  requestResearch: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  refresh: vi.fn(),
}));

vi.mock("@/features/research/actions", () => ({ requestResearch: boundary.requestResearch }));
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
    await user.type(screen.getByRole("textbox", { name: labels.website }), "Muster.ch/reports?x=1");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.requestResearch).toHaveBeenCalledTimes(1));
    expect(boundary.requestResearch.mock.calls[0]?.[1]).toEqual({
      name: "Muster AG",
      website: "https://muster.ch",
      locale: "en-CH",
    });
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
  });

  it("sends null for an empty website", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.requestResearch).toHaveBeenCalledTimes(1));
    expect(boundary.requestResearch.mock.calls[0]?.[1]).toMatchObject({ website: null });
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
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.research.errors.company_exists);
  });

  it.each(["run_in_progress", "quota_exceeded", "unexpected", "forbidden"] as const)(
    "announces the %s error inline without refreshing and lets the client try again",
    async (error) => {
      boundary.requestResearch.mockResolvedValue({ ok: false, error });
      const user = userEvent.setup();
      renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
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
    await user.click(screen.getByRole("button", { name: labels.submit }));
    const busy = await screen.findByRole("button", { name: labels.submitting });
    expect(busy).toBeDisabled();
    expect(busy.closest("form")).toHaveAttribute("aria-busy", "true");

    pending.resolve({ ok: true, data: { companyId: COMPANY_ID, runId: RUN_ID } });
    const done = await screen.findByRole("button", { name: labels.submit });
    expect(done).toBeDisabled();
    expect(done.closest("form")).toHaveAttribute("aria-busy", "false");
  });

  it("is reachable by keyboard in order: name, website, submit", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LookupForm organizationName="Muster AG" />, "en-CH");
    await user.tab();
    expect(screen.getByRole("textbox", { name: labels.name })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: labels.website })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: labels.submit })).toHaveFocus();
  });
});
