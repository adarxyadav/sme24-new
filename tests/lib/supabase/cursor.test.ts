// @vitest-environment node
import { describe, expect, it } from "vitest";
import { afterCursorFilter, decodeCursor, encodeCursor, isUuid } from "@/lib/supabase/cursor";

/**
 * The shared keyset cursor (spec 0006, AC-9; spec 0009, AC-12): the emails list and the
 * enquiries list page on the same `created_at|id` cursor, so the helper lives in `src/lib` and
 * both lists get the same round trip, the same rejection of a tampered value and the same
 * PostgREST predicate. The round trip and the malformed cases are also pinned through the
 * emails re-export in `tests/features/emails/queries.test.ts`; this file covers the two helpers
 * only the shared module exports.
 */
const ID = "e0000000-0000-4000-8000-000000000001";
const AT = "2026-09-06T08:30:00.000+00:00";

describe("isUuid", () => {
  it("accepts the shape of a row id in either case", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
  });

  it("rejects anything that is not exactly a UUID", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("1; drop table enquiries")).toBe(false);
    expect(isUuid(`${ID}x`)).toBe(false);
    expect(isUuid(ID.replace("-", ""))).toBe(false);
    expect(isUuid("g0000000-0000-4000-8000-000000000001")).toBe(false);
  });
});

describe("decodeCursor", () => {
  const encode = (createdAt: string, id: string) =>
    Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");

  it("accepts a timestamp as `created_at` is read back, with an offset or with Z", () => {
    expect(decodeCursor(encode(AT, ID))).toEqual({ createdAt: AT, id: ID });
    expect(decodeCursor(encode("2026-09-06T08:30:00Z", ID))).toEqual({
      createdAt: "2026-09-06T08:30:00Z",
      id: ID,
    });
  });

  it("rejects a lenient date string the old `Date.parse` check let through", () => {
    // Both values parse as dates, so `Date.parse` alone accepted them; the first carries a comma,
    // the separator of the PostgREST `or=` filter, straight into the interpolated string.
    for (const createdAt of ["Sep 6, 2026", "2026-09-06"]) {
      expect(Number.isNaN(Date.parse(createdAt))).toBe(false);
      expect(decodeCursor(encode(createdAt, ID))).toBeNull();
    }
  });

  it("rejects a timestamp with a trailing filter clause or a stray parenthesis", () => {
    for (const createdAt of [
      `${AT},id.gt.0`,
      `${AT})`,
      `${AT} (UTC)`,
      "2026-09-06T08:30:00.000+00:00,and(id.lt.x)",
    ]) {
      expect(decodeCursor(encode(createdAt, ID))).toBeNull();
    }
  });

  it("rejects a well shaped but impossible timestamp, and a tampered id", () => {
    expect(decodeCursor(encode("2026-13-45T08:30:00.000+00:00", ID))).toBeNull();
    expect(decodeCursor(encode(AT, "1; drop table enquiries"))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(encode("", ID))).toBeNull();
  });
});

describe("afterCursorFilter", () => {
  it("continues a list ordered by created_at desc, id desc after the cursor row", () => {
    expect(afterCursorFilter({ createdAt: AT, id: ID })).toBe(
      `created_at.lt.${AT},and(created_at.eq.${AT},id.lt.${ID})`,
    );
  });

  it("composes with the encoder so a page link round trips into the same predicate", () => {
    const decoded = decodeCursor(encodeCursor({ createdAt: AT, id: ID }));
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(afterCursorFilter(decoded)).toBe(afterCursorFilter({ createdAt: AT, id: ID }));
  });
});
