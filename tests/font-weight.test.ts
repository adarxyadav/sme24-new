import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The weight ceiling (owner decision of 2026-09-10): nothing in the product sets a font weight
 * above 600. Geist carries a 100–900 axis, so every heavier weight is one utility away, and the
 * three surfaces that used to exceed the ceiling were spread across Tailwind utilities, the
 * wordmark and the email templates' inline styles -- three different spellings of the same value,
 * which is why this is a test rather than a line in the design reference.
 */
const MAX_WEIGHT = 600;
const SRC = resolve(__dirname, "../src");

/** Every source file under `src/` that can carry a weight. Pure apart from the reads. */
function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("font weight ceiling (owner decision of 2026-09-10)", () => {
  it("finds source files to check", () => {
    // Guards the walker itself: a glob that silently matched nothing would make every case below
    // pass without reading a line.
    expect(files.length).toBeGreaterThan(100);
  });

  it("uses no Tailwind weight utility above font-semibold", () => {
    // `font-bold` is 700, `font-extrabold` 800, `font-black` 900. `font-semibold` is exactly the
    // ceiling and stays allowed.
    const offenders = files.flatMap(({ path, text }) => {
      const hits = text.match(/\bfont-(bold|extrabold|black)\b/g);
      return hits ? [`${path}: ${[...new Set(hits)].join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("sets no arbitrary Tailwind weight above the ceiling", () => {
    // `font-[700]` and friends bypass the named utilities entirely.
    const offenders = files.flatMap(({ path, text }) => {
      const hits = [...text.matchAll(/\bfont-\[(\d{3})\]/g)]
        .map((match) => Number(match[1]))
        .filter((weight) => weight > MAX_WEIGHT);
      return hits.length > 0 ? [`${path}: ${hits.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("declares no CSS or inline font weight above the ceiling", () => {
    // The email templates style with inline objects (`fontWeight: 800`) and the token block uses
    // CSS custom properties (`--text-heading-32--font-weight: 600`), so both spellings count.
    const offenders = files.flatMap(({ path, text }) => {
      const hits = [...text.matchAll(/font-weight\s*:\s*(\d{3})|fontWeight\s*:\s*(\d{3})/g)]
        .map((match) => Number(match[1] ?? match[2]))
        .filter((weight) => weight > MAX_WEIGHT);
      return hits.length > 0 ? [`${path}: ${hits.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("keeps every display and text token at or below the ceiling", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const weights = [...css.matchAll(/--text-[\w-]+--font-weight:\s*(\d{3})/g)].map((match) =>
      Number(match[1]),
    );
    expect(weights.length).toBeGreaterThan(10);
    expect(Math.max(...weights)).toBeLessThanOrEqual(MAX_WEIGHT);
  });
});
