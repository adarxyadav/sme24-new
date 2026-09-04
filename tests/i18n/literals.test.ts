import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ALLOWED_FILES, ALLOWED_LITERALS, ALLOWED_PATTERNS } from "./literal-allowlist";

/**
 * The literal scan (spec 0004, AC-5): every `.tsx` file under `src/` is parsed with the TypeScript
 * compiler; JSX text, string and template literals inside JSX expression containers, and the
 * `aria-label`, `placeholder`, `title` and `alt` attributes fail the test when they carry two or
 * more letters, unless the file or the literal is in `literal-allowlist.ts`. Strings in `.ts`
 * files (actions, schemas, constants) are outside the scan and stay a review concern.
 */
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const SCANNED_ATTRIBUTES = new Set(["aria-label", "placeholder", "title", "alt"]);
const TWO_LETTERS = /\p{L}[\s\S]*\p{L}/u;

type Finding = { readonly file: string; readonly line: number; readonly text: string };

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function isAllowed(text: string): boolean {
  return (
    !TWO_LETTERS.test(text) ||
    ALLOWED_LITERALS.includes(text) ||
    ALLOWED_PATTERNS.some((pattern) => pattern.test(text))
  );
}

/**
 * True for an expression container that renders text: a child of an element or fragment, or the
 * value of one of the scanned attributes. `className={...}`, `id={...}` and friends are skipped.
 */
function isUserFacingContainer(node: ts.JsxExpression): boolean {
  const { parent } = node;
  if (ts.isJsxAttribute(parent)) return SCANNED_ATTRIBUTES.has(parent.name.getText());
  return ts.isJsxElement(parent) || ts.isJsxFragment(parent);
}

/** The static text of a template literal: the head plus every span's literal part. */
function templateText(node: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
}

function scan(file: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: Finding[] = [];
  const report = (node: ts.Node, text: string) => {
    const trimmed = text.trim();
    if (isAllowed(trimmed)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ file: relative(ROOT, file), line: line + 1, text: trimmed });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      report(node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && isUserFacingContainer(node)) {
      const { expression } = node;
      if (ts.isStringLiteral(expression)) report(expression, expression.text);
      else if (ts.isTemplateLiteral(expression)) report(expression, templateText(expression));
    } else if (
      ts.isJsxAttribute(node) &&
      SCANNED_ATTRIBUTES.has(node.name.getText(source)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      report(node.initializer, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

describe("hardcoded text scan (spec 0004, AC-5)", () => {
  const files = tsxFiles(SRC).filter((file) => !ALLOWED_FILES.includes(relative(ROOT, file)));

  it("finds the components to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("finds no user facing literal outside the catalogs and the allow list", () => {
    const findings = files.flatMap(scan);
    const lines = findings.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`);
    expect(
      lines,
      `hardcoded text; move it to messages/de-CH.json or the allow list:\n${lines.join("\n")}`,
    ).toEqual([]);
  });
});
