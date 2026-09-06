import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResearchErrorAlert } from "@/features/research/ui/research-error-alert";
import { EnglishIntl, en, renderWithIntl } from "./helpers";

/**
 * The inline error of a research action (spec 0007, AC-9): nothing for no result or a success,
 * an alert with the mapped message per error code, the quota message carrying the daily limit.
 */
describe("ResearchErrorAlert (AC-9)", () => {
  it("renders nothing without a result or after a success", () => {
    const { rerender } = render(<ResearchErrorAlert result={null} />, { wrapper: EnglishIntl });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<ResearchErrorAlert result={{ ok: true, data: {} }} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["validation", "forbidden", "not_found", "run_in_progress", "unexpected"] as const)(
    "announces the %s message as an alert",
    (error) => {
      renderWithIntl(<ResearchErrorAlert result={{ ok: false, error }} />, "en-CH");
      const alert = screen.getByRole("alert");
      expect(alert).toHaveAttribute("data-error", error);
      expect(alert).toHaveTextContent(en.research.errors[error]);
    },
  );

  it("names the daily limit in the quota message", () => {
    renderWithIntl(<ResearchErrorAlert result={{ ok: false, error: "quota_exceeded" }} />, "en-CH");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The daily limit of 5 runs has been reached.",
    );
  });

  it("explains company_exists in German too", () => {
    renderWithIntl(
      <ResearchErrorAlert result={{ ok: false, error: "company_exists", companyId: "x" }} />,
      "de-CH",
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-error", "company_exists");
  });
});
