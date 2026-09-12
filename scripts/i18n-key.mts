/**
 * Look one message key up in both catalogs without reading either whole:
 *
 *   pnpm i18n:key shell.sidebar.assessments   # the value and line number per locale
 *   pnpm i18n:key selfAssessment              # every key under a namespace
 *   pnpm i18n:key --search "Benchmark"        # the keys whose English value matches
 *
 * `messages/de-CH.json` and `messages/en-CH.json` are ~337 kB together, about 90k tokens, so an
 * agent that reads them to change three strings spends more on the lookup than on the change. This
 * prints the few lines that matter instead. The line numbers are the real ones in each file, so an
 * edit can jump straight there. Exit code 1 when a key is missing from either catalog, which also
 * makes it a quick check that the two stay in step. Plain Node, no dependencies.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

export type CatalogLocale = "de-CH" | "en-CH";
export type Messages = { readonly [key: string]: string | Messages };

/** The two catalogs, in the order they are printed. English second: it is the source language. */
export const LOCALES: readonly CatalogLocale[] = ["de-CH", "en-CH"];

const ROOT = join(import.meta.dirname, "..");

/** Reads one catalog as parsed JSON plus its raw lines, which carry the line numbers. */
const readCatalog = (locale: CatalogLocale) => {
  const raw = readFileSync(join(ROOT, "messages", `${locale}.json`), "utf8");
  return { messages: JSON.parse(raw) as Messages, lines: raw.split("\n") };
};

/** Walks a dotted path into a catalog; undefined when any segment is missing. */
export const valueAt = (messages: Messages, path: string): string | Messages | undefined =>
  path.split(".").reduce<string | Messages | undefined>((node, segment) => {
    if (node === undefined || typeof node === "string") return undefined;
    return node[segment];
  }, messages);

/** Flattens a subtree to dotted leaf paths, so a namespace prints as its keys. */
export const flatten = (
  node: string | Messages,
  prefix = "",
): readonly (readonly [string, string])[] => {
  if (typeof node === "string") return [[prefix, node]];
  return Object.entries(node).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
};

/**
 * The 1-based line of a leaf key in the raw file. The catalogs are written by hand and by Biome,
 * one key per line, so matching the last path segment as a quoted key after the parent's line is
 * exact enough to navigate by; 0 means it was not found on its own line.
 */
export const lineOf = (lines: readonly string[], path: string): number => {
  const segments = path.split(".");
  let from = 0;
  for (const segment of segments) {
    const needle = `"${segment}":`;
    const index = lines.findIndex((line, i) => i >= from && line.trimStart().startsWith(needle));
    if (index === -1) return 0;
    from = index + 1;
  }
  return from;
};

const { values, positionals } = parseArgs({
  options: { search: { type: "string" } },
  allowPositionals: true,
});

const catalogs = LOCALES.map((locale) => ({ locale, ...readCatalog(locale) }));

if (values.search !== undefined) {
  const needle = values.search.toLowerCase();
  const english = catalogs.find((c) => c.locale === "en-CH");
  if (!english) throw new Error("en-CH catalog missing");
  const hits = flatten(english.messages).filter(([, value]) =>
    value.toLowerCase().includes(needle),
  );
  if (hits.length === 0) {
    console.log(`No English value matches ${JSON.stringify(values.search)}.`);
    process.exit(1);
  }
  for (const [path, value] of hits)
    console.log(`${path}\n  en-CH:${lineOf(english.lines, path)}  ${value}`);
  process.exit(0);
}

const path = positionals[0];
if (path === undefined) {
  console.error("Usage: pnpm i18n:key <dotted.key|namespace> | pnpm i18n:key --search <text>");
  process.exit(1);
}

let missing = false;
for (const { locale, messages, lines } of catalogs) {
  const found = valueAt(messages, path);
  if (found === undefined) {
    console.log(`${locale}: (missing)`);
    missing = true;
    continue;
  }
  for (const [leaf, value] of flatten(found, path)) {
    console.log(`${locale}:${lineOf(lines, leaf)}  ${leaf}\n  ${value}`);
  }
}

process.exit(missing ? 1 : 0);
