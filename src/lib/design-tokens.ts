/**
 * The color token pairs the design system guarantees (spec 0003, AC-1). One `readonly` list read
 * by the Vitest contrast gate (`tests/contrast.test.ts`, parsing `globals.css`) and by the gallery
 * token section (live values from the browser). Pure data, importable anywhere.
 */

/** WCAG 2.2 AA thresholds: 4.5:1 for text, 3:1 for control boundaries and the focus ring. */
export const TEXT_MINIMUM = 4.5;
export const BOUNDARY_MINIMUM = 3;

export type ContrastPair = {
  /** Token drawn on top (text, boundary, ring), without the leading `--`. */
  readonly foreground: string;
  /** Token underneath (page, card, fill), without the leading `--`. */
  readonly background: string;
  /** Minimum ratio this pair must reach in both themes. */
  readonly minimum: typeof TEXT_MINIMUM | typeof BOUNDARY_MINIMUM;
};

/** The surfaces text and controls sit on. */
export const GROUNDS = ["background", "card", "muted", "sidebar"] as const;

/** Status tokens: each has a fill, a `-foreground` for text on the fill and a `-subtle` tint. */
export const STATUS_TOKENS = ["success", "warning", "info", "destructive"] as const;

/** Severity levels for gap findings and benchmark tiers; same three token shape as status. */
export const SEVERITY_TOKENS = [
  "severity-critical",
  "severity-high",
  "severity-medium",
  "severity-low",
] as const;

/** Every token with the `x`, `x-foreground`, `x-subtle` shape. */
export const SEMANTIC_FILLS = [...STATUS_TOKENS, ...SEVERITY_TOKENS] as const;

/** Text tokens that must read on every ground. */
const TEXT_ON_GROUNDS = ["foreground", "muted-foreground", "primary"] as const;

/** Control boundaries and the focus ring must stand out from every ground at 3:1. */
const BOUNDARIES_ON_GROUNDS = ["ring", "input"] as const;

/** Surface pairs: the text token of each surface on that surface. */
const SURFACE_PAIRS = [
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
] as const;

const text = (foreground: string, background: string): ContrastPair => ({
  foreground,
  background,
  minimum: TEXT_MINIMUM,
});

const boundary = (foreground: string, background: string): ContrastPair => ({
  foreground,
  background,
  minimum: BOUNDARY_MINIMUM,
});

/**
 * The full pair list. Hairline dividers (`--border`) are decorative and are deliberately not in it:
 * WCAG 1.4.11 applies to boundaries that identify a control, which is what `--input` and `--ring`
 * are for. Text on a `-subtle` tint is the fill color itself (`text-success` on
 * `bg-success-subtle`), so that is the pair checked.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...SURFACE_PAIRS.map(([foreground, background]) => text(foreground, background)),
  ...SEMANTIC_FILLS.flatMap((token) => [
    text(`${token}-foreground`, token),
    text(token, `${token}-subtle`),
    ...GROUNDS.map((ground) => text(token, ground)),
  ]),
  ...TEXT_ON_GROUNDS.flatMap((token) => GROUNDS.map((ground) => text(token, ground))),
  ...BOUNDARIES_ON_GROUNDS.flatMap((token) => GROUNDS.map((ground) => boundary(token, ground))),
];

/** Chart series tokens in the order the gallery and `ChartContainer` use them. */
export const CHART_TOKENS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
