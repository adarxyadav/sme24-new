// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MARKETING_ROUTES } from "@/i18n/pathnames";
import { LOCALE_CODE, LOCALES } from "@/i18n/routing";
import {
  BUDGETS_KB,
  evaluatePage,
  findMarkers,
  formatTable,
  KB,
  LOCALE_PREFIXES,
  measurePages,
  moduleScriptSources,
  PAGES,
  pageHtmlPath,
  pageUrlPath,
  type ScriptFile,
  SENTRY_MARKER,
  ZOD_MARKER,
} from "../../scripts/bundle-budget.mts";

const script = (src: string, kb: number, markers: readonly string[] = []): ScriptFile => ({
  src,
  gzipBytes: Math.round(kb * KB),
  markers,
});

const HTML = `<!DOCTYPE html><html><head>
<script src="/_next/static/chunks/a.js" async=""></script>
<script src="/_next/static/chunks/b.js" async=""></script>
<script src="/_next/static/chunks/polyfill.js" noModule=""></script>
<script src="/_next/static/chunks/a.js" async=""></script>
<script src="/_next/static/chunks/c.js" id="_R_" async=""></script>
<script src="https://cdn.example/other.js"></script>
<script type="application/ld+json">{"@type":"WebSite"}</script>
</head><body></body></html>`;

describe("the bundle budget script (spec 0009 amendment, AC-16)", () => {
  describe("the page list", () => {
    it("is the routing locales times MARKETING_ROUTES, in that order", () => {
      const expected = LOCALES.flatMap((locale) =>
        MARKETING_ROUTES.map((route) => ({ locale, route })),
      );
      expect(PAGES).toEqual(expected);
    });

    it("uses the same URL prefix per locale as LOCALE_CODE", () => {
      expect(LOCALE_PREFIXES).toEqual(LOCALE_CODE);
    });

    it("carries a budget for every marketing route", () => {
      expect(Object.keys(BUDGETS_KB).sort()).toEqual([...MARKETING_ROUTES].sort());
      expect(BUDGETS_KB["/contact"]).toBeGreaterThan(BUDGETS_KB["/"]);
    });

    it("resolves the German slugs for a deployment and the route segment for the local build", () => {
      expect(pageUrlPath({ locale: "de-CH", route: "/pricing" })).toBe("/de/preise");
      expect(pageUrlPath({ locale: "de-CH", route: "/about" })).toBe("/de/ueber-uns");
      expect(pageUrlPath({ locale: "en-CH", route: "/contact" })).toBe("/en/contact");
      expect(pageUrlPath({ locale: "en-CH", route: "/" })).toBe("/en");
      expect(pageUrlPath({ locale: "de-CH", route: "/" })).toBe("/de");
      expect(pageHtmlPath({ locale: "de-CH", route: "/pricing" })).toBe("de-CH/pricing.html");
      expect(pageHtmlPath({ locale: "en-CH", route: "/" })).toBe("en-CH.html");
    });
  });

  describe("the tag parsing", () => {
    it("keeps module chunk scripts in document order, drops noModule tags and duplicates", () => {
      expect(moduleScriptSources(HTML)).toEqual([
        "/_next/static/chunks/a.js",
        "/_next/static/chunks/b.js",
        "/_next/static/chunks/c.js",
      ]);
    });

    it("ignores inline scripts and scripts outside the chunks folder", () => {
      expect(moduleScriptSources('<script>1</script><script src="/x.js"></script>')).toEqual([]);
    });

    it('treats a bare nomodule attribute the same as noModule=""', () => {
      expect(
        moduleScriptSources('<script nomodule src="/_next/static/chunks/p.js"></script>'),
      ).toEqual([]);
    });

    it("finds the two markers in a chunk's text", () => {
      expect(findMarkers("x")).toEqual([]);
      expect(findMarkers(`{name:"${SENTRY_MARKER}"}`)).toEqual([SENTRY_MARKER]);
      expect(findMarkers(`$constructor("${ZOD_MARKER}")`)).toEqual([ZOD_MARKER]);
      expect(findMarkers(`${ZOD_MARKER} ${SENTRY_MARKER}`)).toEqual([SENTRY_MARKER, ZOD_MARKER]);
    });
  });

  describe("the comparison", () => {
    const landing = { locale: "en-CH", route: "/" } as const;
    const contact = { locale: "de-CH", route: "/contact" } as const;

    it("passes a page under budget with clean scripts and reports one decimal", () => {
      const result = evaluatePage(landing, [script("/a.js", 120.04), script("/b.js", 100)]);
      expect(result.ok).toBe(true);
      expect(result.kb).toBe(220);
      expect(result.budgetKb).toBe(250);
      expect(result.problems).toEqual([]);
    });

    it("fails a page over budget and names the numbers", () => {
      const result = evaluatePage(landing, [script("/a.js", 250.1)]);
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual(["/en: 250.1 kB is over the 250 kB budget"]);
    });

    it("fails any page whose module script carries the Sentry SDK", () => {
      const result = evaluatePage(contact, [script("/s.js", 10, [SENTRY_MARKER])]);
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toMatch(/Sentry SDK.*\/s\.js/);
    });

    it("allows zod on the contact page and refuses it on the content pages", () => {
      expect(evaluatePage(contact, [script("/z.js", 10, [ZOD_MARKER])]).ok).toBe(true);
      const result = evaluatePage(landing, [script("/z.js", 10, [ZOD_MARKER])]);
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toMatch(/zod runtime.*\/z\.js/);
    });

    it("fails a page without module scripts", () => {
      expect(evaluatePage(landing, []).problems).toEqual(["/en: no module scripts found"]);
    });

    it("prints one row per page with ok or over", () => {
      const table = formatTable([
        evaluatePage(landing, [script("/a.js", 200)]),
        evaluatePage(contact, [script("/a.js", 400)]),
      ]);
      const lines = table.split("\n");
      expect(lines[0]).toMatch(/^Page\s+kB\s+Budget\s+Result$/);
      expect(lines[1]).toMatch(/^\/en\s+200\.0\s+250\s+ok$/);
      expect(lines[2]).toMatch(/^\/de\/kontakt\s+400\.0\s+350\s+over$/);
    });
  });

  describe("measuring through a source", () => {
    it("fetches a shared chunk once, reports a missing page and keeps the page order", async () => {
      const fetched: string[] = [];
      const source = {
        html: async (page: { route: string }) => (page.route === "/about" ? undefined : HTML),
        script: async (src: string) => {
          fetched.push(src);
          return script(src, 50, src.endsWith("c.js") ? [ZOD_MARKER] : []);
        },
      };
      const results = await measurePages(source, [
        { locale: "en-CH", route: "/" },
        { locale: "en-CH", route: "/about" },
        { locale: "en-CH", route: "/contact" },
      ]);
      expect(results.map((result) => result.label)).toEqual(["/en", "/en/about", "/en/contact"]);
      expect(results[0]?.ok).toBe(false);
      expect(results[0]?.problems[0]).toMatch(/zod runtime/);
      expect(results[1]?.problems).toEqual(["/en/about: page not found"]);
      expect(results[2]?.ok).toBe(true);
      expect(results[2]?.kb).toBe(150);
      expect(fetched).toHaveLength(3);
    });
  });
});
