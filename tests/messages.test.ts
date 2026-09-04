import { describe, expect, it } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";

/** Flattens nested message objects to dotted keys, so the two locales can be compared. */
function deepKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, nested]) =>
    deepKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs (spec 0003, AC-12)", () => {
  it("de.json is the authoritative key set and en.json matches it exactly", () => {
    const deKeys = deepKeys(de).sort();
    const enKeys = deepKeys(en).sort();
    expect(enKeys.filter((key) => !deKeys.includes(key))).toEqual([]);
    expect(deKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it("carries the namespaces the shell, theme, states and gallery read", () => {
    for (const namespace of ["ui", "shell", "nav", "theme", "states", "gallery"] as const) {
      expect(de).toHaveProperty(namespace);
      expect(en).toHaveProperty(namespace);
    }
  });

  it("keeps ICU placeholders identical between the locales", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const flat = (value: unknown, prefix = ""): Array<[string, string]> => {
      if (typeof value === "string") return [[prefix, value]];
      if (!value || typeof value !== "object") return [];
      return Object.entries(value).flatMap(([key, nested]) =>
        flat(nested, prefix ? `${prefix}.${key}` : key),
      );
    };
    const enByKey = new Map(flat(en));
    for (const [key, text] of flat(de)) {
      expect(placeholders(enByKey.get(key) ?? ""), key).toEqual(placeholders(text));
    }
  });
});
