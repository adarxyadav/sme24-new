import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  issueMessage,
  parseWith,
  type ValidationTranslator,
  zodLocaleError,
} from "@/lib/validation";

const schema = z.object({
  email: z.email(),
  password: z.string().min(6),
  company: z.string().min(2, "companyShort"),
});

function messages(result: ReturnType<typeof parseWith>) {
  if (result.success) throw new Error("expected the parse to fail");
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("localized validation (spec 0004, AC-8)", () => {
  it("gives Zod's built in messages in German for de-CH", () => {
    const issues = messages(
      parseWith(schema, { email: "nope", password: "abc", company: "x" }, "de-CH"),
    );
    expect(issues.email).toMatch(/E-Mail/);
    expect(issues.password).toMatch(/6/);
    expect(issues.password).not.toMatch(/Too small/);
    expect(issues.company).toBe("companyShort");
  });

  it("gives Zod's built in messages in English for en-CH", () => {
    const issues = messages(
      parseWith(schema, { email: "nope", password: "abc", company: "x" }, "en-CH"),
    );
    expect(issues.email).toMatch(/email/i);
    expect(issues.password).toMatch(/6/);
    expect(issues.password).toMatch(/[a-z]/);
    expect(issues.company).toBe("companyShort");
  });

  it("translates a missing field without touching Zod's global config", () => {
    const de = messages(parseWith(schema, {}, "de-CH"));
    const en = messages(parseWith(schema, {}, "en-CH"));
    expect(de.email).not.toBe(en.email);
    // The default (global) parse is unchanged: English.
    const plain = schema.safeParse({});
    expect(plain.success).toBe(false);
    if (!plain.success) expect(plain.error.issues[0]?.message).toMatch(/Invalid input/);
  });

  it("memoises one error map per short code", () => {
    expect(zodLocaleError("de-CH")).toBe(zodLocaleError("de-CH"));
    expect(zodLocaleError("de-CH")).not.toBe(zodLocaleError("en-CH"));
  });

  it("issueMessage translates a key of the validation namespace and passes other text through", () => {
    const catalog: Record<string, string> = { companyShort: "Mindestens 2 Zeichen." };
    const t = Object.assign((key: string) => catalog[key] ?? key, {
      has: (key: string) => key in catalog,
    }) as unknown as ValidationTranslator;
    expect(issueMessage("companyShort", t)).toBe("Mindestens 2 Zeichen.");
    expect(issueMessage("Ungültige E-Mail-Adresse", t)).toBe("Ungültige E-Mail-Adresse");
    expect(issueMessage(undefined, t)).toBeUndefined();
  });
});
