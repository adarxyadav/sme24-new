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

/** The three brand colors (brand guidelines v1.0, section 04), fixed in both themes. */
export const BRAND_COLORS = [
  { name: "Jet Black", hex: "#000000", token: "jet" },
  { name: "Pure White", hex: "#FFFFFF", token: "pure-white" },
  { name: "Obsidian Black", hex: "#141414", token: "obsidian" },
] as const;

/** The surfaces page text and controls sit on. The sidebar is its own ground, see below. */
export const GROUNDS = ["background", "card", "muted"] as const;

/** The sidebar carries its own text tokens because its ground differs from the page in both themes. */
export const SIDEBAR_GROUNDS = ["sidebar", "sidebar-accent"] as const;

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

/** Text tokens that must read on every page ground. */
const TEXT_ON_GROUNDS = ["foreground", "muted-foreground", "primary"] as const;

/** Text tokens that must read on every sidebar ground. */
const TEXT_ON_SIDEBAR = ["sidebar-foreground", "sidebar-muted-foreground"] as const;

/** Control boundaries and the focus ring must stand out from every ground at 3:1. */
const BOUNDARIES_ON_GROUNDS = ["ring", "input"] as const;

/**
 * Chart series tokens in the order the gallery and `ChartContainer` use them. Bars and lines carry
 * information, so each series must stand out from every page ground at 3:1 (WCAG 1.4.11).
 */
export const CHART_TOKENS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;

/** Surface pairs: the text token of each surface on that surface. */
const SURFACE_PAIRS = [
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
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
 * The full pair list. Hairline dividers (`--border`, `--sidebar-border`) are decorative and are
 * deliberately not in it (spec 0003, amendment of 2026-09-04): WCAG 1.4.11 applies to boundaries
 * that identify a control, which is what `--input` and the rings are for, and to graphics that carry
 * information, which is why the chart series are in. Text on a `-subtle` tint is the fill color
 * itself (`text-success` on `bg-success-subtle`), so that is the pair checked.
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
  ...TEXT_ON_SIDEBAR.flatMap((token) => SIDEBAR_GROUNDS.map((ground) => text(token, ground))),
  ...SIDEBAR_GROUNDS.map((ground) => boundary("sidebar-ring", ground)),
  ...CHART_TOKENS.flatMap((token) => GROUNDS.map((ground) => boundary(token, ground))),
];
