import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  confidenceLevel,
  inRange,
  KPI_KEYS,
  KPI_LIST,
  parseKpiValue,
  RUN_LIMIT_PER_DAY,
} from "@/features/research/catalogue";
import { classifyRunInsertError } from "@/features/research/errors";
import { lookupSchema, normalizeWebsite, rerunSchema } from "@/features/research/schema";
import { parseSummary, researchSummarySchema } from "@/features/research/summary";

/** The keys the data migration seeds, in its insert order (spec 0007, AC-1). */
function seededKeys(): string[] {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((name) => name.endsWith("_research_pipeline.sql"));
  if (!file) throw new Error("the research pipeline migration is missing");
  const sql = readFileSync(join(dir, file), "utf8");
  const seed = sql.slice(sql.indexOf("insert into public.kpi_definitions"));
  return [...seed.matchAll(/^\s*\('([a-z0-9_]+)',\s*$/gm)].map((match) => match[1] as string);
}

describe("the KPI catalogue (spec 0007, AC-1)", () => {
  it("lists the same eight keys as the migration seed, in the same order", () => {
    expect(seededKeys()).toEqual([...KPI_KEYS]);
  });

  it("gives every KPI a range, a parse rule, a format and a one line hint", () => {
    for (const kpi of KPI_LIST) {
      expect(kpi.range[0]).toBeLessThan(kpi.range[1]);
      expect(["decimal", "integer", "boolean"]).toContain(kpi.parse);
      expect(["decimal2", "integer", "percent1", "yesNo"]).toContain(kpi.format);
      expect(kpi.hint.split("\n")).toHaveLength(1);
    }
  });

  it("parses source strings by rule: decimals with comma or apostrophe, integers, yes and no", () => {
    expect(parseKpiValue("decimal", "2,4 per million hours, 2024")).toBe(2.4);
    expect(parseKpiValue("decimal", "1'250.5 days")).toBe(1250.5);
    expect(parseKpiValue("integer", "3 fatalities (2023)")).toBe(3);
    expect(parseKpiValue("boolean", "yes, certified since 2019")).toBe(1);
    expect(parseKpiValue("boolean", "no")).toBe(0);
    expect(parseKpiValue("decimal", "not found")).toBeNull();
    expect(parseKpiValue("boolean", "unclear")).toBeNull();
  });

  it("checks the plausible range and the confidence thresholds", () => {
    expect(inRange("ltifr", 2.4)).toBe(true);
    expect(inRange("ltifr", 250)).toBe(false);
    expect(inRange("iso_45001_certified", 1)).toBe(true);
    expect(confidenceLevel(CONFIDENCE_HIGH)).toBe("high");
    expect(confidenceLevel(CONFIDENCE_MEDIUM)).toBe("medium");
    expect(confidenceLevel(0.39)).toBe("low");
    expect(RUN_LIMIT_PER_DAY).toBe(5);
  });
});

describe("the lookup schema (AC-3)", () => {
  it("normalises the website to an https origin and keeps a typed www", () => {
    expect(normalizeWebsite("example.ch")).toBe("https://example.ch");
    expect(normalizeWebsite("www.example.ch")).toBe("https://www.example.ch");
    expect(normalizeWebsite("https://Example.ch/reports?x=1#top")).toBe("https://example.ch");
    expect(normalizeWebsite("http://example.ch/")).toBe("https://example.ch");
    expect(normalizeWebsite("   ")).toBeNull();
    expect(normalizeWebsite("not a host")).toBeNull();
  });

  it("trims the name to 2 to 200 characters and treats an empty website as null", () => {
    expect(lookupSchema.safeParse({ name: " Muster AG ", website: "" }).data).toEqual({
      name: "Muster AG",
      website: null,
    });
    expect(lookupSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(lookupSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    const bad = lookupSchema.safeParse({ name: "Muster AG", website: "??" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe("websiteInvalid");
  });

  it("types the rerun form with the company id and an optional legal name", () => {
    const parsed = rerunSchema.safeParse({
      companyId: "0c000000-0000-4000-8000-00000000000a",
      name: "Muster AG",
      legalName: "",
      website: "muster.ch",
    });
    expect(parsed.data).toMatchObject({ legalName: null, website: "https://muster.ch" });
    expect(rerunSchema.safeParse({ companyId: "nope", name: "Muster AG" }).success).toBe(false);
  });
});

describe("the run insert error mapping (AC-9)", () => {
  it("maps the open run index violation, matched on the constraint name", () => {
    expect(
      classifyRunInsertError({
        code: "23505",
        details: "Key (company_id)=(0c000000-0000-4000-8000-00000000000a) already exists.",
        hint: null,
        message:
          'duplicate key value violates unique constraint "research_runs_one_open_per_company_idx"',
      }),
    ).toBe("run_in_progress");
  });

  it("maps a row level security violation on the insert to the quota", () => {
    expect(
      classifyRunInsertError({
        code: "42501",
        details: null,
        hint: null,
        message: 'new row violates row-level security policy for table "research_runs"',
      }),
    ).toBe("quota_exceeded");
  });

  it("treats every other error, including another unique violation, as unexpected", () => {
    expect(
      classifyRunInsertError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "companies_organization_id_uid_idx"',
      }),
    ).toBe("unexpected");
    expect(classifyRunInsertError({ code: "23503", message: "fk" })).toBe("unexpected");
    expect(classifyRunInsertError(null)).toBe("unexpected");
  });
});

describe("the summary schema", () => {
  it("accepts a progress summary and a terminal one, and rejects another shape", () => {
    expect(parseSummary({ version: 1, step: "searching" })).toEqual({
      version: 1,
      step: "searching",
    });
    expect(
      researchSummarySchema.safeParse({
        version: 1,
        step: "done",
        processor: "fixture",
        sourcesFound: 5,
        kpisExtracted: 24,
        coverage: { ltifr: "found" },
        years: [2025, 2024, 2023],
        sources: [],
        text: null,
        companyFacts: { canton: "ZH" },
        dropped: [{ key: "ltifr", year: 1999, value: 1, reason: "bad_year" }],
        validation: "skipped",
        promptVersion: "",
        durations: { searchMs: 1, validationMs: 0, totalMs: 2 },
      }).success,
    ).toBe(true);
    expect(parseSummary({ version: 2, step: "done" })).toBeNull();
    expect(parseSummary("x")).toBeNull();
  });
});
