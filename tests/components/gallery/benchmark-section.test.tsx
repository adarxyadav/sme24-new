import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenchmarkSection } from "@/components/gallery/benchmark-section";
import { en, renderWithIntl } from "../../features/emails/ui/helpers";

/**
 * The benchmark gallery section (spec 0008, AC-14): three quartile bands each with a screen
 * reader sentence and a static opportunity card in the `chfWhole` format, so axe scans every
 * primitive on `/admin/design`.
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

  it("renders the opportunity card with the spelled out confidence, the range, the working estimate and both saving shapes", () => {
    renderWithIntl(<BenchmarkSection />, "en-CH");
    expect(screen.getByText(b.card.title)).toBeInTheDocument();
    expect(screen.getByText(b.card.confidence.medium)).toBeInTheDocument();
    expect(screen.getByText(/^CHF\s?1.060.000 to CHF\s?2.651.000$/)).toBeInTheDocument();
    // The amounts sit in their own span, so the sentence is read from the enclosing element.
    expect(screen.getByText(/CHF\s?1.961.000/).closest("p")).toHaveTextContent(
      /^Working estimate CHF\s?1.961.000 a year, from about 1.8 lost time injuries across 420 employees\.$/,
    );
    expect(screen.getByText(b.card.savingMedian)).toBeInTheDocument();
    expect(screen.getByText(/CHF\s?522.000/).closest("dd")).toHaveTextContent(
      /^CHF\s?522.000 a year$/,
    );
    expect(screen.getByText(b.card.savingTop)).toBeInTheDocument();
    expect(screen.getByText(b.card.atOrBelow)).toBeInTheDocument();
  });

  it("labels each example so the gallery reads as a list of named blocks", () => {
    renderWithIntl(<BenchmarkSection />, "en-CH");
    const card = screen.getByText(labels.card);
    expect(within(card.parentElement as HTMLElement).getByText(b.card.title)).toBeInTheDocument();
  });
});
