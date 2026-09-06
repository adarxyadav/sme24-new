import { cn } from "@/lib/utils";

export type QuartileBandProps = {
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  /** The company's value, marked on the band. */
  readonly value: number;
  /** The `sr-only` sentence naming the band and the three quartiles. */
  readonly label: string;
  readonly className?: string;
};

const WIDTH = 200;
const HEIGHT = 24;
const PADDING = 8;

/**
 * A quartile band (spec 0008, AC-14): an SVG bar from p25 to p75 with a median tick and the
 * company's value as a marker, drawn with the `chart-1` to `chart-3` tokens; the drawing is
 * decorative and the `sr-only` sentence carries the meaning for screen readers. Server component.
 */
export function QuartileBand({ p25, median, p75, value, label, className }: QuartileBandProps) {
  const low = Math.min(p25, value);
  const high = Math.max(p75, value);
  const span = high - low || 1;
  const margin = span * 0.1;
  const scale = (n: number) =>
    PADDING + ((n - (low - margin)) / (span + 2 * margin)) * (WIDTH - 2 * PADDING);
  const x25 = scale(p25);
  const x75 = scale(p75);
  const xMedian = scale(median);
  const xValue = scale(value);
  const mid = HEIGHT / 2;

  return (
    <span data-slot="quartile-band" className={cn("block w-full max-w-64", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-6 w-full"
        aria-hidden="true"
        data-value={value}
        data-p25={p25}
        data-median={median}
        data-p75={p75}
      >
        <line
          x1={PADDING}
          x2={WIDTH - PADDING}
          y1={mid}
          y2={mid}
          stroke="var(--chart-3)"
          strokeWidth={1}
          strokeOpacity={0.5}
        />
        <rect
          x={x25}
          y={mid - 5}
          width={Math.max(x75 - x25, 2)}
          height={10}
          rx={2}
          fill="var(--chart-3)"
        />
        <line
          x1={xMedian}
          x2={xMedian}
          y1={mid - 8}
          y2={mid + 8}
          stroke="var(--chart-2)"
          strokeWidth={2}
        />
        <circle
          cx={xValue}
          cy={mid}
          r={5}
          fill="var(--chart-1)"
          stroke="var(--background)"
          strokeWidth={1.5}
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
