import { describe, expect, it } from "vitest";
import {
  ALL_STATUSES,
  ENQUIRY_STATUSES,
  enquiryFiltersSchema,
  enquiryListQuery,
  leavesNew,
  PAGE_SIZE,
  updateEnquirySchema,
} from "@/features/enquiries/schema";

/**
 * The ops side schemas (spec 0009, AC-12): the list filter defaults to `new` and swallows a bad
 * value, the update parses the status and the note, and the `handled_at` rule says which
 * target statuses may set the handler columns.
 */
describe("enquiryFiltersSchema (AC-12)", () => {
  it("defaults to the new status and accepts every status plus all", () => {
    expect(enquiryFiltersSchema.parse({})).toEqual({ status: "new", cursor: undefined });
    for (const status of [...ENQUIRY_STATUSES, ALL_STATUSES]) {
      expect(enquiryFiltersSchema.parse({ status }).status).toBe(status);
    }
  });

  it("falls back to new on an unknown status and drops an oversized cursor", () => {
    expect(enquiryFiltersSchema.parse({ status: "bogus" }).status).toBe("new");
    expect(enquiryFiltersSchema.parse({ cursor: "x".repeat(201) }).cursor).toBeUndefined();
    expect(enquiryFiltersSchema.parse({ cursor: "abc" }).cursor).toBe("abc");
  });

  it("builds the list query without the defaults", () => {
    expect(enquiryListQuery({ status: "new" })).toBe("");
    expect(enquiryListQuery({ status: "closed" })).toBe("?status=closed");
    expect(enquiryListQuery({ status: "all" }, "c1")).toBe("?status=all&cursor=c1");
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("updateEnquirySchema and the handled_at rule (AC-12)", () => {
  const id = "e1000000-0000-4000-8000-000000000001";

  it("parses the status and trims the note, an empty note becoming null", () => {
    expect(updateEnquirySchema.parse({ id, status: "contacted", opsNote: "  Called.  " })).toEqual({
      id,
      status: "contacted",
      opsNote: "Called.",
      locale: undefined,
    });
    expect(updateEnquirySchema.parse({ id, status: "closed", opsNote: "" }).opsNote).toBeNull();
    expect(updateEnquirySchema.parse({ id, status: "new" }).opsNote).toBeNull();
  });

  it("refuses an unknown status, a bad id and a note over 2000 characters", () => {
    expect(updateEnquirySchema.safeParse({ id, status: "archived" }).success).toBe(false);
    expect(updateEnquirySchema.safeParse({ id: "1", status: "new" }).success).toBe(false);
    const long = updateEnquirySchema.safeParse({ id, status: "new", opsNote: "x".repeat(2001) });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toBe("noteLong");
  });

  it("sets the handler columns only when the status leaves new", () => {
    expect(leavesNew("new")).toBe(false);
    expect(leavesNew("contacted")).toBe(true);
    expect(leavesNew("closed")).toBe(true);
  });
});
