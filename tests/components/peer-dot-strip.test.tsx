import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, describe, expect, it } from "vitest";
import { PeerDotStrip, stripDomain } from "@/components/ui/peer-dot-strip";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { en } from "../features/research/ui/helpers";

/**
 * The peer dot strip (spec 0012, AC-12): the axis domain spans the peers, the band and the
 * client with padding so an outlier stays visible, the chart is hidden from assistive tech while
 * a table of the same values is exposed, the direction of better is marked, and axe finds no
 * violation.
 */
afterAll(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

const peers = [1.2, 2.4, 3.1, 3.1, 5.6, 8.9].map((value, index) => ({
  label: `Peer ${String.fromCharCode(65 + index)}`,
  value,
  formatted: value.toFixed(2),
}));
const labels = {
  caption: "LTIFR: your value 3.10 against 6 named peers, better than 50% of them.",
  peer: "Peer",
  value: "Value",
  you: "Your company",
  band: "Industry p25 to p75",
  better: "Lower is better",
  legendBand: "Industry p25 to p75",
  legendPeers: "Named peers",
  legendYou: "Your company",
};

function renderStrip(overrides: Partial<React.ComponentProps<typeof PeerDotStrip>> = {}) {
  return render(
    <NextIntlClientProvider locale="en-CH" messages={en} formats={formats} timeZone={TIME_ZONE}>
      <PeerDotStrip
        peers={peers}
        client={{ label: "Your company", value: 3.1, formatted: "3.10" }}
        band={{ p25: 1, p75: 4, p25Formatted: "1.00", p75Formatted: "4.00" }}
        direction="lower_is_better"
        labels={labels}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("stripDomain (AC-12)", () => {
  it("spans the smallest and largest of peers, band and client, padded on both ends", () => {
    const [low, high] = stripDomain(peers, 3.1, { p25: 1, p75: 4 });
    expect(low).toBeLessThan(1);
    expect(high).toBeGreaterThan(8.9);
    // The same padding on both ends: 8 % of the span from 1 to 8.9.
    expect(high - 8.9).toBeCloseTo(1 - low, 5);
    expect(high - 8.9).toBeCloseTo((8.9 - 1) * 0.08, 5);
  });

  it("keeps a client outside the band and the peers inside the domain", () => {
    const [low, high] = stripDomain(peers, 20, { p25: 1, p75: 4 });
    expect(low).toBeLessThan(1.2);
    expect(high).toBeGreaterThan(20);
  });

  it("does not collapse when every value is the same", () => {
    const [low, high] = stripDomain([{ value: 2 }, { value: 2 }], 2, null);
    expect(high).toBeGreaterThan(low);
  });
});

describe("PeerDotStrip (AC-12)", () => {
  it("exposes a table of every peer, the client and the band, and hides the drawing", () => {
    const { container } = renderStrip();
    const table = screen.getByRole("table", { name: labels.caption });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(1 + peers.length + 2);
    expect(within(table).getByRole("rowheader", { name: "Peer F" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "8.90" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Your company" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "1.00 – 4.00" })).toBeInTheDocument();
    const chart = container.querySelector("[data-slot=chart]");
    expect(chart?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector("[data-slot=peer-dot-strip]")).toHaveAttribute(
      "data-peers",
      "6",
    );
  });

  it("draws one dot per peer, the client marker and the band", () => {
    const { container } = renderStrip();
    expect(container.querySelectorAll(".recharts-scatter-symbol")).toHaveLength(peers.length + 1);
    expect(container.querySelector(".recharts-reference-area")).not.toBeNull();
  });

  it("marks the direction of better and omits the band row without statistics", () => {
    renderStrip({
      direction: "higher_is_better",
      band: null,
      labels: { ...labels, better: "Higher is better" },
    });
    expect(screen.getByText("Higher is better")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).queryByRole("rowheader", { name: labels.band })).toBeNull();
  });

  it("leaves nothing focusable inside the hidden drawing", () => {
    // Recharts' accessibility layer renders a `tabindex="0"` surface. Inside an `aria-hidden`
    // wrapper that is a keyboard trap on an element assistive tech cannot see (axe
    // `aria-hidden-focus`), so the drawing must expose no tabbable node at all.
    const { container } = renderStrip();
    const hidden = container.querySelector("[aria-hidden='true']");
    expect(hidden).not.toBeNull();
    const focusable = hidden?.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable?.length ?? 0).toBe(0);
  });

  it("has no axe violations", async () => {
    const { container } = renderStrip();
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
