import { describe, expect, it } from "vitest";
import {
  deliveryFiltersSchema,
  deliveryListQuery,
  PAGE_SIZE,
  retryDeliverySchema,
} from "@/features/emails/schema";

/**
 * The `/admin/emails` query parameters (spec 0006, AC-9): an invalid value falls back to no
 * filter instead of a 400, the search is trimmed and capped, and the list query string drops
 * empty values so a reset never carries `status=`.
 */
describe("deliveryFiltersSchema (AC-9)", () => {
  it("accepts a known status, a known template, a search and a cursor", () => {
    expect(
      deliveryFiltersSchema.parse({
        status: "failed",
        template: "welcome",
        q: "  clara@example.test ",
        cursor: "abc",
      }),
    ).toEqual({ status: "failed", template: "welcome", q: "clara@example.test", cursor: "abc" });
  });

  it("drops an unknown status or template instead of failing the page", () => {
    expect(deliveryFiltersSchema.parse({ status: "lost", template: "invoice" })).toEqual({
      status: undefined,
      template: undefined,
      q: undefined,
      cursor: undefined,
    });
  });

  it("drops a search over 320 characters and a cursor over 200", () => {
    const parsed = deliveryFiltersSchema.parse({ q: "a".repeat(321), cursor: "c".repeat(201) });
    expect(parsed.q).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
  });

  it("parses an empty query to no filters at all", () => {
    const parsed = deliveryFiltersSchema.parse({});
    expect(parsed.status).toBeUndefined();
    expect(parsed.q).toBeUndefined();
  });
});

describe("deliveryListQuery (AC-9)", () => {
  it("is empty without filters or a cursor", () => {
    expect(deliveryListQuery({})).toBe("");
    expect(deliveryListQuery({ q: "" }, null)).toBe("");
  });

  it("carries every set filter plus the cursor, url encoded", () => {
    expect(
      deliveryListQuery({ status: "failed", template: "welcome", q: "a@b.ch" }, "next-1"),
    ).toBe("?status=failed&template=welcome&q=a%40b.ch&cursor=next-1");
  });

  it("drops the cursor for the first page link and keeps the filters", () => {
    expect(deliveryListQuery({ status: "sent" }, null)).toBe("?status=sent");
  });
});

describe("retryDeliverySchema and PAGE_SIZE", () => {
  it("accepts only a uuid delivery id", () => {
    expect(
      retryDeliverySchema.safeParse({ deliveryId: "d0000000-0000-4000-8000-000000000001" }).success,
    ).toBe(true);
    expect(retryDeliverySchema.safeParse({ deliveryId: "1" }).success).toBe(false);
    expect(retryDeliverySchema.safeParse({}).success).toBe(false);
  });

  it("pages 50 rows as the spec says", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});
