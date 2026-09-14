import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenchmarkSection } from "@/components/gallery/benchmark-section";
import { en, renderWithIntl } from "../../features/emails/ui/helpers";

/**
 * The benchmark gallery section (spec 0008, AC-14; spec 0022, AC-20, AC-21): three quartile bands
 * each with a screen reader sentence, the one merged peer table in its three row shapes, and the
 * loss card's headline with its derived counts, so axe scans each of them on `/admin/design`. The
 * opportunity card, the point comparison and the Peer Standing card went with the cost model and
 * the curated library (spec 0022, AC-12).
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

  it("shows the peer table with a published row, a row without a headcount and the client's own", () => {
    const { container } = renderWithIntl(<BenchmarkSection />, "en-CH");
    expect(screen.getByText(labels.peerTable)).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(screen.getByText(b.peers.table.noHeadcount)).toBeInTheDocument();
    expect(screen.getByText(b.peers.table.you)).toBeInTheDocument();
    expect(screen.getByText(b.peers.footnote)).toBeInTheDocument();
  });

  it("shows the loss card's headline and its three counts, each Calculated", () => {
    renderWithIntl(<BenchmarkSection />, "en-CH");
    expect(screen.getByText(labels.lossCard)).toBeInTheDocument();
    expect(screen.getAllByText(b.loss.counts.calculated)).toHaveLength(3);
  });
});
