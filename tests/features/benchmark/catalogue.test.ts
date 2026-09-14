import { describe, expect, it } from "vitest";
import {
  BENCHMARK_WAIT_MS,
  MODEL_VERSION,
  NOGA_DIVISIONS,
  NOGA_SECTIONS,
  SECTION_NAMES_EN,
  sectionNameEn,
  sectionOfDivision,
} from "@/features/benchmark/catalogue";
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
    }
  });

  it("names the model version and the wait", () => {
    // Spec 0022 (AC-12): `@7` is the peers of one research run and the owner's loss table, and the
    // earlier schemas are gone, so a stored row of any of them reads as outdated (AC-18).
    expect(MODEL_VERSION).toBe("benchmark-model@7");
    expect(BENCHMARK_WAIT_MS).toBe(120_000);
  });

  // The peer search objective runs in a task where next-intl is not available, so the English
  // section names live in code; the client facing labels stay in the catalogs and the two must say
  // the same thing (spec 0022, AC-5).
  it("matches the English section names in code with the English catalog", () => {
    const sections = en.benchmark.noga.sections as Record<string, string>;
    for (const section of NOGA_SECTIONS) {
      expect(SECTION_NAMES_EN[section.letter], section.letter).toBe(sections[section.letter]);
      expect(sectionNameEn(section.letter)).toBe(sections[section.letter]);
    }
    expect(sectionNameEn("Z")).toBe("Z");
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

// The four page blocks of `benchmark-model@7` (spec 0022, AC-27): every string the peer table, the
// loss card, the expert cards and the package card render lives in both catalogs, and the forbidden
// word test of spec 0021 keeps "verified" out of the peer keys. The research found these companies
// in public reports and nobody checked them, so no peer string may claim otherwise.
describe("the page strings of the peer benchmark (spec 0022, AC-27)", () => {
  const VERIFIED = /verified|verifiziert|geprüft|bestätigt/i;
  const flatten = (value: unknown, prefix = ""): ReadonlyArray<readonly [string, string]> =>
    typeof value === "string"
      ? [[prefix, value]]
      : Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
          flatten(child, prefix ? `${prefix}.${key}` : key),
        );

  const catalogs = [
    ["de", de],
    ["en", en],
  ] as const;

  it("never calls a peer figure verified, in either language", () => {
    for (const [locale, messages] of catalogs) {
      const strings = flatten(messages.benchmark.peers, "peers");
      expect(strings.length, `${locale}: peers has strings`).toBeGreaterThan(0);
      for (const [key, text] of strings) {
        expect(text, `${locale}: benchmark.${key} calls a peer figure verified`).not.toMatch(
          VERIFIED,
        );
      }
    }
  });

  it("has every key the peer table renders, in both catalogs", () => {
    for (const [locale, messages] of catalogs) {
      const peers = messages.benchmark.peers as Record<string, unknown>;
      // The badge, both rank shapes, the thin sentence and the footnote (AC-20).
      for (const key of ["heading", "badge", "footnote", "empty"]) {
        expect(peers[key], `${locale}: peers.${key}`).toBeTruthy();
      }
      const rank = peers.rank as Record<string, string>;
      for (const key of ["both", "ltifr", "trifr", "none", "thin"]) {
        expect(rank[key], `${locale}: peers.rank.${key}`).toBeTruthy();
      }
      // Both ranks appear in the one sentence AC-20 fixes, each with its own `of`.
      for (const placeholder of ["{ltifrRank}", "{ltifrOf}", "{trifrRank}", "{trifrOf}"]) {
        expect(rank.both, `${locale}: peers.rank.both misses ${placeholder}`).toContain(
          placeholder,
        );
      }
      // Every column of the one table, plus the two headcount shapes and the client's own row.
      const table = peers.table as Record<string, string>;
      for (const key of [
        "caption",
        "company",
        "country",
        "year",
        "ltifr",
        "trifr",
        "loss",
        "source",
        "you",
        "yourCompany",
        "headcount",
        "noHeadcount",
        "sourceLink",
        "none",
      ]) {
        expect(table[key], `${locale}: peers.table.${key}`).toBeTruthy();
      }
      // The three rungs of the ladder in code (`PEER_RUNGS`), no Europe rung any more.
      const rung = peers.rung as Record<string, string>;
      for (const key of ["country", "region", "world"]) {
        expect(rung[key], `${locale}: peers.rung.${key}`).toBeTruthy();
      }
      expect("europe" in rung, `${locale}: peers.rung.europe is gone`).toBe(false);
      const region = peers.region as Record<string, string>;
      for (const key of [
        "dach",
        "nordics",
        "benelux",
        "british_isles",
        "southern",
        "central_eastern",
        "north_america",
        "latin_america",
        "middle_east_africa",
        "asia_pacific",
      ]) {
        expect(region[key], `${locale}: peers.region.${key}`).toBeTruthy();
      }
    }
  });

  it("has every key the loss card renders, and names no price it must not (AC-21)", () => {
    for (const [locale, messages] of catalogs) {
      const loss = messages.benchmark.loss as Record<string, unknown>;
      for (const key of ["heading", "headline", "description", "savingAtMedian", "savingAtBest"]) {
        expect(loss[key], `${locale}: loss.${key}`).toBeTruthy();
      }
      const counts = loss.counts as Record<string, string>;
      for (const key of ["ltis", "recordables", "fatalities", "calculated"]) {
        expect(counts[key], `${locale}: loss.counts.${key}`).toBeTruthy();
      }
      expect(
        (loss.empty as Record<string, string>).title,
        `${locale}: loss.empty.title`,
      ).toBeTruthy();
      // The hourly cost, the hours per incident and the fatality price are inputs to one figure,
      // never quoted back at the client (AC-14, AC-21).
      for (const [key, text] of flatten(loss, "loss")) {
        expect(text, `${locale}: benchmark.${key} names a constant of the loss table`).not.toMatch(
          /769|201|1 ?200 ?000|1'200'000/,
        );
      }
    }
  });

  it("has every key the expert and package cards render (AC-22, AC-23)", () => {
    for (const [locale, messages] of catalogs) {
      const experts = messages.benchmark.experts as Record<string, string>;
      for (const key of ["heading", "description", "empty", "availability", "unnamed"]) {
        expect(experts[key], `${locale}: experts.${key}`).toBeTruthy();
      }
      const pack = messages.benchmark.package as Record<string, unknown>;
      for (const key of ["heading", "buy", "enquire", "others"]) {
        expect(pack[key], `${locale}: package.${key}`).toBeTruthy();
      }
      // One sentence per reason the model can return (AC-15).
      const reason = pack.reason as Record<string, string>;
      for (const key of [
        "fatality",
        "large_saving",
        "no_figures",
        "both_worse",
        "one_worse",
        "both_better",
      ]) {
        expect(reason[key], `${locale}: package.reason.${key}`).toBeTruthy();
      }
    }
  });
});
