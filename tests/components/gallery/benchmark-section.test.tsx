import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BenchmarkSection } from "@/components/gallery/benchmark-section";
import { en, renderWithIntl } from "../../features/emails/ui/helpers";

/**
 * The benchmark gallery section (spec 0008, AC-14): three quartile bands each with a screen
 * reader sentence, a static opportunity card in the `chfWhole` format and a collapsible
 * disclosure that opens on the trigger, so axe scans every primitive on `/admin/design`.
 */
const labels = en.gallery.benchmark;
const b = en.benchmark;

describe("BenchmarkSection (AC-14)", () => {
  it("shows three bands with a hidden drawing and a screen reader sentence each", () => {
    const { container } = renderWithIntl(<BenchmarkSection />, "en-CH");
    const bands = container.querySelectorAll('[data-slot="quartile-band"]');
    expect(bands).toHaveLength(3);
    for (const value of [30, 58, 68]) {
      expect(
        screen.getByText(`Example: your value ${value} against the peer quartiles.`),
      ).toHaveClass("sr-only");
    }
    for (const svg of container.querySelectorAll('[data-slot="quartile-band"] svg')) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.getByText(labels.bandTop)).toBeInTheDocument();
    expect(screen.getByText(labels.bandBelow)).toBeInTheDocument();
    expect(screen.getByText(labels.bandOutside)).toBeInTheDocument();
  });

  it("renders the opportunity card with the headline, the range, the savings and the compared line", () => {
    renderWithIntl(<BenchmarkSection />, "en-CH");
    expect(screen.getByText(b.card.title)).toBeInTheDocument();
    expect(screen.getByText(/CHF\s?1.961.000/)).toBeInTheDocument();
    expect(screen.getByText(/^Range CHF\s?1.060.000 to CHF\s?2.651.000$/)).toBeInTheDocument();
    expect(screen.getByText(b.card.savingMedian)).toBeInTheDocument();
    expect(screen.getByText(b.card.savingTop)).toBeInTheDocument();
    expect(screen.getByText("5 of 8 KPIs compared")).toBeInTheDocument();
    expect(screen.getByText("Computed on 06.09.2026")).toBeInTheDocument();
  });

  it("keeps the disclosure closed and opens it on the trigger", async () => {
    const user = userEvent.setup();
    renderWithIntl(<BenchmarkSection />, "en-CH");
    const trigger = screen.getByRole("button", { name: b.disclosure.title });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(b.disclosure.fteLine)).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(b.disclosure.fteLine)).toBeVisible();
  });

  it("labels each example so the gallery reads as a list of named blocks", () => {
    renderWithIntl(<BenchmarkSection />, "en-CH");
    const card = screen.getByText(labels.card);
    expect(within(card.parentElement as HTMLElement).getByText(b.card.title)).toBeInTheDocument();
    expect(screen.getByText(labels.collapsible)).toBeInTheDocument();
  });
});
