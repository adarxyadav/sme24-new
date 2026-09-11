import { cn } from "@/lib/utils";

export type CostIcebergPart = {
  /** The part's share of the total cost, in percent. Drives the drawing's proportions. */
  readonly share: number;
  /** The part's name ("Visible costs"). */
  readonly title: string;
  /** The figure as the catalogue spells it ("Up to 80 percent"), never formatted at runtime. */
  readonly figure: string;
};

export type CostIcebergProps = {
  /** The part above the waterline: what the insurance statement shows. */
  readonly visible: CostIcebergPart;
  /** The part below the waterline: the cost that never reaches the statement. */
  readonly hidden: CostIcebergPart;
  /** The `sr-only` sentence saying everything the drawing and its labels say. */
  readonly label: string;
  readonly className?: string;
};

export type Point = readonly [x: number, y: number];
export type Polygon = readonly Point[];

/** The drawing's width in user units; both halves share it, so they render at one scale. */
export const ICEBERG_WIDTH = 240;

/**
 * The iceberg's silhouette, clockwise from the peak, in a 240 by 400 space. A peaked top,
 * shoulders that widen under the surface and a long taper to the deepest point. No facets and
 * no interior lines: the outline is the whole drawing, the waterline does the arguing.
 */
export const ICEBERG_OUTLINE: Polygon = [
  [118, 0],
  [150, 34],
  [162, 78],
  [196, 118],
  [214, 176],
  [232, 232],
  [206, 300],
  [150, 372],
  [126, 400],
  [78, 344],
  [34, 270],
  [18, 214],
  [28, 160],
  [60, 120],
  [78, 70],
  [98, 30],
];

/** The area of a polygon by the shoelace formula. Pure. */
export function polygonArea(polygon: Polygon): number {
  const n = polygon.length;
  if (n < 3) return 0;
  const twice = polygon.reduce((sum, [x1, y1], index) => {
    const next = polygon[(index + 1) % n];
    if (!next) return sum;
    const [x2, y2] = next;
    return sum + x1 * y2 - x2 * y1;
  }, 0);
  return Math.abs(twice) / 2;
}

/**
 * The part of a polygon on one side of a horizontal line (Sutherland and Hodgman against one
 * edge): `above` keeps everything with `y <= line`, otherwise everything with `y >= line`. The
 * new vertices on the line arrive in outline order, so the result is again a simple polygon. Pure.
 */
export function clipAtLine(polygon: Polygon, line: number, side: "above" | "below"): Polygon {
  const inside = ([, y]: Point) => (side === "above" ? y <= line : y >= line);
  const crossing = ([x1, y1]: Point, [x2, y2]: Point): Point => [
    x1 + ((x2 - x1) * (line - y1)) / (y2 - y1),
    line,
  ];
  return polygon.flatMap((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    if (!previous) return [];
    const currentIn = inside(current);
    const previousIn = inside(previous);
    if (currentIn && previousIn) return [current];
    if (currentIn) return [crossing(previous, current), current];
    if (previousIn) return [crossing(previous, current)];
    return [];
  });
}

/**
 * The height at which a horizontal line splits the polygon so that `fraction` of its area lies
 * above the line, found by bisection to a hundredth of a unit. Pure.
 */
export function waterlineFor(polygon: Polygon, fraction: number): number {
  const total = polygonArea(polygon);
  const ys = polygon.map(([, y]) => y);
  const bounds = { low: Math.min(...ys), high: Math.max(...ys) };
  const target = Math.min(Math.max(fraction, 0), 1) * total;
  const search = (low: number, high: number, steps: number): number => {
    const middle = (low + high) / 2;
    if (steps === 0 || high - low < 0.01) return middle;
    return polygonArea(clipAtLine(polygon, middle, "above")) < target
      ? search(middle, high, steps - 1)
      : search(low, middle, steps - 1);
  };
  return search(bounds.low, bounds.high, 40);
}

/**
 * The silhouette split into the tip and the mass at the waterline the two shares demand, so a
 * drawing for 20 and 80 holds four times as much area under the line as above it. Pure.
 */
export function splitIceberg(
  visibleShare: number,
  hiddenShare: number,
  outline: Polygon = ICEBERG_OUTLINE,
): { readonly waterline: number; readonly tip: Polygon; readonly mass: Polygon } {
  const total = visibleShare + hiddenShare;
  const fraction = total > 0 ? visibleShare / total : 0.5;
  const waterline = waterlineFor(outline, fraction);
  return {
    waterline,
    tip: clipAtLine(outline, waterline, "above"),
    mass: clipAtLine(outline, waterline, "below"),
  };
}

/**
 * An open path around a half of the iceberg that leaves out the edge lying on the waterline, so
 * the stroke draws the silhouette and never doubles the divider. The fill closes the path on
 * its own. Pure.
 */
export function openPath(polygon: Polygon, waterline: number): string {
  const onLine = ([, y]: Point) => Math.abs(y - waterline) < 0.001;
  const n = polygon.length;
  // Start at the first vertex on the line whose predecessor is also on it, so the path runs from
  // one end of the water edge round the silhouette to the other end.
  const start = polygon.findIndex((point, index) => {
    const previous = polygon[(index + n - 1) % n];
    return onLine(point) && previous !== undefined && onLine(previous);
  });
  const ordered = start === -1 ? polygon : [...polygon.slice(start), ...polygon.slice(0, start)];
  return ordered
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`)
    .join(" ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The cost iceberg (spec 0009, the client review of 2026-09-11): the visible share of an
 * accident's cost as a solid tip above the waterline and the hidden share as an outline below
 * it, each half drawn from the shares it is labelled with. Draws in `currentColor` with one fill
 * and one hairline; the waterline is the design system's own hairline divider, running under the
 * labels as well as the drawing. The figure is decorative (`aria-hidden`, labels included) and
 * the `sr-only` sentence carries the meaning, the `QuartileBand` shape. Server component.
 */
export function CostIceberg({ visible, hidden, label, className }: CostIcebergProps) {
  const { waterline, tip, mass } = splitIceberg(visible.share, hidden.share);
  const ys = ICEBERG_OUTLINE.map(([, y]) => y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return (
    <div data-slot="cost-iceberg" className={cn("block w-full", className)}>
      {/*
        One grid for both halves, so the label column is one width and the two figures share a
        left edge. The waterline is the design system's hairline on the lower row's cells, which
        touch, so it runs unbroken under the drawing and the labels alike; the labels take their
        gap as padding so the line has nothing to cross.
      */}
      <div
        aria-hidden="true"
        className="grid grid-cols-[minmax(0,1fr)_auto]"
        data-visible-share={visible.share}
        data-hidden-share={hidden.share}
      >
        <svg
          viewBox={`0 ${round(top)} ${ICEBERG_WIDTH} ${round(waterline - top)}`}
          className="block w-full"
          data-part="tip"
          aria-hidden="true"
        >
          <path
            d={openPath(tip, waterline)}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="flex flex-col justify-end gap-0.5 pb-2 pl-6">
          <p className="text-label-13 text-muted-foreground">{visible.title}</p>
          <p className="text-label-16">{visible.figure}</p>
        </div>
        <svg
          viewBox={`0 ${round(waterline)} ${ICEBERG_WIDTH} ${round(bottom - waterline)}`}
          className="block w-full border-t"
          data-part="mass"
          aria-hidden="true"
        >
          <path
            d={openPath(mass, waterline)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="flex flex-col gap-0.5 border-t pt-2 pl-6">
          <p className="text-label-13 text-muted-foreground">{hidden.title}</p>
          <p className="text-label-16">{hidden.figure}</p>
        </div>
      </div>
      <p className="sr-only">{label}</p>
    </div>
  );
}
