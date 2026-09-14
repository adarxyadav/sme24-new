import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenchmarkSection } from "@/components/gallery/benchmark-section";
import { en, renderWithIntl } from "../../features/emails/ui/helpers";

/**
 * The benchmark gallery section (spec 0008, AC-14): three quartile bands each with a screen reader
 * sentence and the point comparison beside them, so axe scans both on `/admin/design`. The
 * opportunity card went with the cost model (spec 0022, AC-12) and the peer table, the loss card
 * and the package card join this section with the page itself.
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

  it("shows the point comparison, which gets no band and no replacement graphic", () => {
    renderWithIntl(<BenchmarkSection />, "en-CH");
    expect(screen.getByText(labels.pointComparison)).toBeInTheDocument();
    expect(screen.getByText(b.positions.band.above_average)).toBeInTheDocument();
    expect(screen.getByText(b.positions.pointBasis)).toBeInTheDocument();
  });
});
