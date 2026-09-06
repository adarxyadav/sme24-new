import { describe, expect, it } from "vitest";
import {
  ASSUMPTION_KEYS,
  BENCHMARK_WAIT_MS,
  COST_LINKED_KPIS,
  MODEL_VERSION,
  NOGA_DIVISIONS,
  NOGA_SECTIONS,
  SIZE_BANDS,
  sectionOfDivision,
  sizeBandOf,
} from "@/features/benchmark/catalogue";
import { KPI_KEYS } from "@/features/research/catalogue";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

/** The NOGA 2008 division numbers that do not exist. */
const MISSING_DIVISIONS = new Set([4, 34, 40, 44, 48, 54, 57, 67, 76, 83, 89]);

describe("the benchmark catalogue (spec 0008, AC-3)", () => {
  it("lists the 21 sections A to U with non overlapping division ranges", () => {
    expect(NOGA_SECTIONS.map((section) => section.letter).join("")).toBe("ABCDEFGHIJKLMNOPQRSTU");
    for (const [index, section] of NOGA_SECTIONS.entries()) {
      const previous = NOGA_SECTIONS[index - 1];
      expect(section.divisions[0]).toBeLessThanOrEqual(section.divisions[1]);
      if (previous) expect(section.divisions[0]).toBeGreaterThan(previous.divisions[1]);
    }
  });

  it("maps every division 01 to 99 that exists in NOGA 2008 to exactly one section", () => {
    for (let division = 1; division <= 99; division += 1) {
      const code = String(division).padStart(2, "0");
      const sections = NOGA_SECTIONS.filter(
        ({ divisions: [from, to] }) => division >= from && division <= to,
      );
      if (MISSING_DIVISIONS.has(division)) {
        expect(sections, code).toHaveLength(0);
        expect(sectionOfDivision(code)).toBeNull();
      } else {
        expect(sections, code).toHaveLength(1);
        expect(sectionOfDivision(code)).toBe(sections[0]?.letter);
      }
    }
    expect(NOGA_DIVISIONS).toHaveLength(88);
  });

  it("accepts dd and dd.dd codes and rejects everything else", () => {
    expect(sectionOfDivision("23.61")).toBe("C");
    expect(sectionOfDivision("62")).toBe("J");
    expect(sectionOfDivision(" 86.10 ")).toBe("Q");
    expect(sectionOfDivision("04")).toBeNull();
    expect(sectionOfDivision("2361")).toBeNull();
    expect(sectionOfDivision("abc")).toBeNull();
    expect(sectionOfDivision(null)).toBeNull();
    expect(sectionOfDivision(undefined)).toBeNull();
  });

  it("labels every section and division in both catalogs", () => {
    for (const messages of [de, en]) {
      const sections = messages.benchmark.noga.sections as Record<string, string>;
      const divisions = messages.benchmark.noga.divisions as Record<string, string>;
      for (const section of NOGA_SECTIONS) {
        expect(sections[section.letter], section.letter).toBeTruthy();
      }
      for (const division of NOGA_DIVISIONS) {
        expect(divisions[division], division).toBeTruthy();
      }
      expect(Object.keys(divisions)).toHaveLength(88);
      for (const band of SIZE_BANDS) {
        expect((messages.benchmark.sizeBands as Record<string, string>)[band], band).toBeTruthy();
      }
    }
  });

  it("puts a headcount in its size band at the boundaries", () => {
    expect(sizeBandOf(null)).toBe("all");
    expect(sizeBandOf(undefined)).toBe("all");
    expect(sizeBandOf(0)).toBe("all");
    expect(sizeBandOf(1)).toBe("1-49");
    expect(sizeBandOf(49)).toBe("1-49");
    expect(sizeBandOf(50)).toBe("50-249");
    expect(sizeBandOf(249)).toBe("50-249");
    expect(sizeBandOf(250)).toBe("250+");
    expect(sizeBandOf(100_000)).toBe("250+");
  });

  it("names the cost linked KPIs, the seven assumption keys, the model version and the wait", () => {
    expect(COST_LINKED_KPIS).toEqual([
      "accident_rate_per_1000_fte",
      "ltifr",
      "lost_days_per_incident",
    ]);
    for (const key of COST_LINKED_KPIS) expect(KPI_KEYS).toContain(key);
    expect(ASSUMPTION_KEYS).toEqual([
      "hours_per_fte",
      "direct_cost_per_case_chf",
      "cost_per_absence_day_chf",
      "lost_days_per_incident_default",
      "indirect_multiplier_low",
      "indirect_multiplier",
      "indirect_multiplier_high",
    ]);
    expect(MODEL_VERSION).toBe("benchmark-model@1");
    expect(BENCHMARK_WAIT_MS).toBe(120_000);
  });
});
