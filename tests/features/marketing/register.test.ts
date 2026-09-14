import { describe, expect, it } from "vitest";
import {
  atLevel,
  filterRegister,
  LEVELS,
  locationCounts,
  NO_FILTERS,
  REGISTER,
  type RegisterEntry,
  ratedCount,
} from "@/features/marketing/register";

/**
 * The public expert directory (spec 0009 follow-up): the published file carries no contact detail
 * and no surname, every row is well formed, and the pure filters behave on hand written rows.
 */

const ROWS: readonly RegisterEntry[] = [
  ["Anna", "Switzerland", "", ""],
  ["Beat", "Switzerland", "", ""],
  ["Carla", "India", "sme", "practitioner"],
  ["Dilip", "LATAM", "practitioner", "sme"],
  ["Eva", "", "", ""],
];

describe("the published directory", () => {
  it("carries every entry as a four column row of strings", () => {
    expect(REGISTER.length).toBeGreaterThan(1_000);
    for (const entry of REGISTER) {
      expect(entry).toHaveLength(4);
      for (const value of entry) expect(typeof value).toBe("string");
    }
  });

  it("uses only known competency levels", () => {
    for (const entry of REGISTER) {
      for (const level of [entry[2], entry[3]]) {
        if (level !== "") expect(LEVELS).toContain(level);
      }
    }
  });

  it("publishes no address, phone number, email address or website", () => {
    const flat = JSON.stringify(REGISTER);
    expect(flat).not.toMatch(/@/);
    expect(flat).not.toMatch(/https?:\/\//);
    expect(flat).not.toMatch(/\+41|www\./);
    // A phone number or a postcode would show as four or more digits in a row. Nothing published
    // carries a number at all now, so any run of four digits is something that should not be here.
    expect(flat).not.toMatch(/\d{4}/);
  });

  it("publishes a given name only, never a surname", () => {
    // The two sources order their names differently and the build takes the given name from each
    // (`givenNameOf` in scripts/build-register.mts). A row carrying whitespace in its name column
    // means a full name survived the build, which is the disclosure the truncation exists to stop.
    for (const entry of REGISTER) {
      expect(entry[0]).not.toMatch(/\s/);
      expect(entry[0]).not.toBe("");
    }
  });

  it("sorts by name so the file has a stable order", () => {
    const names = REGISTER.map((entry) => entry[0]);
    expect(names).toEqual([...names].toSorted((left, right) => left.localeCompare(right, "de")));
  });

  it("carries both sources: unrated Swiss entries and rated global ones", () => {
    expect(ratedCount()).toBeGreaterThan(0);
    expect(ratedCount()).toBeLessThan(REGISTER.length);
    expect(locationCounts().length).toBeGreaterThan(10);
  });
});

describe("locationCounts", () => {
  it("counts per location, most first, and drops the entries without one", () => {
    expect(locationCounts(ROWS)).toEqual([
      { location: "Switzerland", count: 2 },
      { location: "India", count: 1 },
      { location: "LATAM", count: 1 },
    ]);
  });
});

describe("ratedCount and atLevel", () => {
  it("counts the entries carrying a level in either competency", () => {
    expect(ratedCount(ROWS)).toBe(2);
  });

  it("counts a level held in either competency, without double counting a row", () => {
    expect(atLevel("sme", ROWS)).toBe(2);
    expect(atLevel("practitioner", ROWS)).toBe(2);
  });
});

describe("filterRegister", () => {
  it("returns every entry without filters", () => {
    expect(filterRegister(ROWS, NO_FILTERS)).toEqual(ROWS);
  });

  it("matches the name and the location, ignoring case", () => {
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "anna" })).toHaveLength(1);
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "switzerland" })).toHaveLength(2);
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "LATAM" })).toHaveLength(1);
  });

  it("filters by location and by level, and combines both with the query", () => {
    expect(filterRegister(ROWS, { ...NO_FILTERS, location: "Switzerland" })).toHaveLength(2);
    expect(filterRegister(ROWS, { ...NO_FILTERS, level: "sme" })).toHaveLength(2);
    expect(filterRegister(ROWS, { query: "carla", location: "India", level: "sme" })).toHaveLength(
      1,
    );
    expect(filterRegister(ROWS, { query: "carla", location: "LATAM", level: "" })).toHaveLength(0);
  });

  it("matches a level held in either competency", () => {
    // Carla is an SME in PSM and a practitioner in MOC, Dilip the other way round, so either
    // filter selects both: the question the control answers is "who is senior in something".
    expect(filterRegister(ROWS, { ...NO_FILTERS, level: "sme" }).map((entry) => entry[0])).toEqual([
      "Carla",
      "Dilip",
    ]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "  beat  " })).toHaveLength(1);
  });
});
