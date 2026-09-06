/**
 * The first load JavaScript budget of the marketing pages (spec 0009, AC-16, amended 2026-09-06):
 *
 *   pnpm build && pnpm budget                       # the local .next output
 *   pnpm budget --url https://sme24-abc.vercel.app  # a deployment (falls back to PLAYWRIGHT_BASE_URL)
 *
 * For each of the eight (locale, route) pairs the script collects the module `<script>` files the
 * prerendered HTML references (the `nomodule` polyfill does not count, a browser that runs modules
 * never downloads it; a chunk loaded later through `import()` does not count, it is off the
 * critical path), sums their gzipped bytes and compares the total with the budget in `BUDGETS_KB`
 * (1 kB is 1024 bytes, the same per language). It also fails when a module script of any page
 * contains the Sentry integration name `BrowserTracing`, or a module script of `/`, `/pricing` or
 * `/about` contains the zod marker `$ZodError`. One table, exit code 1 on any page over budget,
 * any marker hit or any missing page. Remote mode sends `x-vercel-protection-bypass` from
 * `VERCEL_AUTOMATION_BYPASS_SECRET` when set. Plain Node; `docs/marketing.md` cites the budgets
 * from here and `tests/scripts/bundle-budget.test.ts` keeps `PAGES` equal to the routing tables.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { PATHNAMES } from "../src/i18n/pathnames.ts";

export type MarketingRoute = "/" | "/pricing" | "/about" | "/contact";
export type BudgetLocale = "en-CH" | "de-CH";
export type BudgetPage = { readonly locale: BudgetLocale; readonly route: MarketingRoute };

/** The URL prefix per locale (`LOCALE_CODE` in `src/i18n/routing.ts`, literal so the script stays plain Node). */
export const LOCALE_PREFIXES: Readonly<Record<BudgetLocale, string>> = {
  "de-CH": "de",
  "en-CH": "en",
};

/** The budgets in kB of 1024 bytes per route, the same in both languages. The single source. */
export const BUDGETS_KB: Readonly<Record<MarketingRoute, number>> = {
  "/": 250,
  "/pricing": 250,
  "/about": 250,
  "/contact": 350,
};

/** The routes whose module scripts must carry no zod (the contact form keeps its resolver). */
export const ZOD_FREE_ROUTES: readonly MarketingRoute[] = ["/", "/pricing", "/about"];

/** A string literal minification keeps: the browser tracing integration's name. */
export const SENTRY_MARKER = "BrowserTracing";
/** A string literal minification keeps: zod's error constructor name. */
export const ZOD_MARKER = "$ZodError";

/** The eight pages, listed literally (`routing.locales` times `MARKETING_ROUTES`, equality tested). */
export const PAGES: readonly BudgetPage[] = [
  { locale: "de-CH", route: "/" },
  { locale: "de-CH", route: "/pricing" },
  { locale: "de-CH", route: "/about" },
  { locale: "de-CH", route: "/contact" },
  { locale: "en-CH", route: "/" },
  { locale: "en-CH", route: "/pricing" },
  { locale: "en-CH", route: "/about" },
  { locale: "en-CH", route: "/contact" },
];

export const KB = 1024;
const CHUNK_PREFIX = "/_next/static/chunks/";

/** One module script of a page: its `src`, its gzipped size and the markers found in its text. */
export type ScriptFile = {
  readonly src: string;
  readonly gzipBytes: number;
  readonly markers: readonly string[];
};

/** The verdict for one page: the measured size, the budget and every problem found. */
export type PageResult = {
  readonly page: BudgetPage;
  readonly label: string;
  readonly kb: number;
  readonly budgetKb: number;
  readonly scripts: readonly ScriptFile[];
  readonly problems: readonly string[];
  readonly ok: boolean;
};

/** The `src` of every module script tag under `/_next/static/chunks/`: `noModule` tags dropped, duplicates removed, document order kept. Pure. */
export function moduleScriptSources(html: string): readonly string[] {
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  const sources = tags
    .filter((tag) => !/\snomodule(?=[\s=>/])/i.test(tag))
    .map((tag) => /\ssrc\s*=\s*"([^"]+)"/i.exec(tag)?.[1])
    .filter((src): src is string => src !== undefined)
    .filter((src) => src.startsWith(CHUNK_PREFIX));
  return [...new Set(sources)];
}

/** The markers present in a script's text, in a fixed order. Pure. */
export function findMarkers(text: string): readonly string[] {
  return [SENTRY_MARKER, ZOD_MARKER].filter((marker) => text.includes(marker));
}

/** The URL path of a page on a deployment: the locale prefix plus the localized slug from `PATHNAMES`. Pure. */
export function pageUrlPath(page: BudgetPage): string {
  const prefix = `/${LOCALE_PREFIXES[page.locale]}`;
  const entry = PATHNAMES[page.route];
  const slug = typeof entry === "string" ? entry : entry[page.locale];
  return slug === "/" ? prefix : `${prefix}${slug}`;
}

/** The prerendered HTML file of a page under `.next/server/app` (the route segment, not the German slug). Pure. */
export function pageHtmlPath(page: BudgetPage): string {
  return page.route === "/" ? `${page.locale}.html` : `${page.locale}${page.route}.html`;
}

/** kB of 1024 bytes, one decimal. Pure. */
export function toKb(bytes: number): number {
  return Math.round((bytes / KB) * 10) / 10;
}

/** Compares one page's module scripts with its budget and the marker rules. Pure. */
export function evaluatePage(page: BudgetPage, scripts: readonly ScriptFile[]): PageResult {
  const label = pageUrlPath(page);
  const budgetKb = BUDGETS_KB[page.route];
  const bytes = scripts.reduce((sum, script) => sum + script.gzipBytes, 0);
  const kb = toKb(bytes);
  const problems: string[] = [];
  if (scripts.length === 0) problems.push(`${label}: no module scripts found`);
  if (kb > budgetKb) problems.push(`${label}: ${kb} kB is over the ${budgetKb} kB budget`);
  for (const script of scripts) {
    if (script.markers.includes(SENTRY_MARKER)) {
      problems.push(`${label}: the browser Sentry SDK is in a module script (${script.src})`);
    }
    if (ZOD_FREE_ROUTES.includes(page.route) && script.markers.includes(ZOD_MARKER)) {
      problems.push(`${label}: the zod runtime is in a module script (${script.src})`);
    }
  }
  return { page, label, kb, budgetKb, scripts, problems, ok: problems.length === 0 };
}

/** The result table: page, kB, budget, ok or over. Pure. */
export function formatTable(results: readonly PageResult[]): string {
  const rows = [
    ["Page", "kB", "Budget", "Result"],
    ...results.map((result) => [
      result.label,
      result.kb.toFixed(1),
      String(result.budgetKb),
      result.ok ? "ok" : "over",
    ]),
  ];
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length))) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** Where a page's HTML and its scripts come from: the local build output or a deployment. */
type Source = {
  readonly html: (page: BudgetPage) => Promise<string | undefined>;
  readonly script: (src: string) => Promise<ScriptFile>;
};

function localSource(nextDir: string): Source {
  return {
    html: async (page) => {
      const file = join(nextDir, "server", "app", pageHtmlPath(page));
      return existsSync(file) ? readFileSync(file, "utf8") : undefined;
    },
    script: async (src) => {
      const file = join(nextDir, src.replace(/^\/_next\//, ""));
      const bytes = readFileSync(file);
      return {
        src,
        gzipBytes: gzipSync(bytes).length,
        markers: findMarkers(bytes.toString("utf8")),
      };
    },
  };
}

function remoteSource(base: string, bypassSecret: string | undefined): Source {
  const headers: Record<string, string> = bypassSecret
    ? { "x-vercel-protection-bypass": bypassSecret }
    : {};
  return {
    html: async (page) => {
      const response = await fetch(new URL(pageUrlPath(page), base), { headers });
      return response.ok ? await response.text() : undefined;
    },
    script: async (src) => {
      const response = await fetch(new URL(src, base), {
        headers: { ...headers, "accept-encoding": "gzip" },
      });
      if (!response.ok) throw new Error(`${src}: HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const encoding = response.headers.get("content-encoding");
      const length = Number(response.headers.get("content-length"));
      // undici hands back the decoded body but keeps the headers: the compressed length is the
      // header when the CDN sent gzip with a length, else the body gzipped here, the local way.
      const gzipBytes =
        encoding === "gzip" && Number.isFinite(length) && length > 0
          ? length
          : gzipSync(body).length;
      return { src, gzipBytes, markers: findMarkers(body.toString("utf8")) };
    },
  };
}

/** Measures every page through `source`, fetching each shared chunk once. */
export async function measurePages(
  source: Source,
  pages: readonly BudgetPage[] = PAGES,
): Promise<readonly PageResult[]> {
  const cache = new Map<string, Promise<ScriptFile>>();
  const scriptFor = (src: string) => {
    const cached = cache.get(src) ?? source.script(src);
    cache.set(src, cached);
    return cached;
  };
  const results: PageResult[] = [];
  for (const page of pages) {
    const html = await source.html(page);
    if (html === undefined) {
      results.push({
        page,
        label: pageUrlPath(page),
        kb: 0,
        budgetKb: BUDGETS_KB[page.route],
        scripts: [],
        problems: [`${pageUrlPath(page)}: page not found`],
        ok: false,
      });
      continue;
    }
    const scripts = await Promise.all(moduleScriptSources(html).map(scriptFor));
    results.push(evaluatePage(page, scripts));
  }
  return results;
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { url: { type: "string" } } });
  const base = values.url ?? process.env.PLAYWRIGHT_BASE_URL;
  const source = base
    ? remoteSource(base, process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
    : localSource(join(process.cwd(), ".next"));
  console.log(base ? `Measuring ${base}` : "Measuring the local .next build");
  const results = await measurePages(source);
  console.log(formatTable(results));
  const problems = results.flatMap((result) => result.problems);
  if (problems.length === 0) return 0;
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join("\n")}`);
  return 1;
}

const runAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsScript) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`budget: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
