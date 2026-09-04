import { blend, type Color, clampRgb, converter, interpolate, parse, wcagContrast } from "culori";

/**
 * Pure contrast math for the design tokens (spec 0003). Used by the Vitest contrast gate and by
 * the gallery's token section in the browser. No DOM, no side effects.
 */

/** A color token value as it appears in `globals.css` or as the browser resolves it. */
export type TokenValue = string;

/** Parses a CSS color (`oklch(...)`, `rgb(...)`, `color(srgb ...)`, hex); null when unparseable. */
export function parseColor(value: TokenValue): Color | null {
  const parsed = parse(value.trim());
  return parsed ?? null;
}

/** Composites a possibly translucent foreground over an opaque background (alpha over). */
export function composite(foreground: Color, background: Color): Color {
  const alpha = foreground.alpha ?? 1;
  if (alpha >= 1) return foreground;
  return blend([{ ...background, alpha: 1 }, foreground], "normal", "rgb");
}

/**
 * Evaluates `color-mix(in oklch, a <percent>%, b)`: `percent` of `a`, the rest `b`, mixed in oklch
 * the way the browser does it.
 */
export function mixOklch(a: Color, b: Color, percentOfA: number): Color {
  const mixer = interpolate([a, b], "oklch");
  return mixer(1 - percentOfA / 100);
}

/**
 * WCAG 2.x contrast ratio of a text or boundary color on a background, both composited so a
 * translucent value is measured as it renders.
 */
export function contrastRatio(foreground: Color, background: Color): number {
  const solidBackground = toDisplayRgb({ ...background, alpha: 1 });
  const solidForeground = toDisplayRgb(composite(foreground, solidBackground));
  return wcagContrast(solidForeground, solidBackground);
}

const toRgb = converter("rgb");

/**
 * Converts to sRGB and clips each channel to the displayable range, which is what the browser
 * does with an oklch value outside the sRGB gamut. Measuring the unclipped color overstates the
 * contrast of saturated tokens.
 */
export function toDisplayRgb(color: Color): Color {
  return clampRgb(toRgb(color));
}

const VAR_PATTERN = /^var\(--([a-z0-9-]+)\)$/i;
const COLOR_MIX_PATTERN =
  /^color-mix\(in oklch,\s*var\(--([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\(--([a-z0-9-]+)\)\)$/i;

/**
 * Resolves a token name to a color from a `name -> raw value` map, following `var(--x)` references
 * and evaluating the `color-mix(in oklch, var(--x) N%, var(--y))` form the tokens use.
 * Returns null when the token is missing or its value cannot be understood.
 */
export function resolveTokenColor(
  name: string,
  tokens: Readonly<Record<string, TokenValue>>,
  depth = 0,
): Color | null {
  if (depth > 8) return null;
  const raw = tokens[name]?.trim();
  if (!raw) return null;

  const reference = raw.match(VAR_PATTERN)?.[1];
  if (reference) return resolveTokenColor(reference, tokens, depth + 1);

  const mix = raw.match(COLOR_MIX_PATTERN);
  if (mix) {
    const [, first, percent, second] = mix;
    if (!first || !percent || !second) return null;
    const a = resolveTokenColor(first, tokens, depth + 1);
    const b = resolveTokenColor(second, tokens, depth + 1);
    return a && b ? mixOklch(a, b, Number(percent)) : null;
  }

  return parseColor(raw);
}

/**
 * Extracts `--name: value;` declarations from the first CSS rule whose selector matches, for
 * example `:root` or `.dark`. Comments are stripped first. Nested braces are not expected inside
 * a token block.
 */
export function parseTokenBlock(css: string, selector: string): Record<string, TokenValue> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = withoutComments.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  const body = block?.[1] ?? "";
  return Object.fromEntries(
    body
      .split(";")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("--"))
      .map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(2, separator).trim(), line.slice(separator + 1).trim()] as const;
      }),
  );
}

/** Rounds a ratio to one decimal for display ("4.6:1"). */
export function formatRatio(ratio: number): string {
  return `${(Math.round(ratio * 10) / 10).toFixed(1)}:1`;
}
