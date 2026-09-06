import { describe, expect, it } from "vitest";
import {
  currentYear,
  defaultYear,
  newerYearsThan,
  yearOptions,
} from "@/features/self-assessment/years";

/**
 * The year rules (spec 0010, AC-2, AC-7): the picker lists one contiguous run from the current
 * year down to the smaller of four years back and the oldest year on file, never below 2000;
 * the default is the newest year on file, else last year; the current year follows the Zurich
 * clock across New Year; `newerYearsThan` names the KPIs whose newest year is later than the
 * chosen one. Pure.
 */
describe("yearOptions (AC-2)", () => {
  it.each([
    {
      name: "no rows",
      yearsOnFile: [],
      currentYear: 2026,
      expected: [2026, 2025, 2024, 2023, 2022],
    },
    {
      name: "rows inside the four year window",
      yearsOnFile: [2023, 2024],
      currentYear: 2026,
      expected: [2026, 2025, 2024, 2023, 2022],
    },
    {
      name: "a row older than four years extends the list down to it",
      yearsOnFile: [2019, 2024],
      currentYear: 2026,
      expected: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019],
    },
    {
      name: "a row in the current year does not add a year above it",
      yearsOnFile: [2026],
      currentYear: 2026,
      expected: [2026, 2025, 2024, 2023, 2022],
    },
    {
      name: "never below 2000",
      yearsOnFile: [],
      currentYear: 2002,
      expected: [2002, 2001, 2000],
    },
  ])("$name", ({ yearsOnFile, currentYear, expected }) => {
    expect(yearOptions({ yearsOnFile, currentYear })).toEqual(expected);
  });
});

describe("defaultYear (AC-2)", () => {
  it("is the newest year on file, capped at the current year, else last year", () => {
    expect(defaultYear({ yearsOnFile: [2023, 2024], currentYear: 2026 })).toBe(2024);
    expect(defaultYear({ yearsOnFile: [2026], currentYear: 2026 })).toBe(2026);
    expect(defaultYear({ yearsOnFile: [2027], currentYear: 2026 })).toBe(2026);
    expect(defaultYear({ yearsOnFile: [], currentYear: 2026 })).toBe(2025);
  });
});

describe("currentYear (AC-2)", () => {
  it("reads the Europe/Zurich year, so the last UTC hour of the year is already the new year", () => {
    expect(currentYear(new Date("2026-09-06T10:00:00.000Z"))).toBe(2026);
    expect(currentYear(new Date("2026-12-31T23:30:00.000Z"))).toBe(2027);
    expect(currentYear(new Date("2026-01-01T00:30:00.000Z"))).toBe(2026);
  });
});

describe("newerYearsThan (AC-7)", () => {
  const rows = [
    { kpiKey: "ltifr", periodYear: 2024 },
    { kpiKey: "ltifr", periodYear: 2023 },
    { kpiKey: "trifr", periodYear: 2025 },
    { kpiKey: "fatalities", periodYear: 2022 },
    { kpiKey: "unknown", periodYear: 2025 },
  ];
  it("names each KPI whose newest year is later than the chosen one, with that year", () => {
    expect(newerYearsThan(rows, 2023)).toEqual([
      { key: "ltifr", year: 2024 },
      { key: "trifr", year: 2025 },
    ]);
    expect(newerYearsThan(rows, 2025)).toEqual([]);
    expect(newerYearsThan([], 2020)).toEqual([]);
  });
});
