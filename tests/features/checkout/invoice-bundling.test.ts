// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import triggerConfig from "../../../trigger.config";

/**
 * The `render-invoice` bundling contract (spec 0011, AC-4 and AC-10). pdfkit reaches its standard
 * fonts through the Node subpath import `#standard-fonts/*`, which it resolves at runtime with
 * `createRequire(import.meta.url)`. A subpath import only resolves against the `imports` field of
 * the *nearest* package.json, so once pdfkit is bundled into the deployed task the specifier is
 * looked up against the bundle's own package instead of pdfkit's, and the task dies on the first
 * `.font("Helvetica")` call. Keeping pdfkit external leaves the specifier where it was written.
 *
 * This is a build config test on purpose. Vitest runs unbundled, so the drawing code in
 * `src/trigger/render-invoice.ts` resolves `#standard-fonts/*` correctly here even with the bug
 * present: a unit test of the drawing path passes either way and proves nothing. What actually
 * fails without the fix is the deployed bundle, so the config is what gets asserted.
 *
 * The deeper check, if this ever needs stronger proof than a config assertion: bundle a tiny entry
 * that does `new PDFDocument().font("Helvetica").text("x")` with esbuild (`bundle: true`,
 * `platform: "node"`, no `external`), run the output in a child process, and watch it throw
 * `ERR_PACKAGE_IMPORT_NOT_DEFINED`; add `external: ["pdfkit"]` and it renders. That is real proof
 * but costs an esbuild run and a spawn per test, so it stays documented rather than run.
 */

const require = createRequire(import.meta.url);

/**
 * Walks up from a resolved module file to the package.json that owns it. Needed because pdfkit's
 * `exports` map does not expose `./package.json`, so it cannot be required or resolved by subpath,
 * and pnpm's store puts the real directory somewhere `node_modules/pdfkit` only links to.
 */
function nearestManifest(fromFile: string): string {
  let dir = dirname(fromFile);
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no package.json above ${fromFile}`);
    dir = parent;
  }
}

describe("render-invoice bundling", () => {
  it("keeps pdfkit external so its font subpath import survives the deploy bundle", () => {
    // Read through an empty default so dropping `external` altogether fails as a missing entry
    // rather than as an "undefined is not an array" type complaint.
    expect(triggerConfig.build?.external ?? []).toContain("pdfkit");
  });

  it("still points the tasks at the directory that holds render-invoice", () => {
    expect(triggerConfig.dirs).toContain("./src/trigger");
  });

  it("externalises pdfkit for the reason it declares: a subpath import it resolves itself", () => {
    // If pdfkit ever drops the `#standard-fonts/*` import, the reason for the external entry is
    // gone and this whole file should be revisited rather than kept as folklore.
    const manifest = nearestManifest(require.resolve("pdfkit"));
    const pdfkitPackage = JSON.parse(readFileSync(manifest, "utf8")) as {
      imports?: Record<string, unknown>;
    };

    expect(Object.keys(pdfkitPackage.imports ?? {})).toContain("#standard-fonts/*");
  });

  it("leaves swissqrbill bundled, because only pdfkit needs the escape", () => {
    expect(triggerConfig.build?.external ?? []).not.toContain("swissqrbill");
  });
});
