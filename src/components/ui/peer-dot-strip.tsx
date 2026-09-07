"use client";

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useFormatter } from "next-intl";
import { ReferenceArea, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export type PeerDotStripPoint = {
  readonly label: string;
  readonly value: number;
  /** The value in the KPI's display format, for the tooltip and the screen reader table. */
  readonly formatted: string;
};

export type PeerDotStripProps = {
  /** One point per named peer, labelled Peer A to Peer J. */
  readonly peers: readonly PeerDotStripPoint[];
  readonly client: PeerDotStripPoint;
  /** The statistics band shaded behind the dots; null when the KPI has no statistics row. */
  readonly band: {
    readonly p25: number;
    readonly p75: number;
    readonly p25Formatted: string;
    readonly p75Formatted: string;
  } | null;
  readonly direction: "lower_is_better" | "higher_is_better";
  /** Every string the strip shows or announces; the caller translates. */
  readonly labels: {
    readonly caption: string;
    readonly peer: string;
    readonly value: string;
    readonly you: string;
    readonly band: string;
    readonly better: string;
    readonly legendBand: string;
    readonly legendPeers: string;
    readonly legendYou: string;
  };
  readonly className?: string;
};

/** The padding on both ends of the axis, as a share of the span, so an end dot is never clipped. */
const PADDING = 0.08;

/**
 * The axis domain (spec 0012, AC-12): from the smallest to the largest of the peer values, the
 * band quartiles and the client's value, padded on both ends, so a peer outside the statistics
 * band stays visible rather than clipped. Pure.
 */
export function stripDomain(
  peers: ReadonlyArray<{ readonly value: number }>,
  client: number,
  band: { readonly p25: number; readonly p75: number } | null,
): readonly [low: number, high: number] {
  const values = [
    ...peers.map((peer) => peer.value),
    client,
    ...(band ? [band.p25, band.p75] : []),
  ];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.abs(high) || 1;
  return [low - span * PADDING, high + span * PADDING];
}

type TooltipPayload = ReadonlyArray<{ readonly payload?: PeerDotStripPoint }>;

function StripTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{point.label}</span>
      <span className="ml-2 font-mono tabular-nums">{point.formatted}</span>
    </div>
  );
}

/**
 * A peer dot strip (spec 0012, AC-12): one horizontal axis per KPI with the industry p25 to p75
 * range shaded behind, one dot per named peer, the client's value as a larger filled marker and
 * the direction of better marked, drawn on the `chart-1` to `chart-3` tokens behind the shadcn
 * chart wrapper. The drawing is decorative; a visually hidden table of the same values carries
 * the meaning for screen readers. Browser.
 */
export function PeerDotStrip({
  peers,
  client,
  band,
  direction,
  labels,
  className,
}: PeerDotStripProps) {
  const format = useFormatter();
  const [low, high] = stripDomain(peers, client.value, band);
  const config: ChartConfig = {
    band: { label: labels.legendBand, color: "var(--chart-3)" },
    peers: { label: labels.legendPeers, color: "var(--chart-2)" },
    you: { label: labels.legendYou, color: "var(--chart-1)" },
  };
  const peerPoints = peers.map((peer) => ({ ...peer, y: 0.5 }));
  const clientPoint = [{ ...client, label: labels.you, y: 0.5 }];
  const betterOnTheLeft = direction === "lower_is_better";

  return (
    <div
      data-slot="peer-dot-strip"
      data-peers={peers.length}
      data-client-value={client.value}
      className={cn("flex w-full max-w-xl flex-col gap-1", className)}
    >
      {/*
        The drawing is decorative: the table below carries every value. Recharts' own
        accessibility layer would put a focusable `tabindex="0"` surface inside this
        `aria-hidden` wrapper, which is a keyboard trap on an element assistive tech cannot see,
        so it stays off (`accessibilityLayer` defaults to off) and the surface is made
        unfocusable explicitly.
      */}
      <div aria-hidden="true" className="[&_.recharts-surface]:outline-none">
        <ChartContainer config={config} className="aspect-auto h-16 w-full" resizeThrottleMs={0}>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 12 }} tabIndex={-1}>
            <XAxis
              type="number"
              dataKey="value"
              domain={[low, high]}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              tickFormatter={(value: number) => format.number(value, { maximumFractionDigits: 2 })}
            />
            <YAxis type="number" dataKey="y" domain={[0, 1]} hide />
            <ZAxis zAxisId="peers" range={[64, 64]} />
            <ZAxis zAxisId="you" range={[200, 200]} />
            {band ? (
              <ReferenceArea
                x1={band.p25}
                x2={band.p75}
                y1={0}
                y2={1}
                fill="var(--color-band)"
                fillOpacity={0.4}
                stroke="none"
              />
            ) : null}
            <ChartTooltip cursor={false} content={<StripTooltip />} />
            <Scatter
              data={peerPoints}
              zAxisId="peers"
              fill="var(--color-peers)"
              isAnimationActive={false}
            />
            <Scatter
              data={clientPoint}
              zAxisId="you"
              fill="var(--color-you)"
              stroke="var(--background)"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ChartContainer>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-muted-foreground text-xs">
          <span
            className={cn(
              "flex items-center gap-1",
              betterOnTheLeft ? "order-first" : "order-last",
            )}
          >
            {betterOnTheLeft ? <ArrowLeftIcon className="size-3" /> : null}
            {labels.better}
            {betterOnTheLeft ? null : <ArrowRightIcon className="size-3" />}
          </span>
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-xs bg-(--chart-3)" />
              {labels.legendBand}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-(--chart-2)" />
              {labels.legendPeers}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-full bg-(--chart-1)" />
              {labels.legendYou}
            </span>
          </span>
        </div>
      </div>
      <table className="sr-only">
        <caption>{labels.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.peer}</th>
            <th scope="col">{labels.value}</th>
          </tr>
        </thead>
        <tbody>
          {peers.map((peer) => (
            <tr key={peer.label}>
              <th scope="row">{peer.label}</th>
              <td>{peer.formatted}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">{labels.you}</th>
            <td>{client.formatted}</td>
          </tr>
          {band ? (
            <tr>
              <th scope="row">{labels.band}</th>
              <td>
                {band.p25Formatted} – {band.p75Formatted}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
