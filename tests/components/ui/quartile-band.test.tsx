import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuartileBand } from "@/components/ui/quartile-band";

/**
 * The quartile band (spec 0008, AC-14): the drawing is decorative and hidden from assistive
 * technology, the `sr-only` sentence carries the meaning, the bar spans p25 to p75 with the
 * median tick inside it, the company marker sits to the left of the bar for a value below p25
 * and to the right for one beyond p75, and degenerate quartiles never produce a NaN coordinate.
 */
const LABEL =
  "LTIFR: your value 2.40 is in the band Top quarter. Peer quartiles: p25 1.00, median 2.00, p75 4.00.";

function renderBand(value: number, quartiles: [number, number, number] = [34.9, 49.9, 66.4]) {
  const [p25, median, p75] = quartiles;
  const { container } = render(
    <QuartileBand p25={p25} median={median} p75={p75} value={value} label={LABEL} />,
  );
  const svg = container.querySelector("svg") as SVGSVGElement;
  const bar = svg.querySelector("rect") as SVGRectElement;
  const [, medianTick] = Array.from(svg.querySelectorAll("line"));
  const marker = svg.querySelector("circle") as SVGCircleElement;
  const x = (element: Element, attribute: string) => Number(element.getAttribute(attribute));
  return {
    svg,
    barFrom: x(bar, "x"),
    barTo: x(bar, "x") + x(bar, "width"),
    median: x(medianTick as Element, "x1"),
    marker: x(marker, "cx"),
  };
}

describe("QuartileBand (AC-14)", () => {
  it("hides the drawing from assistive technology and names the band in a screen reader only sentence", () => {
    const { svg } = renderBand(58);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(LABEL)).toHaveClass("sr-only");
  });

  it("exposes the four numbers as data attributes for the browser thread", () => {
    const { svg } = renderBand(58);
    expect(svg).toHaveAttribute("data-value", "58");
    expect(svg).toHaveAttribute("data-p25", "34.9");
    expect(svg).toHaveAttribute("data-median", "49.9");
    expect(svg).toHaveAttribute("data-p75", "66.4");
  });

  it("draws the median tick inside the bar and the marker inside it for a value between the quartiles", () => {
    const band = renderBand(58);
    expect(band.median).toBeGreaterThan(band.barFrom);
    expect(band.median).toBeLessThan(band.barTo);
    expect(band.marker).toBeGreaterThan(band.barFrom);
    expect(band.marker).toBeLessThan(band.barTo);
  });

  it("puts the marker left of the bar for a value below p25 and right of it beyond p75", () => {
    expect(renderBand(30).marker).toBeLessThan(renderBand(30).barFrom);
    const beyond = renderBand(80);
    expect(beyond.marker).toBeGreaterThan(beyond.barTo);
  });

  it("keeps every coordinate finite when the three quartiles and the value coincide", () => {
    const flat = renderBand(0.3, [0.3, 0.3, 0.3]);
    for (const coordinate of [flat.barFrom, flat.barTo, flat.median, flat.marker]) {
      expect(Number.isFinite(coordinate)).toBe(true);
    }
    expect(flat.barTo - flat.barFrom).toBeGreaterThanOrEqual(2);
  });

  it("merges a caller's class on the wrapper", () => {
    const { container } = render(
      <QuartileBand p25={1} median={2} p75={4} value={2.4} label={LABEL} className="mt-2" />,
    );
    expect(container.querySelector('[data-slot="quartile-band"]')).toHaveClass("mt-2");
  });
});
