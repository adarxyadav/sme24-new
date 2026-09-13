"use client";

import { type KeyboardEvent, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { bubbleRadius, type Domain } from "./chart-scale";

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
    /** The four axis end labels, formatted. */
    readonly xLow: string;
    readonly xHigh: string;
    readonly yLow: string;
    readonly yHigh: string;
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

const WIDTH = 520;
const HEIGHT = 320;
const PAD = { top: 18, right: 22, bottom: 44, left: 48 } as const;
const PLOT_INSET = 26;

/**
 * The peer bubble chart (spec 0021, AC-22): a hand drawn SVG with LTIFR across, days lost per
 * incident up and headcount as bubble area, the client's bubble always drawn in `chart-1` and
 * the peers in `chart-2`, a dashed sector line in `chart-3`, a focusable bubble each with a
 * tooltip on hover and on focus, and an `sr-only` table carrying the same figures. No motion at
 * all, so `prefers-reduced-motion` has nothing to take away. Browser; the server parent formats
 * every string.
 */
export function PeerBubbleChart({
  points,
  xDomain,
  yDomain,
  sectorLine,
  labels,
}: PeerBubbleChartProps) {
  const id = useId();
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const left = PAD.left + PLOT_INSET;
  const right = WIDTH - PAD.right - PLOT_INSET;
  const top = PAD.top + PLOT_INSET;
  const bottom = HEIGHT - PAD.bottom - PLOT_INSET;
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
  const shown = placed.find((point) => point.key === active) ?? null;
  // Enter and Space toggle the tooltip on the focused bubble (its one action), Escape closes it.
  const onKeyDown = (key: string) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Escape") setActive(null);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActive((current) => (current === key ? null : key));
    }
  };
  const axisText = "fill-muted-foreground text-[11px]";

  return (
    <div className="relative w-full max-w-2xl" data-peer-chart="drawn" data-points={points.length}>
      {/* `group`, not `img`: an `img` makes its children presentational, so axe refuses the
          focusable bubbles inside it (nested-interactive); the group carries the same label. */}
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG has no fieldset; the role names the drawing */}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full"
        role="group"
        aria-label={labels.chart}
      >
        <title>{labels.chart}</title>
        {/* The axes. */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={HEIGHT - PAD.bottom}
          y2={HEIGHT - PAD.bottom}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          x2={PAD.left}
          y1={PAD.top}
          y2={HEIGHT - PAD.bottom}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <text x={left} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" className={axisText}>
          {labels.xLow}
        </text>
        <text x={right} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" className={axisText}>
          {labels.xHigh}
        </text>
        <text
          x={(PAD.left + WIDTH - PAD.right) / 2}
          y={HEIGHT - 8}
          textAnchor="middle"
          className={axisText}
        >
          {labels.xAxis}
        </text>
        <text x={PAD.left - 6} y={bottom + 4} textAnchor="end" className={axisText}>
          {labels.yLow}
        </text>
        <text x={PAD.left - 6} y={top + 4} textAnchor="end" className={axisText}>
          {labels.yHigh}
        </text>
        <text x={PAD.left} y={PAD.top - 6} textAnchor="start" className={axisText}>
          {labels.yAxis}
        </text>
        {/* The sector line: dashed, the one place the word median is allowed (AC-22). */}
        {sectorLine === null ? null : (
          <g data-sector-line={sectorLine.value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={scaleY(sectorLine.value)}
              y2={scaleY(sectorLine.value)}
              stroke="var(--chart-3)"
              strokeWidth={1}
              strokeDasharray="5 4"
            />
            <text
              x={WIDTH - PAD.right}
              y={scaleY(sectorLine.value) - 5}
              textAnchor="end"
              className={axisText}
            >
              {sectorLine.label}
            </text>
          </g>
        )}
        {/* The bubbles: a focusable button each (its action shows the figures), named whole for
            the screen reader, with a visible ring on focus. */}
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
                  stroke={isFocused ? "var(--ring)" : "var(--chart-3)"}
                  strokeWidth={isFocused ? 2.5 : 1.5}
                  data-focus-ring={isFocused ? "" : undefined}
                />
              ) : null}
              <circle
                cx={point.cx}
                cy={point.cy}
                r={point.r}
                fill={point.isClient ? "var(--chart-1)" : "var(--chart-2)"}
                fillOpacity={point.isClient ? 0.92 : 0.5}
                stroke={point.isClient ? "var(--chart-1)" : "var(--chart-2)"}
                strokeWidth={1.5}
              />
            </g>
          );
        })}
      </svg>
      {/* The tooltip on hover and on focus: the same lines the bubble's own name carries, so it
          is hidden from assistive technology rather than read twice. */}
      {shown === null ? null : (
        <div
          role="tooltip"
          id={`${id}-tooltip`}
          aria-hidden="true"
          data-chart-tooltip={shown.key}
          className={cn(
            "pointer-events-none absolute z-10 w-max max-w-xs rounded-md bg-foreground px-3 py-2 text-background text-xs",
            "-translate-x-1/2 -translate-y-full",
          )}
          style={{
            left: `${(shown.cx / WIDTH) * 100}%`,
            top: `calc(${((shown.cy - shown.r) / HEIGHT) * 100}% - 8px)`,
          }}
        >
          <p className="font-medium">{shown.name}</p>
          {shown.lines.map((line) => (
            <p key={line} className="tabular-nums" data-numeric>
              {line}
            </p>
          ))}
        </div>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full bg-chart-1"
            data-legend="client"
          />
          {labels.legendClient}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full bg-chart-2/50 ring-1 ring-chart-2 ring-inset"
            data-legend="peer"
          />
          {labels.legendPeer}
        </li>
        {sectorLine === null ? null : (
          <li className="flex items-center gap-1.5">
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
