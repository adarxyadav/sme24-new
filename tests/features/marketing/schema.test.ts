import { describe, expect, it } from "vitest";
import {
  EMAIL_DAILY_LIMIT,
  ENQUIRY_TOPIC_LABELS,
  enquirySchema,
  enquirySubmissionSchema,
  IP_HOURLY_LIMIT,
  MESSAGE_MAX,
  MESSAGE_MIN,
  MIN_FILL_MS,
} from "@/features/marketing/schema";

/**
 * The enquiry form's schema (spec 0009, AC-8): every rule of the form, the normalisation the row
 * relies on (trimmed, lowercased email; empty optionals become null) and the guard thresholds.
 */
const valid = {
  topic: "general",
  companyName: "Muster AG",
  contactName: "Clara Muster",
  email: "clara@example.ch",
  phone: "",
  headcountBand: "",
  message: "We would like to know how the assessment date is agreed.",
  locale: "en",
};

describe("enquirySchema (AC-8)", () => {
  it("accepts the form values and normalises the optionals to null", () => {
    const parsed = enquirySchema.parse(valid);
    expect(parsed).toEqual({ ...valid, phone: null, headcountBand: null });
  });

  it("trims and lowercases the email and trims the names", () => {
    const parsed = enquirySchema.parse({
      ...valid,
      email: "  Clara@Example.CH ",
      companyName: "  Muster AG ",
      contactName: " Clara ",
    });
    expect(parsed.email).toBe("clara@example.ch");
    expect(parsed.companyName).toBe("Muster AG");
    expect(parsed.contactName).toBe("Clara");
  });

  it("keeps a phone and a headcount band when given", () => {
    const parsed = enquirySchema.parse({
      ...valid,
      phone: "+41 44 000 00 00",
      headcountBand: "50-249",
    });
    expect(parsed.phone).toBe("+41 44 000 00 00");
    expect(parsed.headcountBand).toBe("50-249");
  });

  it("names the custom rule for each field it refuses", () => {
    const messages = (input: Record<string, unknown>) =>
      Object.fromEntries(
        (enquirySchema.safeParse({ ...valid, ...input }).error?.issues ?? []).map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
    expect(messages({ companyName: " " })).toEqual({ companyName: "companyRequired" });
    expect(messages({ companyName: "x".repeat(201) })).toEqual({ companyName: "companyLong" });
    expect(messages({ contactName: "" })).toEqual({ contactName: "nameRequired" });
    expect(messages({ contactName: "x".repeat(201) })).toEqual({ contactName: "nameLong" });
    expect(messages({ phone: "1".repeat(41) })).toEqual({ phone: "phoneLong" });
    expect(messages({ message: "Too short." })).toEqual({ message: "messageShort" });
    expect(messages({ message: "m".repeat(MESSAGE_MAX + 1) })).toEqual({ message: "messageLong" });
    expect(Object.keys(messages({ email: "not-an-address" }))).toEqual(["email"]);
    expect(Object.keys(messages({ topic: "sales" }))).toEqual(["topic"]);
    expect(Object.keys(messages({ headcountBand: "10-20" }))).toEqual(["headcountBand"]);
    expect(Object.keys(messages({ locale: "fr" }))).toEqual(["locale"]);
  });

  it("accepts a message of exactly the minimum and the maximum length", () => {
    expect(enquirySchema.safeParse({ ...valid, message: "m".repeat(MESSAGE_MIN) }).success).toBe(
      true,
    );
    expect(enquirySchema.safeParse({ ...valid, message: "m".repeat(MESSAGE_MAX) }).success).toBe(
      true,
    );
  });
});

describe("enquirySubmissionSchema and the guard constants (AC-10)", () => {
  it("carries the honeypot and the mount time next to the form values", () => {
    const parsed = enquirySubmissionSchema.parse({
      ...valid,
      website: "",
      startedAt: "1700000000000",
    });
    expect(parsed.website).toBe("");
    expect(parsed.startedAt).toBe("1700000000000");
  });

  it("fixes the thresholds the action applies", () => {
    expect(MIN_FILL_MS).toBe(3_000);
    expect(IP_HOURLY_LIMIT).toBe(5);
    expect(EMAIL_DAILY_LIMIT).toBe(3);
  });

  it("labels both topics in English for the ops channel", () => {
    expect(ENQUIRY_TOPIC_LABELS).toEqual({ retainer: "Retainer", general: "General question" });
  });
});
