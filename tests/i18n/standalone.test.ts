import { describe, expect, it } from "vitest";
import { createFormatterFor, createTranslatorFor, loadMessages } from "@/i18n/standalone";
import de from "../../messages/de-CH.json";
import en from "../../messages/en-CH.json";

/** 4 September 2026, 13:05 UTC: 15:05 in Zurich (summer time), the AC-3 fixture. */
const AT = new Date("2026-09-04T13:05:00Z");

/**
 * The standalone translator (spec 0004, AC-7): the same catalogs, formats, timezone and error
 * handling as the app, without a request. This is what a task or an email template calls.
 */
describe("standalone translator (spec 0004, AC-7)", () => {
  it("loads the one catalog per locale, the same files the request config reads", async () => {
    await expect(loadMessages("de-CH")).resolves.toEqual(de);
    await expect(loadMessages("en-CH")).resolves.toEqual(en);
  });

  it("translates a plain key in each language", async () => {
    const tDe = await createTranslatorFor("de-CH");
    const tEn = await createTranslatorFor("en-CH");
    expect(tDe("scaffold.heading")).toBe(de.scaffold.heading);
    expect(tEn("scaffold.heading")).toBe(en.scaffold.heading);
  });

  it("formats a date argument inside a message with the named dateTime format in Europe/Zurich", async () => {
    const tDe = await createTranslatorFor("de-CH");
    const tEn = await createTranslatorFor("en-CH");
    expect(tDe("scaffold.summary", { at: AT })).toBe("Eingefügt am 04.09.2026, 15:05");
    expect(tEn("scaffold.summary", { at: AT })).toBe("Inserted on 04.09.2026, 15:05");
  });

  it("shares the request error handling: a missing key throws in test instead of rendering silently", async () => {
    const t = await createTranslatorFor("de-CH");
    // The catalog is typed, so an unknown key needs a cast to reach the runtime path.
    expect(() => t("scaffold.doesNotExist" as never)).toThrow(/MISSING_MESSAGE/);
  });

  it("gives a formatter whose named formats match the translator's", async () => {
    const t = await createTranslatorFor("de-CH");
    const format = createFormatterFor("de-CH");
    expect(t("scaffold.summary", { at: AT })).toContain(format.dateTime(AT, "dateTime"));
  });
});
