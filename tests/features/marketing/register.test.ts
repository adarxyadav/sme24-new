import { describe, expect, it } from "vitest";
import {
  CAPACITIES,
  cantonCounts,
  capacityCounts,
  completedIn,
  filterRegister,
  NO_FILTERS,
  REGISTER,
  type RegisterEntry,
  STATUSES,
} from "@/features/marketing/register";

/**
 * The public expert register (spec 0009 follow-up): the published file carries no contact detail,
 * every row is well formed, and the pure filters behave on hand written rows.
 */

const ROWS: readonly RegisterEntry[] = [
  ["Muster Anna", "Zürich", "ZH", "Schweiz", "v", "A", "A", "A"],
  ["Muster Beat", "Bern", "BE", "Schweiz", "t", "T", "A", "N"],
  ["Rossi Carla", "Lugano", "TI", "Schweiz", "n", "E", "T", "U"],
  ["Ohne Ort", "", "", "Schweiz", "u", "U", "E", "E"],
];

describe("the published register", () => {
  it("carries every entry as an eight column row of strings", () => {
    expect(REGISTER.length).toBeGreaterThan(1_000);
    for (const entry of REGISTER) {
      expect(entry).toHaveLength(8);
      for (const value of entry) expect(typeof value).toBe("string");
    }
  });

  it("uses only known capacity and status letters", () => {
    for (const entry of REGISTER) {
      expect(CAPACITIES).toContain(entry[4]);
      for (const year of [5, 6, 7] as const) expect(STATUSES).toContain(entry[year]);
    }
  });

  it("publishes no address, phone number, email address or website", () => {
    const flat = JSON.stringify(REGISTER);
    expect(flat).not.toMatch(/@/);
    expect(flat).not.toMatch(/https?:\/\//);
    expect(flat).not.toMatch(/\+41|www\./);
    // A phone number or a postcode would show as four or more digits in a row; the place column
    // keeps only a town, so the longest run left is a postal box suffix of one to three digits.
    expect(flat).not.toMatch(/\d{4}/);
  });

  it("sorts by name so the file has a stable order", () => {
    const names = REGISTER.map((entry) => entry[0]);
    expect(names).toEqual([...names].toSorted((left, right) => left.localeCompare(right, "de")));
  });
});

describe("cantonCounts", () => {
  it("counts per canton, most first, and drops the entries without one", () => {
    expect(cantonCounts(ROWS)).toEqual([
      { canton: "BE", count: 1 },
      { canton: "TI", count: 1 },
      { canton: "ZH", count: 1 },
    ]);
  });

  it("finds a canton for most of the real register", () => {
    const counted = cantonCounts().reduce((sum, entry) => sum + entry.count, 0);
    expect(counted).toBeGreaterThan(REGISTER.length / 2);
  });
});

describe("capacityCounts and completedIn", () => {
  it("counts every capacity, including the entries that state none", () => {
    expect(capacityCounts(ROWS)).toEqual({ v: 1, t: 1, n: 1, u: 1 });
  });

  it("counts only a completed year", () => {
    expect(completedIn(6, ROWS)).toBe(2);
    expect(completedIn(7, ROWS)).toBe(1);
  });
});

describe("filterRegister", () => {
  it("returns every entry without filters", () => {
    expect(filterRegister(ROWS, NO_FILTERS)).toEqual(ROWS);
  });

  it("matches the name and the town, ignoring case", () => {
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "muster" })).toHaveLength(2);
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "lugano" })).toHaveLength(1);
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "zürich" })).toHaveLength(1);
  });

  it("filters by canton and by capacity, and combines both with the query", () => {
    expect(filterRegister(ROWS, { ...NO_FILTERS, canton: "ZH" })).toHaveLength(1);
    expect(filterRegister(ROWS, { ...NO_FILTERS, capacity: "v" })).toHaveLength(1);
    expect(filterRegister(ROWS, { query: "muster", canton: "BE", capacity: "t" })).toHaveLength(1);
    expect(filterRegister(ROWS, { query: "muster", canton: "TI", capacity: "" })).toHaveLength(0);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterRegister(ROWS, { ...NO_FILTERS, query: "  bern  " })).toHaveLength(1);
  });
});
