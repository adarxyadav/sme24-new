// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ALL_COUNTRIES,
  CREDIT_BILLING_COUNTRY,
  creditCheckoutSchema,
  decodeSearchCursor,
  directorySearchSchema,
  encodeSearchCursor,
  REMOVAL_REASONS,
  removeContactSchema,
  revealContactSchema,
  searchQuery,
} from "@/features/directory/schema";

/**
 * The directory's boundary schemas (spec 0018, AC-4, AC-5, AC-9, AC-12, AC-15). The search params
 * that reach the page, the opaque cursor a caller could tamper with, and the three action inputs.
 * Everything here is pure, so nothing is mocked.
 */

const ID = "c0000000-0000-4000-8000-000000000001";

describe("the search params (AC-4)", () => {
  it("keeps a search text of two characters or more, trimmed", () => {
    const parsed = directorySearchSchema.parse({ q: "  Alpha Werke  ", title: "Head of Safety" });
    expect(parsed.q).toBe("Alpha Werke");
    expect(parsed.title).toBe("Head of Safety");
  });

  it("refuses one character, so the function's own 2 to 100 rule is never reached with it", () => {
    const result = directorySearchSchema.safeParse({ q: "A" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("tooShort");
  });

  it("refuses a search text past 100 characters", () => {
    const result = directorySearchSchema.safeParse({ q: "a".repeat(101) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("tooLong");
  });

  it("reads an absent, empty or whitespace only text as no filter, never as a one character one", () => {
    expect(directorySearchSchema.parse({}).q).toBeUndefined();
    expect(directorySearchSchema.parse({ q: "" }).q).toBeUndefined();
    expect(directorySearchSchema.parse({ q: "   " }).q).toBeUndefined();
  });

  it("keeps an alpha 2 country code and drops anything else", () => {
    expect(directorySearchSchema.parse({ country: "CH" }).country).toBe("CH");
    // The "all countries" option and a stray value both mean no filter, never a failed parse.
    expect(directorySearchSchema.parse({ country: ALL_COUNTRIES }).country).toBeUndefined();
    expect(directorySearchSchema.parse({ country: "Schweiz" }).country).toBeUndefined();
    expect(directorySearchSchema.parse({ country: "ch" }).country).toBeUndefined();
  });

  it("refuses an `after` value longer than the cursor could ever be", () => {
    expect(directorySearchSchema.safeParse({ after: "x".repeat(601) }).success).toBe(false);
  });
});

describe("the keyset cursor (AC-4, AC-5)", () => {
  it("round trips a cursor through base64url", () => {
    const cursor = { name: "alpha werke", id: ID, page: 2 } as const;
    const encoded = encodeSearchCursor(cursor);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(decodeSearchCursor(encoded)).toEqual(cursor);
  });

  it("survives a company name holding non ASCII characters", () => {
    const cursor = { name: "zürcher kälte gmbh", id: ID, page: 7 } as const;
    expect(decodeSearchCursor(encodeSearchCursor(cursor))).toEqual(cursor);
  });

  it("reads an absent or empty value as no cursor, which is page 1", () => {
    expect(decodeSearchCursor(undefined)).toBeNull();
    expect(decodeSearchCursor("")).toBeNull();
  });

  it("answers null for a tampered value rather than throwing, so the page can 404", () => {
    expect(decodeSearchCursor("not-a-cursor")).toBeNull();
    // Valid base64url, but not JSON.
    expect(decodeSearchCursor(Buffer.from("hello", "utf8").toString("base64url"))).toBeNull();
    // JSON, but not an object.
    expect(decodeSearchCursor(Buffer.from("42", "utf8").toString("base64url"))).toBeNull();
  });

  it("refuses a cursor whose id is not a uuid, so a crafted value cannot reach the function", () => {
    const crafted = Buffer.from(
      JSON.stringify({ n: "alpha", i: "'; drop table directory_contacts; --", p: 2 }),
      "utf8",
    ).toString("base64url");
    expect(decodeSearchCursor(crafted)).toBeNull();
  });

  it("refuses a page ordinal below 2, above the schema cap, or not a whole number", () => {
    const at = (p: unknown) =>
      decodeSearchCursor(
        Buffer.from(JSON.stringify({ n: "alpha", i: ID, p }), "utf8").toString("base64url"),
      );
    // Page 1 has no cursor by definition.
    expect(at(1)).toBeNull();
    expect(at(0)).toBeNull();
    expect(at(-3)).toBeNull();
    expect(at(2.5)).toBeNull();
    expect(at(10_001)).toBeNull();
    // A page past the function's cap still decodes; the function answers SM429 and the page
    // renders the depth message, rather than a 404 that would read as a broken link.
    expect(at(41)).toEqual({ name: "alpha", id: ID, page: 41 });
  });

  it("refuses an empty or over long company name", () => {
    const at = (n: unknown) =>
      decodeSearchCursor(
        Buffer.from(JSON.stringify({ n, i: ID, p: 2 }), "utf8").toString("base64url"),
      );
    expect(at("")).toBeNull();
    expect(at("a".repeat(301))).toBeNull();
    expect(at(null)).toBeNull();
  });
});

describe("the search link query (AC-5)", () => {
  it("carries only the filters that are set", () => {
    expect(searchQuery({ q: "alpha", title: undefined, country: "CH" })).toEqual({
      q: "alpha",
      country: "CH",
    });
    expect(searchQuery({ q: undefined, title: undefined, country: undefined })).toEqual({});
  });

  it("adds the cursor to the same filters, so `Mehr laden` keeps the search", () => {
    expect(searchQuery({ q: "alpha", title: "safety", country: "CH" }, "cursor-value")).toEqual({
      q: "alpha",
      title: "safety",
      country: "CH",
      after: "cursor-value",
    });
  });

  it("drops a null cursor, which is how the reset link goes back to page 1", () => {
    expect(searchQuery({ q: "alpha", title: undefined, country: undefined }, null)).toEqual({
      q: "alpha",
    });
  });
});

describe("the action inputs (AC-9, AC-12, AC-15)", () => {
  it("takes a uuid contact id and a short locale to reveal", () => {
    expect(revealContactSchema.safeParse({ contactId: ID, locale: "de" }).success).toBe(true);
    expect(revealContactSchema.safeParse({ contactId: "nope", locale: "de" }).success).toBe(false);
    expect(revealContactSchema.safeParse({ contactId: ID, locale: "fr" }).success).toBe(false);
  });

  it("lowercases and trims a removal address, and names the three reasons", () => {
    const parsed = removeContactSchema.parse({
      email: "  Gone@Alpha.TEST ",
      reason: "data_subject_request",
    });
    expect(parsed.email).toBe("gone@alpha.test");
    expect(REMOVAL_REASONS).toEqual(["data_subject_request", "bounce", "ops"]);
    expect(
      removeContactSchema.safeParse({ email: "gone@alpha.test", reason: "spam" }).success,
    ).toBe(false);
  });

  it("refuses a removal address that is not an address or is too long", () => {
    expect(removeContactSchema.safeParse({ email: "not-an-address", reason: "ops" }).success).toBe(
      false,
    );
    const long = `${"a".repeat(310)}@alpha.test`;
    expect(removeContactSchema.safeParse({ email: long, reason: "ops" }).success).toBe(false);
  });

  it("takes only a credit pack key, never an assessment package key", () => {
    const address = {
      billingName: "Erika Expert",
      billingStreet: "Bahnhofstrasse 1",
      billingPostcode: "6340",
      billingTown: "Baar",
      billingUid: "",
      paymentMethod: "card",
    };
    expect(creditCheckoutSchema.safeParse({ ...address, packKey: "directory_50" }).success).toBe(
      true,
    );
    expect(creditCheckoutSchema.safeParse({ ...address, packKey: "assessment" }).success).toBe(
      false,
    );
  });

  it("has no billing country field, because the action writes the literal CH", () => {
    expect(CREDIT_BILLING_COUNTRY).toBe("CH");
    expect(Object.keys(creditCheckoutSchema.shape)).not.toContain("billingCountry");
  });
});
