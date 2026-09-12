import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssessmentsSection } from "@/components/gallery/assessments-section";
import { en, renderWithIntl } from "../../features/emails/ui/helpers";

/**
 * The assessments gallery section (spec 0019, AC-13): the rating control in its unrated, chosen
 * and read only states and the save indicator in every state, so axe scans both on `/admin/design`.
 */
const labels = en.gallery;
const ratings = en.assessments.ratings;

describe("AssessmentsSection (AC-13)", () => {
  it("shows three rating controls: unrated, chosen and disabled, each named by its own caption", () => {
    renderWithIntl(<AssessmentsSection />, "en-CH");
    const groups = screen.getAllByRole("radiogroup");
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.getAttribute("aria-labelledby"))).toEqual([
      "gallery-rating-ratingUnrated",
      "gallery-rating-ratingChosen",
      "gallery-rating-ratingDisabled",
    ]);
    const [unrated, chosen, disabled] = groups as [HTMLElement, HTMLElement, HTMLElement];
    for (const radio of within(unrated).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
    expect(within(chosen).getByRole("radio", { name: ratings.partial })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    for (const radio of within(disabled).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(within(disabled).getByRole("radio", { name: ratings.compliant })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("lets the live examples change on a click", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AssessmentsSection />, "en-CH");
    const unrated = screen.getAllByRole("radiogroup")[0] as HTMLElement;
    await user.click(within(unrated).getByRole("radio", { name: ratings.non_compliant }));
    expect(within(unrated).getByRole("radio", { name: ratings.non_compliant })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows the save indicator in its five states with a retry on the failed one", () => {
    renderWithIntl(<AssessmentsSection />, "en-CH");
    const indicators = screen.getAllByRole("status");
    expect(indicators.map((indicator) => indicator.getAttribute("data-state"))).toEqual([
      "idle",
      "pending",
      "saving",
      "saved",
      "failed",
    ]);
    expect(screen.getByRole("button", { name: en.assessments.save.retry })).toBeInTheDocument();
    expect(screen.getByText(/^Saved \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("labels both examples so the gallery reads as named blocks", () => {
    renderWithIntl(<AssessmentsSection />, "en-CH");
    expect(screen.getByText(labels.ratingControl)).toBeInTheDocument();
    expect(screen.getByText(labels.saveIndicator)).toBeInTheDocument();
    expect(screen.getByText(labels.saveFailed)).toBeInTheDocument();
  });
});
