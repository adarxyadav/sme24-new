import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  formatRatio,
  mixOklch,
  parseColor,
  parseTokenBlock,
  resolveTokenColor,
} from "@/lib/contrast";
import { CHART_TOKENS, CONTRAST_PAIRS, SEMANTIC_FILLS } from "@/lib/design-tokens";

const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");
const themes = {
  light: parseTokenBlock(css, ":root"),
  dark: parseTokenBlock(css, ".dark"),
} as const;

describe("design token contrast gate (spec 0003, AC-1)", () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    describe(theme, () => {
      it("defines every token the pair list and the gallery rely on", () => {
        const needed = new Set([
          ...CONTRAST_PAIRS.flatMap((pair) => [pair.foreground, pair.background]),
          ...SEMANTIC_FILLS.flatMap((token) => [token, `${token}-foreground`, `${token}-subtle`]),
          ...CHART_TOKENS,
        ]);
        const missing = [...needed].filter((name) => !tokens[name]);
        expect(missing).toEqual([]);
      });

      for (const pair of CONTRAST_PAIRS) {
        it(`--${pair.foreground} on --${pair.background} reaches ${pair.minimum}:1`, () => {
          const foreground = resolveTokenColor(pair.foreground, tokens);
          const background = resolveTokenColor(pair.background, tokens);
          expect(foreground, `--${pair.foreground} is not a color`).not.toBeNull();
          expect(background, `--${pair.background} is not a color`).not.toBeNull();
          if (!foreground || !background) return;
          const ratio = contrastRatio(foreground, background);
          expect(
            ratio,
            `--${pair.foreground} on --${pair.background} is ${formatRatio(ratio)}`,
          ).toBeGreaterThanOrEqual(pair.minimum);
        });
      }
    });
  }

  it("keeps color-scheme in step with the theme so native controls follow", () => {
    expect(themes.light["color-scheme" as keyof typeof themes.light]).toBeUndefined();
    expect(css).toMatch(/:root\s*\{\s*color-scheme:\s*light;/);
    expect(css).toMatch(/\.dark\s*\{\s*color-scheme:\s*dark;/);
  });

  it("no longer imports the shadcn/tailwind.css file that the package does not ship", () => {
    expect(css).not.toContain('@import "shadcn/tailwind.css"');
  });
});

describe("contrast helpers", () => {
  it("composites a translucent value over its background before measuring", () => {
    const white = parseColor("oklch(1 0 0)");
    const black = parseColor("oklch(0 0 0)");
    const faint = parseColor("oklch(1 0 0 / 12%)");
    if (!white || !black || !faint) throw new Error("fixture colors did not parse");
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
    expect(contrastRatio(faint, black)).toBeLessThan(contrastRatio(white, black));
    expect(contrastRatio(faint, black)).toBeGreaterThan(1);
  });

  it("evaluates color-mix from the two parsed colors", () => {
    const a = parseColor("oklch(0.5 0.1 150)");
    const b = parseColor("oklch(1 0 0)");
    if (!a || !b) throw new Error("fixture colors did not parse");
    const mixed = mixOklch(a, b, 12);
    expect(mixed.mode).toBe("oklch");
    expect((mixed as { l: number }).l).toBeCloseTo(0.94, 2);
  });

  it("follows var() references when resolving a token", () => {
    const tokens = { a: "var(--b)", b: "oklch(0.5 0 0)", loop: "var(--loop)" };
    expect(resolveTokenColor("a", tokens)?.mode).toBe("oklch");
    expect(resolveTokenColor("loop", tokens)).toBeNull();
    expect(resolveTokenColor("missing", tokens)).toBeNull();
  });

  it("parses only the requested block", () => {
    const sample = `:root { --x: red; --y: var(--x); }\n.dark { --x: blue; }`;
    expect(parseTokenBlock(sample, ":root")).toEqual({ x: "red", y: "var(--x)" });
    expect(parseTokenBlock(sample, ".dark")).toEqual({ x: "blue" });
  });
});
