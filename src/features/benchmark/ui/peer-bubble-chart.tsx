"use client";

import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { bubbleRadius, type Domain, type Tick } from "./chart-scale";

/**
 * One bubble (spec 0021, AC-22): the raw figures for geometry only, and every string already
 * formatted by the server parent (AC-21), so nothing here formats a number and the hydration
 * hazard of a grouped figure never arises.
 */
export type BubblePoint = {
  readonly key: string;
  readonly isClient: boolean;
  /** LTIFR across. */
  readonly x: number;
  /** Days lost per incident up. */
  readonly y: number;
  /** Headcount for the area, `null` for the floor. */
  readonly headcount: number | null;
  /** The company name, or the "your company" word. */
  readonly name: string;
  /** The tooltip lines after the name, in order: headcount, LTIFR, lost days, the published pair, the note. */
  readonly lines: readonly string[];
  /** The screen reader table's cells, already formatted. */
  readonly cells: {
    readonly country: string;
    readonly headcount: string;
    readonly ltifr: string;
    readonly lostDays: string;
    readonly note: string;
  };
};

export type PeerBubbleChartProps = {
  /** The client first, then the peers. */
  readonly points: readonly BubblePoint[];
  readonly xDomain: Domain;
  readonly yDomain: Domain;
  /** The dashed sector line, or `null` when the snapshot has no lost days sector row. */
  readonly sectorLine: { readonly value: number; readonly label: string } | null;
  readonly labels: {
    readonly chart: string;
    readonly tableCaption: string;
    readonly xAxis: string;
    readonly yAxis: string;
    /** The round ticks of each axis inside its domain, formatted by the server parent. */
    readonly xTicks: readonly Tick[];
    readonly yTicks: readonly Tick[];
    readonly legendClient: string;
    readonly legendPeer: string;
    readonly legendSector: string;
    readonly columns: {
      readonly company: string;
      readonly country: string;
      readonly headcount: string;
      readonly ltifr: string;
      readonly lostDays: string;
      readonly note: string;
    };
  };
};

/** The width drawn on the server and in a test, before the container has been measured. */
const DEFAULT_WIDTH = 560;
/** Room above the plot for the y axis title, below it for the x ticks and title, right for a label. */
const PAD = { top: 30, right: 16, bottom: 48 } as const;
/** A bubble at the edge of the domain keeps this much plot inside it on top of the domain margin. */
const PLOT_INSET = 10;
/** The label typography is 12px, so a digit is about 7px and a letter about 6.4px wide. */
const DIGIT_WIDTH = 7;
const LETTER_WIDTH = 6.4;
const LABEL_GAP = 6;
const LABEL_HEIGHT = 14;

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The peer bubble chart (spec 0021, AC-22): a hand drawn SVG with LTIFR across, days lost per
 * incident up and headcount as bubble area, the client's bubble always drawn in `chart-1` and
 * the peers in `chart-2` on a `chart-3` tint, a dashed sector line in `chart-3`, round ticks on a
 * hairline grid, each bubble named beside it, a focusable bubble each with a tooltip on hover
 * and on focus, and an `sr-only` table carrying the same figures. The drawing measures its
 * container and draws in pixels, so the type stays 12px at every width instead of scaling with
 * a viewBox. No motion at all, so `prefers-reduced-motion` has nothing to take away. Browser;
 * the server parent formats every string.
 */
export function PeerBubbleChart({
  points,
  xDomain,
  yDomain,
  sectorLine,
  labels,
}: PeerBubbleChartProps) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = container.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = Math.round(Math.min(340, Math.max(260, width * 0.58)));
  const yTickWidth =
    Math.max(0, ...labels.yTicks.map((tick) => tick.label.length)) * DIGIT_WIDTH + 12;
  const plotLeft = yTickWidth;
  const plotRight = width - PAD.right;
  const plotTop = PAD.top;
  const plotBottom = height - PAD.bottom;
  const left = plotLeft + PLOT_INSET;
  const right = plotRight - PLOT_INSET;
  const top = plotTop + PLOT_INSET;
  const bottom = plotBottom - PLOT_INSET;
  const scaleX = (value: number) =>
    left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * (right - left);
  const scaleY = (value: number) =>
    bottom - ((value - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * (bottom - top);
  const largest = Math.max(0, ...points.map((point) => point.headcount ?? 0));
  const placed = points.map((point) => ({
    ...point,
    cx: scaleX(point.x),
    cy: scaleY(point.y),
    r: bubbleRadius(point.headcount, largest),
  }));
  // Larger bubbles first so a small one is never buried under a big neighbour; the client last
  // so it always stays reachable by pointer.
  const drawOrder = [...placed].sort((a, b) => (a.isClient ? 1 : b.isClient ? -1 : b.r - a.r));
  // Each name sits to the right of its bubble, flips to the left near the right edge, and drops
  // under the bubble when it would sit on top of a name already placed; labels are laid out top
  // to bottom so the fallback is deterministic.
  const labelBoxes = new Map<string, Box & { readonly anchor: "start" | "end" }>();
  const taken: Box[] = [];
  for (const point of [...placed].sort((a, b) => a.cy - b.cy)) {
    const w = point.name.length * LETTER_WIDTH;
    const beside = point.cx + point.r + LABEL_GAP + w <= plotRight;
    const side: Box & { readonly anchor: "start" | "end" } = beside
      ? {
          x: point.cx + point.r + LABEL_GAP,
          y: point.cy - LABEL_HEIGHT / 2,
          w,
          h: LABEL_HEIGHT,
          anchor: "start",
        }
      : {
          x: point.cx - point.r - LABEL_GAP - w,
          y: point.cy - LABEL_HEIGHT / 2,
          w,
          h: LABEL_HEIGHT,
          anchor: "end",
        };
    const below: Box & { readonly anchor: "start" | "end" } = {
      x: point.cx - w / 2,
      y: point.cy + point.r + 2,
      w,
      h: LABEL_HEIGHT,
      anchor: "start",
    };
    const box = taken.some((other) => overlaps(other, side)) ? below : side;
    labelBoxes.set(point.key, box);
    taken.push(box);
  }
  const shown = placed.find((point) => point.key === active) ?? null;
  // The tooltip stays inside the drawing: its centre is clamped and the arrow keeps the bubble.
  const tooltipHalf = 120;
  const tooltipLeft =
    shown === null ? 0 : Math.min(Math.max(shown.cx, tooltipHalf), width - tooltipHalf);
  // Above the bubble by default, below it when the bubble sits in the upper half of the plot,
  // so the box never spills over the heading.
  const tooltipBelow = shown !== null && shown.cy < (plotTop + plotBottom) / 2;
  // Enter and Space toggle the tooltip on the focused bubble (its one action), Escape closes it.
  const onKeyDown = (key: string) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Escape") setActive(null);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActive((current) => (current === key ? null : key));
    }
  };
  const axisText = "fill-muted-foreground text-label-12";

  return (
    <div
      ref={container}
      className="relative w-full max-w-2xl"
      data-peer-chart="drawn"
      data-points={points.length}
    >
      {/* `group`, not `img`: an `img` makes its children presentational, so axe refuses the
          focusable bubbles inside it (nested-interactive); the group carries the same label. */}
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG has no fieldset; the role names the drawing */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full overflow-visible"
        role="group"
        aria-label={labels.chart}
      >
        <title>{labels.chart}</title>
        {/* The grid: a hairline per y tick and the baseline, the way the gallery's charts draw
            theirs (horizontal only, no axis lines); the x ticks are short marks under it. */}
        {labels.yTicks.map((tick) => (
          <g key={tick.value} data-tick-y={tick.value}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={scaleY(tick.value)}
              y2={scaleY(tick.value)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={plotLeft - 8}
              y={scaleY(tick.value)}
              dy="0.35em"
              textAnchor="end"
              className={cn(axisText, "tabular-nums")}
            >
              {tick.label}
            </text>
          </g>
        ))}
        <line
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
          className="stroke-border"
          strokeWidth={1}
        />
        {labels.xTicks.map((tick) => (
          <g key={tick.value} data-tick-x={tick.value}>
            <line
              x1={scaleX(tick.value)}
              x2={scaleX(tick.value)}
              y1={plotBottom}
              y2={plotBottom + 4}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={scaleX(tick.value)}
              y={plotBottom + 18}
              textAnchor="middle"
              className={cn(axisText, "tabular-nums")}
            >
              {tick.label}
            </text>
          </g>
        ))}
        {/* The axis titles: the y title over the plot's left edge, the x title under its right. */}
        <text x={plotLeft} y={plotTop - 12} textAnchor="start" className={axisText}>
          {labels.yAxis}
        </text>
        <text x={plotRight} y={height - 6} textAnchor="end" className={axisText}>
          {labels.xAxis}
        </text>
        {/* The sector line: dashed, the one place the word median is allowed (AC-22). */}
        {sectorLine === null ? null : (
          <g data-sector-line={sectorLine.value}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={scaleY(sectorLine.value)}
              y2={scaleY(sectorLine.value)}
              stroke="var(--chart-3)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={plotRight}
              y={scaleY(sectorLine.value) - 6}
              textAnchor="end"
              stroke="var(--background)"
              strokeWidth={3}
              paintOrder="stroke"
              className={axisText}
            >
              {sectorLine.label}
            </text>
          </g>
        )}
        {/* The bubbles: a focusable button each (its action shows the figures), named whole for
            the screen reader, named beside itself for everyone else, with a visible ring on focus.
            The surface ring under every bubble keeps two overlapping marks apart. */}
        {drawOrder.map((point) => {
          const isFocused = focused === point.key;
          const isActive = active === point.key;
          const label = labelBoxes.get(point.key);
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG has no button element; the group is the bubble
            <g
              key={point.key}
              tabIndex={0}
              role="button"
              aria-label={[point.name, ...point.lines].join(". ")}
              aria-pressed={isActive}
              className="cursor-default outline-none"
              data-bubble={point.key}
              data-client={point.isClient ? "" : undefined}
              onPointerEnter={() => setActive(point.key)}
              onPointerLeave={() => setActive(focused)}
              onFocus={() => {
                setFocused(point.key);
                setActive(point.key);
              }}
              onBlur={() => {
                setFocused(null);
                setActive(null);
              }}
              onKeyDown={onKeyDown(point.key)}
            >
              {isFocused || isActive ? (
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={point.r + 4}
                  fill="none"
                  stroke={isFocused ? "var(--ring)" : "var(--chart-2)"}
                  strokeWidth={isFocused ? 2 : 1}
                  data-focus-ring={isFocused ? "" : undefined}
                />
              ) : null}
              <circle
                cx={point.cx}
                cy={point.cy}
                r={point.r + 1}
                fill="var(--background)"
                stroke="var(--background)"
                strokeWidth={2}
              />
              <circle
                cx={point.cx}
                cy={point.cy}
                r={point.r}
                fill={point.isClient ? "var(--chart-1)" : "var(--chart-3)"}
                fillOpacity={point.isClient ? 1 : isActive ? 0.55 : 0.3}
                stroke={point.isClient ? "var(--chart-1)" : "var(--chart-2)"}
                strokeWidth={1}
              />
              {label ? (
                <text
                  x={label.anchor === "start" ? label.x : label.x + label.w}
                  y={label.y + LABEL_HEIGHT / 2}
                  dy="0.35em"
                  textAnchor={label.anchor}
                  stroke="var(--background)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  className={cn(
                    "select-none text-label-12",
                    point.isClient ? "fill-foreground font-medium" : "fill-muted-foreground",
                  )}
                  data-bubble-label
                >
                  {point.name}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {/* The tooltip on hover and on focus: the same lines the bubble's own name carries, so it
          is hidden from assistive technology rather than read twice; the surface of the tooltip
          primitive, with its arrow held at the bubble while the box stays inside the drawing. */}
      {shown === null ? null : (
        <div
          role="tooltip"
          id={`${id}-tooltip`}
          aria-hidden="true"
          data-chart-tooltip={shown.key}
          className={cn(
            "pointer-events-none absolute z-10 w-max max-w-3xs rounded-md bg-foreground px-3 py-2 text-background text-xs leading-snug",
            tooltipBelow ? "-translate-x-1/2" : "-translate-x-1/2 -translate-y-full",
          )}
          style={{
            left: `${tooltipLeft}px`,
            top: `${tooltipBelow ? shown.cy + shown.r + 10 : shown.cy - shown.r - 10}px`,
          }}
        >
          <p className="font-medium">{shown.name}</p>
          {shown.lines.map((line) => (
            <p key={line} className="tabular-nums" data-numeric>
              {line}
            </p>
          ))}
          <span
            aria-hidden="true"
            className={cn(
              "absolute size-2.5 -translate-x-1/2 rotate-45 rounded-xs bg-foreground",
              tooltipBelow ? "-top-1" : "-bottom-1",
            )}
            style={{ left: `calc(50% + ${shown.cx - tooltipLeft}px)` }}
          />
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-label-12 text-muted-foreground">
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full bg-chart-1"
            data-legend="client"
          />
          {labels.legendClient}
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full bg-chart-3/30 ring-1 ring-chart-2 ring-inset"
            data-legend="peer"
          />
          {labels.legendPeer}
        </li>
        {sectorLine === null ? null : (
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-0 w-4 border-chart-3 border-t border-dashed"
              data-legend="sector"
            />
            {labels.legendSector}
          </li>
        )}
      </ul>
      {/* The screen reader table: one row per bubble, the note as its own column (AC-19, AC-22). */}
      <table className="sr-only" data-chart-table>
        <caption>{labels.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.columns.company}</th>
            <th scope="col">{labels.columns.country}</th>
            <th scope="col">{labels.columns.headcount}</th>
            <th scope="col">{labels.columns.ltifr}</th>
            <th scope="col">{labels.columns.lostDays}</th>
            <th scope="col">{labels.columns.note}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key} data-chart-row={point.key}>
              <th scope="row">{point.name}</th>
              <td>{point.cells.country}</td>
              <td>{point.cells.headcount}</td>
              <td>{point.cells.ltifr}</td>
              <td>{point.cells.lostDays}</td>
              <td>{point.cells.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
