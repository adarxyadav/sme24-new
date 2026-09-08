import { z } from "zod";
import { TIME_ZONE } from "@/i18n/formats";

/**
 * The ops admin boundary schemas (spec 0014). The scheduling form and `scheduleOrder` parse with
 * the same schema, so the browser and the server apply one rule. Pure, runs anywhere.
 */

/**
 * Ops schedule a paid order: which order, when the visit happens and who is going.
 *
 * `scheduledAt` is the `datetime-local` value the ops browser produces (`2026-10-01T09:00`), read
 * as a wall clock time in Europe/Zurich rather than in the browser's own zone: ops book Swiss site
 * visits, and an ops user travelling would otherwise book an hour out. It is transformed here to
 * the instant the database stores, so the action and the form never handle the conversion twice.
 *
 * The future check is a courtesy that keeps the form honest; the database is the real arbiter
 * (spec 0014, AC-5), because only its clock decides and only it sees a concurrent write.
 */
export const scheduleOrderSchema = z.object({
  orderId: z.uuid(),
  scheduledAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, "scheduledAtInvalid")
    .transform((value, ctx) => {
      const instant = zurichInstant(value);
      if (!instant) {
        ctx.addIssue({ code: "custom", message: "scheduledAtInvalid" });
        return z.NEVER;
      }
      return instant;
    })
    .refine((instant) => instant.getTime() > Date.now(), "scheduledAtPast"),
  expertId: z.uuid(),
});

export type ScheduleOrderInput = z.output<typeof scheduleOrderSchema>;

/** The `datetime-local` shape the form field carries before the schema turns it into an instant. */
export const SCHEDULED_AT_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$";

/**
 * The instant a `YYYY-MM-DDTHH:mm` wall clock time names in Europe/Zurich, or null when the parts
 * do not describe a real moment (the hour skipped by the spring forward, or a nonsense date such
 * as 31 February, which `Date` would otherwise roll into March).
 *
 * Derived rather than assumed: the zone's offset is read back from the guessed instant with
 * `Intl`, so the two Swiss offsets and any future change to them are handled without a table.
 * Pure, runs anywhere.
 */
export function zurichInstant(wallClock: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wallClock);
  if (!match) return null;
  const parts = match.slice(1, 6).map(Number) as [number, number, number, number, number];
  const [year, month, day, hour, minute] = parts;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(asUtc)) return null;
  // Two passes: the first offset is read at the UTC guess, the second at the corrected instant, so
  // a time near a transition lands on the offset that actually applies to it.
  const first = new Date(asUtc - zurichOffsetMs(new Date(asUtc)));
  const instant = new Date(asUtc - zurichOffsetMs(first));
  // The round trip catches a wall clock time that does not exist: reading the instant back in the
  // zone gives a different local time than the one asked for.
  return formatZurichWallClock(instant) ===
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`
    ? instant
    : null;
}

/** How far ahead of UTC Europe/Zurich runs at this instant, in milliseconds. Pure. */
function zurichOffsetMs(at: Date): number {
  const local = new Date(`${formatZurichWallClock(at)}:00Z`);
  return local.getTime() - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** An instant as its `YYYY-MM-DDTHH:mm` wall clock time in Europe/Zurich. Pure. */
export function formatZurichWallClock(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

/**
 * Ops correct the date or the assessor on an order already `scheduled`, `in_progress` or
 * `delivered` (AC-7a). The same shape as scheduling, minus the future check: recording a visit
 * that already happened is real work, which is why the database drops that guard off this path
 * too (spec 0014, State transitions).
 */
export const rescheduleOrderSchema = z.object({
  orderId: z.uuid(),
  scheduledAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, "scheduledAtInvalid")
    .transform((value, ctx) => {
      const instant = zurichInstant(value);
      if (!instant) {
        ctx.addIssue({ code: "custom", message: "scheduledAtInvalid" });
        return z.NEVER;
      }
      return instant;
    }),
  expertId: z.uuid(),
});

export type RescheduleOrderInput = z.output<typeof rescheduleOrderSchema>;

/** Ops release a booked order back to `paid` (AC-7). Only the order is named. */
export const unscheduleOrderSchema = z.object({ orderId: z.uuid() });

export type UnscheduleOrderInput = z.output<typeof unscheduleOrderSchema>;

/**
 * Ops move a booked order along the delivery states (AC-6). The two forward edges are the only
 * ones offered, so `next` is a literal pair rather than the whole status union; the database
 * refuses everything else regardless.
 */
export const orderDeliveryStateSchema = z.object({
  orderId: z.uuid(),
  next: z.enum(["in_progress", "delivered"]),
});

export type OrderDeliveryStateInput = z.output<typeof orderDeliveryStateSchema>;
