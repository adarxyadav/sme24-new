import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { LOCALES } from "@/i18n/routing";
import { createFormatterFor } from "@/i18n/standalone";

/** 4 September 2026, 13:05 UTC: 15:05 in Zurich (summer time). */
const AT = new Date("2026-09-04T13:05:00Z");

/**
 * The grouping apostrophe ICU emits for Swiss locales depends on its CLDR data: U+2019 up to
 * CLDR 47 (Node 25.1 locally) and the straight U+0027 from CLDR 48 (Node 22.23 in CI). Both are
 * correct Swiss formatting, so the expected strings use whichever the running ICU emits, and the
 * last test pins the separator to one of the two apostrophes, never a dot, comma or space.
 */
const GROUP =
  new Intl.NumberFormat("de-CH").formatToParts(1000).find((part) => part.type === "group")?.value ??
  "";
const APOSTROPHES = ["’", "'"] as const;

/**
 * The exact strings spec 0004 AC-3 fixes. ICU separates the currency code from the amount with a
 * no break space (U+00A0) so `CHF 4’900.00` never wraps between the code and the number.
 */
const NBSP = " ";
const EXPECTED = {
  "de-CH": {
    chf: `CHF${NBSP}4${GROUP}900.00`,
    chfWhole: `CHF${NBSP}48${GROUP}313`,
    percent: "12.3%",
    dateShort: "04.09.2026",
    dateLong: "4. September 2026",
    dateTime: "04.09.2026, 15:05",
  },
  "en-CH": {
    chf: `CHF${NBSP}4${GROUP}900.00`,
    chfWhole: `CHF${NBSP}48${GROUP}313`,
    percent: "12.3%",
    dateShort: "04.09.2026",
    dateLong: "4 September 2026",
    dateTime: "04.09.2026, 15:05",
  },
} as const;

/** The formatter a request gets: the same options the request config passes to next-intl. */
function requestFormatter(locale: (typeof LOCALES)[number]) {
  return createFormatter({ locale, formats, timeZone: TIME_ZONE });
}

describe("named formats (spec 0004, AC-3, AC-7)", () => {
  for (const locale of LOCALES) {
    const expected = EXPECTED[locale];
    for (const [name, make] of [
      ["request formatter", requestFormatter],
      ["standalone formatter", createFormatterFor],
    ] as const) {
      it(`${locale} through the ${name} gives the Swiss strings`, () => {
        const format = make(locale);
        expect(format.number(4900, "chf")).toBe(expected.chf);
        expect(format.number(48312.5, "chfWhole")).toBe(expected.chfWhole);
        expect(format.number(0.1234, "percent")).toBe(expected.percent);
        expect(format.dateTime(AT, "dateShort")).toBe(expected.dateShort);
        expect(format.dateTime(AT, "dateLong")).toBe(expected.dateLong);
        expect(format.dateTime(AT, "dateTime")).toBe(expected.dateTime);
      });
    }
  }

  it("renders every date in Europe/Zurich, not in the process timezone", () => {
    // 23:30 UTC on 4 September is already 5 September in Zurich.
    const lateEvening = new Date("2026-09-04T23:30:00Z");
    expect(createFormatterFor("de-CH").dateTime(lateEvening, "dateShort")).toBe("05.09.2026");
    expect(TIME_ZONE).toBe("Europe/Zurich");
  });

  it("groups thousands with an apostrophe (U+2019 or U+0027 by ICU version), never a dot or space", () => {
    expect(APOSTROPHES).toContain(GROUP);
    for (const locale of LOCALES) {
      expect(createFormatterFor(locale).number(1234567, "integer")).toBe(`1${GROUP}234${GROUP}567`);
    }
  });
});
