import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RerunResearchData, ResearchActionResult } from "@/features/research/actions";
import { RerunForm } from "@/features/research/ui/rerun-form";
import { COMPANY_ID, en, RUN_ID, renderWithIntl } from "./helpers";

/**
 * The edit and rerun form (spec 0007, AC-8): prefilled with the company's editable details (the
 * website shown without its scheme), an empty legal name sent as null, the button disabled and
 * explained while a run is open or the quota is used up, a success refreshing the page, and the
 * `not_found` answer announced inline. The server action and the router are the boundaries.
 */
type Result = ResearchActionResult<RerunResearchData>;

const boundary = vi.hoisted(() => ({
  rerunResearch: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  refresh: vi.fn(),
}));

vi.mock("@/features/research/actions", () => ({ rerunResearch: boundary.rerunResearch }));
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

const labels = en.research.rerun;
const company = {
  id: COMPANY_ID,
  name: "Muster AG",
  legalName: null,
  website: "https://www.muster.ch",
};

beforeEach(() => {
  boundary.rerunResearch.mockResolvedValue({ ok: true, data: { runId: RUN_ID } });
});

describe("RerunForm (AC-8)", () => {
  it("prefills the details, showing the website without its scheme", () => {
    renderWithIntl(<RerunForm company={company} blocked={null} />, "en-CH");
    expect(screen.getByRole("textbox", { name: labels.name })).toHaveValue("Muster AG");
    expect(screen.getByRole("textbox", { name: labels.legalName })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: labels.website })).toHaveValue("www.muster.ch");
    expect(screen.getByRole("button", { name: labels.submit })).toBeEnabled();
  });

  it("submits the company id, the edited details with a null legal name and the normalised website, then refreshes", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RerunForm company={company} blocked={null} />, "en-CH");
    const name = screen.getByRole("textbox", { name: labels.name });
    await user.clear(name);
    await user.type(name, "Muster Holding");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.rerunResearch).toHaveBeenCalledTimes(1));
    expect(boundary.rerunResearch.mock.calls[0]?.[1]).toEqual({
      companyId: COMPANY_ID,
      name: "Muster Holding",
      legalName: null,
      website: "https://www.muster.ch",
      locale: "en-CH",
    });
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
  });

  it("sends a typed legal name", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RerunForm company={company} blocked={null} />, "en-CH");
    await user.type(screen.getByRole("textbox", { name: labels.legalName }), "Muster Holding AG");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.rerunResearch).toHaveBeenCalledTimes(1));
    expect(boundary.rerunResearch.mock.calls[0]?.[1]).toMatchObject({
      legalName: "Muster Holding AG",
    });
  });

  it.each([
    ["open", labels.blockedOpen],
    ["quota", labels.blockedQuota],
  ] as const)("disables the button while blocked by %s and explains why", (blocked, reason) => {
    renderWithIntl(<RerunForm company={company} blocked={blocked} />, "en-CH");
    const button = screen.getByRole("button", { name: labels.submit });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(reason);
  });

  it("explains a too long legal name next to its field without calling the action", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RerunForm company={company} blocked={null} />, "en-CH");
    const legalName = screen.getByRole("textbox", { name: labels.legalName });
    await user.click(legalName);
    await user.paste("x".repeat(201));
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(legalName).toHaveAttribute("aria-invalid", "true"));
    expect(legalName).toHaveAccessibleDescription(en.research.validation.legalNameLong);
    expect(boundary.rerunResearch).not.toHaveBeenCalled();
  });

  it("announces not_found inline and leaves the form usable", async () => {
    boundary.rerunResearch.mockResolvedValue({ ok: false, error: "not_found" });
    const user = userEvent.setup();
    renderWithIntl(<RerunForm company={company} blocked={null} />, "en-CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.research.errors.not_found);
    expect(boundary.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: labels.submit })).toBeEnabled();
  });

  it("stays disabled after a successful rerun until the page re renders", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RerunForm company={company} blocked={null} />, "en-CH");
    await user.click(screen.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: labels.submit })).toBeDisabled();
  });
});
