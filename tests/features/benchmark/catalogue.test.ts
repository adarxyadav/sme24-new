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
import { PEER_SHAPES, POSITIONS } from "@/features/benchmark/snapshot";
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
    expect(MODEL_VERSION).toBe("benchmark-model@4");
    expect(BENCHMARK_WAIT_MS).toBe(120_000);
  });

  // The band label is looked up at render time as `positions.band.<stored value>`, so a missing
  // key fails in the browser rather than at build: the two average positions of spec 0016 must
  // not be able to ship without their labels (AC-13b).
  it("labels every position in both catalogs (spec 0016, AC-13b)", () => {
    for (const messages of [de, en]) {
      const bands = messages.benchmark.positions.band as Record<string, string>;
      for (const position of POSITIONS) {
        expect(bands[position], position).toBeTruthy();
      }
      // No stale label outlives its position value either.
      expect(Object.keys(bands).sort()).toEqual([...POSITIONS].sort());
    }
  });

  it("names both peer shapes and the point row wording in both catalogs (spec 0016, AC-6)", () => {
    expect(PEER_SHAPES).toEqual(["point", "distribution"]);
    for (const messages of [de, en]) {
      const positions = messages.benchmark.positions as Record<string, unknown>;
      for (const key of ["sector", "srSector", "pointBasis", "broadened"]) {
        expect(positions[key], key).toBeTruthy();
      }
    }
  });

  // AC-6 forbids the words quarter, quartile and median on a point row "in either language", but
  // the component suite mocks `next-intl/server` with `locale: "en-CH"` hardcoded, so its
  // `not.toMatch(/quarter|quartile|median/i)` only ever reads English. A translator could put
  // "Median" or "Viertel" back into a German point row string and the whole suite would stay green.
  // The rule is a property of the catalogs, so it is asserted here against both.
  //
  // Only the keys the point row branch actually renders are in scope: the distribution branch
  // legitimately says p25/Median/p75 in `quartiles` and `srBand`, so scanning the namespace would
  // fail on wording that is correct.
  it("keeps quartile wording out of every point row string, in both catalogs (spec 0016, AC-6)", () => {
    // The keys `benchmark-segment.tsx` reads on the point path: the sector figure and its screen
    // reader narration, the basis line, the peer label parts, the two no-peer titles, and the only
    // two band labels `positionOf` can return for a point row.
    const POINT_ROW_KEYS = [
      "title",
      "sector",
      "srSector",
      "pointBasis",
      "broadened",
      "peer",
      "allIndustries",
      "nearestYear",
      "sample",
      "noPeer",
      "peerStatus.noSourceTitle",
      "peerStatus.pendingTitle",
      "band.above_average",
      "band.below_average",
      // The fatality peer rows are point rows (amendment AC-26), so the three strings the fatality
      // branch renders on that path are guarded too (amendment AC-23).
      "fatalityRate",
      "fatalityCompared",
      "fatalityNeedsHeadcount",
    ] as const;
    // Both languages, because "quarter" and "median" travel into German as "Viertel" and "Median".
    const QUARTILE_WORDING = /quartil|viertel|median|quarter|p25|p75/i;
    const read = (source: unknown, path: string): unknown =>
      path
        .split(".")
        .reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], source);

    for (const [locale, messages] of [
      ["de", de],
      ["en", en],
    ] as const) {
      for (const key of POINT_ROW_KEYS) {
        const text = read(messages.benchmark.positions, key);
        expect(typeof text, `${locale}: ${key} is missing`).toBe("string");
        expect(text as string, `${locale}: ${key} carries quartile wording`).not.toMatch(
          QUARTILE_WORDING,
        );
      }
    }
  });

  // The guard above is only honest if it would actually fire, and a regex over prose is easy to get
  // subtly wrong. The distribution strings are the control: they are supposed to name the quartiles,
  // so the same pattern must match them in both languages.
  it("uses a pattern that does catch quartile wording where it belongs (spec 0016, AC-6)", () => {
    const QUARTILE_WORDING = /quartil|viertel|median|quarter|p25|p75/i;
    for (const [locale, messages] of [
      ["de", de],
      ["en", en],
    ] as const) {
      const positions = messages.benchmark.positions as Record<string, unknown>;
      const bands = positions.band as Record<string, string>;
      expect(positions.quartiles as string, `${locale}: quartiles`).toMatch(QUARTILE_WORDING);
      expect(positions.srBand as string, `${locale}: srBand`).toMatch(QUARTILE_WORDING);
      // The four distribution bands, which are exactly the positions a point row cannot reach.
      for (const band of ["top_quarter", "above_median", "below_median", "bottom_quarter"]) {
        expect(bands[band], `${locale}: band.${band}`).toMatch(QUARTILE_WORDING);
      }
    }
  });
});

// The frame around the distribution rows (spec 0016 amendment, AC-30, decided 12 Sep 2026): the
// rows keep the quartile vocabulary and the section description no longer implies a sample of
// companies; since the "How this is calculated" disclosure was cut (owner decision of 13 Sep
// 2026) it no longer points the reader anywhere for a row's `basis` either; and the provisional
// note no longer claims the peer values are provisional, since no seeded peer row is.
describe("the copy around the distribution rows (spec 0016 amendment, AC-30)", () => {
  const QUARTILE_WORDING = /quartil|viertel|median|quarter|p25|p75/i;
  const catalogs = [
    ["de", de],
    ["en", en],
  ] as const;

  it("has the positions description name no quartiles and point at no disclosure", () => {
    for (const [locale, messages] of catalogs) {
      const { positions } = messages.benchmark;
      expect(positions.description, `${locale}: description`).not.toMatch(QUARTILE_WORDING);
      expect(positions.description, `${locale}: description`).not.toMatch(
        /How this is calculated|So wird gerechnet/,
      );
      expect("disclosure" in messages.benchmark, `${locale}: disclosure namespace`).toBe(false);
    }
  });

  it("has the provisional note stop calling the peer values provisional", () => {
    for (const [locale, messages] of catalogs) {
      expect(messages.benchmark.provisionalNote, `${locale}: provisionalNote`).not.toMatch(
        /peer values|Vergleichswerte/i,
      );
    }
  });
});
