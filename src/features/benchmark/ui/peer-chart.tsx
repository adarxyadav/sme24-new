"use client";

import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { bubbleRadius, type Domain, type Tick } from "./chart-scale";

/**
 * One bubble of the D-chart (spec 0022): the raw figures for geometry only, and every string
 * already formatted by the server parent, so nothing here formats a number. That split is not a
 * style preference: a grouped figure formatted in a client component renders `1'929` on Node and
 * `1’929` in the browser, which fails hydration and leaves every control in the component inert.
 */
export type ChartPoint = {
  readonly key: string;
  readonly isClient: boolean;
  /** The rank position across, 1-based; the x axis is the ranking itself, not a rate. */
  readonly rank: number;
  /** TRIFR up, per million hours. */
  readonly trifr: number;
  /** That company's own estimated yearly loss, the bubble's area. Null draws the floor radius. */
  readonly loss: number | null;
  /** The company name, or the "your company" word. */
  readonly name: string;
  /** The tooltip lines after the name, in order: the rank, TRIFR, the estimated loss. */
  readonly lines: readonly string[];
  /** The screen reader table's cells, already formatted. */
  readonly cells: {
    readonly rank: string;
    readonly country: string;
    readonly trifr: string;
    readonly loss: string;
  };
};

export type PeerChartProps = {
  /** Every point in rank order, the client among them. */
  readonly points: readonly ChartPoint[];
  readonly yDomain: Domain;
  readonly labels: {
    readonly chart: string;
    readonly tableCaption: string;
    readonly xAxis: string;
    readonly yAxis: string;
    /** The round ticks of the y axis inside its domain, formatted by the server parent. */
    readonly yTicks: readonly Tick[];
    readonly legendClient: string;
    readonly legendPeer: string;
    readonly columns: {
      readonly company: string;
      readonly rank: string;
      readonly country: string;
      readonly trifr: string;
      readonly loss: string;
    };
  };
};

/** The width drawn on the server and in a test, before the container has been measured. */
const DEFAULT_WIDTH = 560;
/** Room above the plot for the y axis title, below it for the rank ticks, the names and the title. */
const PAD = { top: 30, right: 16, bottom: 72 } as const;
/** A bubble at the edge of the domain keeps this much plot inside it on top of the domain margin. */
const PLOT_INSET = 10;
/** The label typography is 12px, so a digit is about 7px and a letter about 6.4px wide. */
const DIGIT_WIDTH = 7;
const LETTER_WIDTH = 6.4;
/** A name under a tick wraps to a second line rather than colliding with its neighbours. */
const NAME_LINE_HEIGHT = 13;

/** A rank name split to at most two lines that each fit `width`, the second one clipped with an ellipsis. */
function nameLines(name: string, width: number): readonly string[] {
  const perLine = Math.max(4, Math.floor(width / LETTER_WIDTH));
  if (name.length <= perLine) return [name];
  const words = name.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = word;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && current !== "") lines.push(current);
  const kept = lines.slice(0, 2);
  const last = kept[1] ?? kept[0] ?? name;
  if (last.length > perLine) kept[kept.length - 1] = `${last.slice(0, Math.max(1, perLine - 1))}…`;
  return kept;
}

/**
 * The peer chart, the owner's sketch of 14 Sep 2026 (spec 0022, the D-chart follow-up): a hand
 * drawn SVG with the rank across, TRIFR up and each company's own estimated yearly loss as the
 * bubble's area. The peers are filled; the client is an unfilled outline, because it has no
 * published loss to size a bubble by. Each bubble is focusable and carries the same figures in a
 * tooltip and in an `sr-only` table. The drawing measures its container and draws in pixels, so
 * the type stays 12px at every width instead of scaling with a viewBox. No motion at all, so
 * `prefers-reduced-motion` has nothing to take away. Browser; the server parent formats every
 * string.
 */
export function PeerChart({ points, yDomain, labels }: PeerChartProps) {
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

  const height = Math.round(Math.min(360, Math.max(280, width * 0.62)));
  const yTickWidth =
    Math.max(0, ...labels.yTicks.map((tick) => tick.label.length)) * DIGIT_WIDTH + 12;
  const plotLeft = yTickWidth;
  const plotRight = width - PAD.right;
  const plotTop = PAD.top;
  const plotBottom = height - PAD.bottom;
  const top = plotTop + PLOT_INSET;
  const bottom = plotBottom - PLOT_INSET;
  // The x axis is a band over the ranks: one slot per position, each bubble at its slot's centre,
  // so the spacing carries the ranking and never a distance between two rates.
  const slots = Math.max(1, points.length);
  const slotWidth = (plotRight - plotLeft) / slots;
  const scaleX = (rank: number) => plotLeft + (rank - 0.5) * slotWidth;
  const scaleY = (value: number) =>
    bottom - ((value - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * (bottom - top);
  const largest = Math.max(0, ...points.map((point) => point.loss ?? 0));
  const placed = points.map((point) => ({
    ...point,
    cx: scaleX(point.rank),
    cy: scaleY(point.trifr),
    r: Math.min(bubbleRadius(point.loss, largest), slotWidth / 2 - 2, (bottom - top) / 2),
  }));
  // Larger bubbles first so a small one is never buried under a big neighbour; the client last so
  // its outline is never overdrawn and it stays reachable by pointer.
  const drawOrder = [...placed].sort((a, b) => (a.isClient ? 1 : b.isClient ? -1 : b.r - a.r));
  const shown = placed.find((point) => point.key === active) ?? null;
  // The tooltip stays inside the drawing: its centre is clamped and the arrow keeps the bubble.
  const tooltipHalf = 120;
  const tooltipLeft =
    shown === null ? 0 : Math.min(Math.max(shown.cx, tooltipHalf), width - tooltipHalf);
  // Above the bubble by default, below it when the bubble sits in the upper half of the plot, so
  // the box never spills over the heading.
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
            theirs (horizontal only, no axis lines). */}
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
        {/* The x axis is the ranking: the position under each slot, the company's name beneath it,
            so a reader finds their own step by name rather than by counting bubbles. */}
        {placed.map((point) => (
          <g key={point.key} data-tick-x={point.rank}>
            <text
              x={point.cx}
              y={plotBottom + 18}
              textAnchor="middle"
              className={cn(
                axisText,
                "tabular-nums",
                point.isClient && "fill-foreground font-medium",
              )}
            >
              {point.cells.rank}
            </text>
            {nameLines(point.name, slotWidth - 4).map((line, index) => (
              <text
                key={line}
                x={point.cx}
                y={plotBottom + 33 + index * NAME_LINE_HEIGHT}
                textAnchor="middle"
                className={cn(
                  "select-none text-label-12",
                  point.isClient ? "fill-foreground font-medium" : "fill-muted-foreground",
                )}
                data-bubble-label={index === 0 ? point.key : undefined}
              >
                {line}
              </text>
            ))}
          </g>
        ))}
        {/* The axis titles: the y title over the plot's left edge, the x title under its right. */}
        <text x={plotLeft} y={plotTop - 12} textAnchor="start" className={axisText}>
          {labels.yAxis}
        </text>
        <text x={plotRight} y={height - 6} textAnchor="end" className={axisText}>
          {labels.xAxis}
        </text>
        {/* The bubbles: a focusable button each (its action shows the figures), named whole for
            the screen reader, with a visible ring on focus. The surface ring under every bubble
            keeps two overlapping marks apart. */}
        {drawOrder.map((point) => {
          const isFocused = focused === point.key;
          const isActive = active === point.key;
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
              {/* The client is an outline and the peers are filled (the owner's sketch): the
                  client has no published loss, so there is no area to draw for it. */}
              <circle
                cx={point.cx}
                cy={point.cy}
                r={point.r}
                fill={point.isClient ? "none" : "var(--chart-3)"}
                fillOpacity={point.isClient ? undefined : isActive ? 0.55 : 0.3}
                stroke={point.isClient ? "var(--chart-1)" : "var(--chart-2)"}
                strokeWidth={point.isClient ? 2 : 1}
              />
            </g>
          );
        })}
      </svg>
      {/* The tooltip on hover and on focus: the same lines the bubble's own name carries, so it is
          hidden from assistive technology rather than read twice; the surface of the tooltip
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
            className="inline-block size-2.5 rounded-full ring-2 ring-chart-1 ring-inset"
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
      </ul>
      {/* The screen reader table: one row per bubble, carrying the same figures the drawing does. */}
      <table className="sr-only" data-chart-table>
        <caption>{labels.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.columns.rank}</th>
            <th scope="col">{labels.columns.company}</th>
            <th scope="col">{labels.columns.country}</th>
            <th scope="col">{labels.columns.trifr}</th>
            <th scope="col">{labels.columns.loss}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key} data-chart-row={point.key}>
              <td>{point.cells.rank}</td>
              <th scope="row">{point.name}</th>
              <td>{point.cells.country}</td>
              <td>{point.cells.trifr}</td>
              <td>{point.cells.loss}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
