import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The model call line (spec 0012, AC-17): nothing under `src/features/benchmark/` may import
 * from `src/lib/ai/` or from the `ai` package, so the benchmark stays pure arithmetic by the
 * build rather than by convention. A model call belongs to the peer proposal and the research
 * validation only.
 */
const ROOT = join(__dirname, "../../../src/features/benchmark");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const FORBIDDEN = [
  /from\s+["']@\/lib\/ai(\/|["'])/,
  /from\s+["'](\.\.\/)+lib\/ai(\/|["'])/,
  /from\s+["']ai["']/,
  /import\s*\(\s*["']@\/lib\/ai/,
];

describe("the benchmark stays free of model calls (spec 0012, AC-17)", () => {
  const files = sourceFiles(ROOT);

  it("sees the benchmark feature files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [file.replace(`${ROOT}/`, "")] as const))(
    "%s imports nothing from src/lib/ai or the ai package",
    (relative) => {
      const source = readFileSync(join(ROOT, relative), "utf8");
      for (const pattern of FORBIDDEN) {
        expect(source, `${relative} matches ${pattern}`).not.toMatch(pattern);
      }
    },
  );
});
