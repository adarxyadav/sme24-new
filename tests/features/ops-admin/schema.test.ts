// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatZurichWallClock,
  orderDeliveryStateSchema,
  rescheduleOrderSchema,
  scheduleOrderSchema,
  unscheduleOrderSchema,
  zurichInstant,
} from "@/features/ops-admin/schema";

/**
 * The ops admin boundary schemas (spec 0014). The scheduling form and the action parse with the
 * same schema, so what this asserts about the parse is what both sides do.
 *
 * The zone work is the part worth pinning: ops book Swiss site visits, so a `datetime-local` value
 * is read as a Zurich wall clock time whatever zone the ops browser sits in, and both Swiss
 * offsets plus the two transition edges have to come out right without a hard coded table.
 */
const ORDER_ID = "0e000000-0000-4000-8000-000000000001";
const EXPERT_ID = "0e000000-0000-4000-8000-000000000002";

describe("zurichInstant", () => {
  it("reads a winter wall clock time as UTC+1", () => {
    // 01:00Z is 02:00 in Zurich in January.
    expect(zurichInstant("2027-01-15T09:30")?.toISOString()).toBe("2027-01-15T08:30:00.000Z");
  });

  it("reads a summer wall clock time as UTC+2", () => {
    expect(zurichInstant("2027-07-15T09:30")?.toISOString()).toBe("2027-07-15T07:30:00.000Z");
  });

  it("reads the moments either side of the spring forward on the offset that applies", () => {
    // 2027-03-28: 02:00 becomes 03:00 in Zurich.
    expect(zurichInstant("2027-03-28T01:30")?.toISOString()).toBe("2027-03-28T00:30:00.000Z");
    expect(zurichInstant("2027-03-28T03:30")?.toISOString()).toBe("2027-03-28T01:30:00.000Z");
  });

  it("refuses the wall clock hour the spring forward skips", () => {
    // 02:30 never happens on that date; rolling it silently into 03:30 would book the wrong hour.
    expect(zurichInstant("2027-03-28T02:30")).toBeNull();
  });

  it("refuses a date that is not a real day rather than rolling it forward", () => {
    expect(zurichInstant("2027-02-31T09:00")).toBeNull();
    expect(zurichInstant("2027-13-01T09:00")).toBeNull();
  });

  it("refuses a value that is not a wall clock time at all", () => {
    expect(zurichInstant("")).toBeNull();
    expect(zurichInstant("tomorrow")).toBeNull();
    expect(zurichInstant("2027-07-15")).toBeNull();
  });

  it("round trips through formatZurichWallClock in both offsets", () => {
    for (const wallClock of ["2027-01-15T09:30", "2027-07-15T09:30", "2027-10-31T02:30"]) {
      const instant = zurichInstant(wallClock);
      expect(instant).not.toBeNull();
      expect(formatZurichWallClock(instant as Date)).toBe(wallClock);
    }
  });
});

describe("formatZurichWallClock", () => {
  it("renders an instant in Swiss local time, zero padded and on a 24 hour clock", () => {
    expect(formatZurichWallClock(new Date("2027-01-05T07:05:00.000Z"))).toBe("2027-01-05T08:05");
    expect(formatZurichWallClock(new Date("2027-07-05T21:00:00.000Z"))).toBe("2027-07-05T23:00");
    // Midnight is 00, never 24: the value seeds a `datetime-local` input, which refuses 24.
    expect(formatZurichWallClock(new Date("2027-01-04T23:00:00.000Z"))).toBe("2027-01-05T00:00");
  });
});

describe("scheduleOrderSchema", () => {
  afterEach(() => vi.useRealTimers());

  it("turns the form's wall clock time into the instant the database stores", () => {
    const parsed = scheduleOrderSchema.safeParse({
      orderId: ORDER_ID,
      scheduledAt: "2099-07-15T09:30",
      expertId: EXPERT_ID,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.scheduledAt.toISOString()).toBe("2099-07-15T07:30:00.000Z");
  });

  it("accepts the seconds a browser may append and trims the value", () => {
    const parsed = scheduleOrderSchema.safeParse({
      orderId: ORDER_ID,
      scheduledAt: "  2099-07-15T09:30:00  ",
      expertId: EXPERT_ID,
    });
    expect(parsed.data?.scheduledAt.toISOString()).toBe("2099-07-15T07:30:00.000Z");
  });

  it("refuses a past date under its own message, so the action can report date_not_future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-06-01T00:00:00.000Z"));
    const parsed = scheduleOrderSchema.safeParse({
      orderId: ORDER_ID,
      scheduledAt: "2027-05-01T09:30",
      expertId: EXPERT_ID,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.message === "scheduledAtPast")).toBe(true);
  });

  it("refuses a wall clock time that does not exist, under scheduledAtInvalid", () => {
    const parsed = scheduleOrderSchema.safeParse({
      orderId: ORDER_ID,
      scheduledAt: "2099-03-29T02:30",
      expertId: EXPERT_ID,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.message === "scheduledAtInvalid")).toBe(true);
  });

  it("refuses ids that are not uuids and a shape that is not the form's", () => {
    expect(
      scheduleOrderSchema.safeParse({
        orderId: "not-a-uuid",
        scheduledAt: "2099-07-15T09:30",
        expertId: EXPERT_ID,
      }).success,
    ).toBe(false);
    expect(
      scheduleOrderSchema.safeParse({ orderId: ORDER_ID, scheduledAt: "2099-07-15T09:30" }).success,
    ).toBe(false);
    expect(scheduleOrderSchema.safeParse(null).success).toBe(false);
  });
});

describe("rescheduleOrderSchema", () => {
  it("accepts a past date, because a visit recorded after the fact is real work (AC-7a)", () => {
    const parsed = rescheduleOrderSchema.safeParse({
      orderId: ORDER_ID,
      scheduledAt: "2020-01-15T09:30",
      expertId: EXPERT_ID,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.scheduledAt.toISOString()).toBe("2020-01-15T08:30:00.000Z");
  });

  it("still refuses a wall clock time that does not exist", () => {
    expect(
      rescheduleOrderSchema.safeParse({
        orderId: ORDER_ID,
        scheduledAt: "2027-03-28T02:30",
        expertId: EXPERT_ID,
      }).success,
    ).toBe(false);
  });
});

describe("unscheduleOrderSchema and orderDeliveryStateSchema", () => {
  it("names only the order to release", () => {
    expect(unscheduleOrderSchema.safeParse({ orderId: ORDER_ID }).success).toBe(true);
    expect(unscheduleOrderSchema.safeParse({ orderId: "nope" }).success).toBe(false);
  });

  it("offers only the two forward edges, never a status of the caller's choosing", () => {
    expect(
      orderDeliveryStateSchema.safeParse({ orderId: ORDER_ID, next: "in_progress" }).success,
    ).toBe(true);
    expect(
      orderDeliveryStateSchema.safeParse({ orderId: ORDER_ID, next: "delivered" }).success,
    ).toBe(true);
    for (const next of ["paid", "scheduled", "refunded", "cancelled"]) {
      expect(orderDeliveryStateSchema.safeParse({ orderId: ORDER_ID, next }).success).toBe(false);
    }
  });
});
