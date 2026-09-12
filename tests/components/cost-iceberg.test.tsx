import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CostIceberg,
  clipAtLine,
  ICEBERG_OUTLINE,
  openPath,
  polygonArea,
  splitIceberg,
  waterlineFor,
} from "@/components/cost-iceberg";
import de from "../../messages/de-CH.json";
import en from "../../messages/en-CH.json";

/**
 * The cost iceberg (the client review of 2026-09-11, win 9): the drawing is decorative and hidden
 * from assistive technology with its labels, the `sr-only` sentence carries the meaning, the two
 * halves are cut from one silhouette at the height the shares demand (four to one for 20 and
 * 80), the waterline is the only stroke shared by the halves, and nothing on it weighs more than
 * the body copy. The catalogue cases keep the words on the page in step with the seeded figures.
 */
const LABEL =
  "An iceberg: the visible costs, at least 20 percent, sit above the waterline; the hidden costs, up to 80 percent, sit below it.";

function renderIceberg(visibleShare = 20, hiddenShare = 80) {
  const { container } = render(
    <CostIceberg
      visible={{ share: visibleShare, title: "Visible costs", figure: "At least 20 percent" }}
      hidden={{ share: hiddenShare, title: "Hidden costs", figure: "Up to 80 percent" }}
      label={LABEL}
    />,
  );
  return {
    container,
    root: container.querySelector('[data-slot="cost-iceberg"]') as HTMLElement,
    figure: container.querySelector("[aria-hidden]") as HTMLElement,
    svgs: Array.from(container.querySelectorAll("svg")),
  };
}

describe("CostIceberg geometry (pure)", () => {
  it("cuts the silhouette so the mass holds four times the tip's area for 20 and 80", () => {
    const { tip, mass, waterline } = splitIceberg(20, 80);
    const ratio = polygonArea(mass) / polygonArea(tip);
    expect(ratio).toBeGreaterThan(3.95);
    expect(ratio).toBeLessThan(4.05);
    expect(polygonArea(tip) + polygonArea(mass)).toBeCloseTo(polygonArea(ICEBERG_OUTLINE), 0);
    // The line sits inside the silhouette, so both halves exist as drawings.
    expect(waterline).toBeGreaterThan(0);
    expect(waterline).toBeLessThan(400);
  });

  it("follows the shares it is given rather than a fixed picture", () => {
    const even = splitIceberg(50, 50);
    expect(polygonArea(even.tip) / polygonArea(even.mass)).toBeCloseTo(1, 1);
    const third = splitIceberg(25, 75);
    expect(polygonArea(third.mass) / polygonArea(third.tip)).toBeCloseTo(3, 1);
    expect(third.waterline).toBeGreaterThan(splitIceberg(20, 80).waterline);
  });

  it("keeps every vertex finite and every crossing on the line", () => {
    const line = waterlineFor(ICEBERG_OUTLINE, 0.2);
    for (const side of ["above", "below"] as const) {
      const half = clipAtLine(ICEBERG_OUTLINE, line, side);
      expect(half.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of half) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(side === "above" ? y <= line + 0.001 : y >= line - 0.001).toBe(true);
      }
      expect(half.filter(([, y]) => Math.abs(y - line) < 0.001)).toHaveLength(2);
    }
  });

  it("draws each half as an open path that starts and ends on the waterline", () => {
    const { tip, mass, waterline } = splitIceberg(20, 80);
    for (const half of [tip, mass]) {
      const path = openPath(half, waterline);
      const points = path.split(/\s(?=[ML])/).map((part) => part.slice(1).split(" ").map(Number));
      expect(points[0]?.[1]).toBeCloseTo(waterline, 1);
      expect(points.at(-1)?.[1]).toBeCloseTo(waterline, 1);
      // Only the two ends touch the line: the water edge itself is never stroked.
      expect(points.filter(([, y]) => Math.abs((y ?? 0) - waterline) < 0.01)).toHaveLength(2);
      expect(path.endsWith("Z")).toBe(false);
    }
  });

  it("answers a half and half split when both shares are zero", () => {
    const { tip, mass } = splitIceberg(0, 0);
    expect(polygonArea(tip) / polygonArea(mass)).toBeCloseTo(1, 1);
  });
});

describe("CostIceberg (rendered)", () => {
  it("hides the drawing and its labels from assistive technology and names them in one screen reader sentence", () => {
    const { figure, svgs } = renderIceberg();
    expect(figure).toHaveAttribute("aria-hidden", "true");
    expect(figure).toHaveTextContent("Visible costs");
    expect(figure).toHaveTextContent("Hidden costs");
    expect(figure).toHaveTextContent("Up to 80 percent");
    expect(svgs).toHaveLength(2);
    const sentence = screen.getByText(LABEL);
    expect(sentence).toHaveClass("sr-only");
    expect(figure.contains(sentence)).toBe(false);
  });

  it("draws in currentColor only: a solid tip, an outline mass and one hairline", () => {
    const { svgs } = renderIceberg();
    const [tip, mass] = svgs.map((svg) => svg.querySelector("path") as SVGPathElement);
    expect(tip).toHaveAttribute("fill", "currentColor");
    expect(tip).toHaveAttribute("stroke", "currentColor");
    expect(mass).toHaveAttribute("fill", "none");
    expect(mass).toHaveAttribute("stroke", "currentColor");
    for (const path of [tip, mass]) {
      expect(path).toHaveAttribute("stroke-width", "1");
      expect(path).toHaveAttribute("vector-effect", "non-scaling-stroke");
    }
    // The waterline is the hairline on the lower row's two cells, drawn once each, so it runs
    // under the labels as well as the drawing; the tip row carries none.
    const [tipSvg, massSvg] = svgs;
    expect(tipSvg).not.toHaveClass("border-t");
    expect(massSvg).toHaveClass("border-t");
    expect(massSvg?.nextElementSibling).toHaveClass("border-t");
    expect(tipSvg?.nextElementSibling).not.toHaveClass("border-t");
  });

  it("gives the two halves one horizontal scale and heights in the shares' proportion", () => {
    const { svgs } = renderIceberg();
    const boxes = svgs.map((svg) => (svg.getAttribute("viewBox") ?? "").split(" ").map(Number));
    const [tipBox, massBox] = boxes;
    expect(tipBox?.[2]).toBe(massBox?.[2]);
    expect(tipBox?.[1]).toBe(0);
    expect((tipBox?.[1] ?? 0) + (tipBox?.[3] ?? 0)).toBeCloseTo(massBox?.[1] ?? -1, 1);
    expect(massBox?.[3]).toBeGreaterThan(tipBox?.[3] ?? Number.POSITIVE_INFINITY);
  });

  it("exposes the shares as data attributes for the browser thread", () => {
    const { figure } = renderIceberg();
    expect(figure).toHaveAttribute("data-visible-share", "20");
    expect(figure).toHaveAttribute("data-hidden-share", "80");
  });

  it("merges a caller's class on the wrapper", () => {
    const { container } = render(
      <CostIceberg
        visible={{ share: 20, title: "a", figure: "b" }}
        hidden={{ share: 80, title: "c", figure: "d" }}
        label={LABEL}
        className="max-w-md"
      />,
    );
    expect(container.querySelector('[data-slot="cost-iceberg"]')).toHaveClass("max-w-md");
  });

  it("sets no weight above the body copy anywhere in the primitive", () => {
    // The weight ceiling is 600 (tests/font-weight.test.ts); this primitive goes further and
    // carries no weight utility at all, so the tip's label can never outweigh the body.
    const source = readFileSync(
      resolve(__dirname, "../../src/components/cost-iceberg.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(
      /\bfont-(medium|semibold|bold|extrabold|black)\b|font-\[\d{3}\]|fontWeight|font-weight|text-heading-/,
    );
  });
});

describe("the number section catalogue (decision B, 2026-09-12)", () => {
  const catalogues = { en: en.marketing.landing.points, de: de.marketing.landing.points } as const;

  it("states the hidden share as a bound and never as a bare 80", () => {
    expect(catalogues.en.hiddenFigure).toBe("Up to 80 percent");
    expect(catalogues.de.hiddenFigure).toBe("Bis zu 80 Prozent");
    expect(catalogues.en.body).toMatch(/^Up to 80 percent/);
    expect(catalogues.en.body).not.toMatch(/80%/);
  });

  it("writes the count as a literal with a non breaking space and names the year and the definition", () => {
    expect(catalogues.en.body).toContain("99 421");
    expect(catalogues.en.body).toContain("four or more days");
    expect(catalogues.en.body).toContain("2023");
    expect(catalogues.en.body).not.toContain("534");
  });

  it("names the sources without the dataset code and spells percent out", () => {
    for (const points of Object.values(catalogues)) {
      expect(points.source).toMatch(/ILO/);
      expect(points.source).toMatch(/Heinrich/);
      expect(points.source).toMatch(/Eurostat/);
      expect(points.source).not.toMatch(/hsw_n2/);
      for (const text of [points.body, points.source, points.hiddenFigure, points.visibleFigure]) {
        expect(text).not.toMatch(/%|&/);
      }
    }
  });

  it("carries the graphic's screen reader sentence and both labels in both languages", () => {
    for (const points of Object.values(catalogues)) {
      for (const key of [
        "visibleTitle",
        "visibleFigure",
        "hiddenTitle",
        "hiddenFigure",
        "graphicLabel",
      ] as const) {
        expect(points[key].length).toBeGreaterThan(0);
      }
      expect(points.graphicLabel).toMatch(/20/);
      expect(points.graphicLabel).toMatch(/80/);
    }
  });
});
