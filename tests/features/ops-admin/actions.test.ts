// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The four ops admin actions (spec 0014). What these guard is the part the database cannot: the
 * ops check on every action (AC-8), the order the two writes are made in, the guarded filters that
 * keep a race honest, and the trigger refusal reaching the caller as a typed error rather than a
 * throw.
 *
 * The Supabase boundary is faked per table and every write is recorded with its filters, so a test
 * can assert that the assignment is written before the order (a deactivated expert must be refused
 * before the order moves) and that each update names the status the read saw.
 */
type Row = Record<string, unknown>;
type Result = { data: Row | null; error: Row | null };

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  /** What `select().eq().maybeSingle()` answers, per table. */
  reads: {} as Record<string, Result>,
  /**
   * Answers queued ahead of `reads` for one table, oldest first. `rescheduleOrder` reads `orders`
   * twice for different questions — the order itself, then whether the superseded expert is still
   * booked elsewhere — so the second answer has to be settable independently of the first.
   */
  queued: {} as Record<string, Result[]>,
  /** What `update().eq()...maybeSingle()` answers, per table. */
  writes: {} as Record<string, Result>,
  /** What the assignment insert answers. */
  insertResult: { error: null as Row | null },
  updates: [] as { table: string; values: Row; filters: Row }[],
  inserts: [] as { table: string; values: Row }[],
  members: [] as Row[],
  sendEmail: vi.fn(),
  captureException: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      // Both read shapes the actions use: `.eq().maybeSingle()` for one row, and a chain ending
      // in an await for the member list. Every filter is permissive here; what the filters are is
      // asserted on the writes, which is where a race is actually lost or won.
      select: () => {
        const read = boundary.queued[table]?.shift() ??
          boundary.reads[table] ?? { data: null, error: null };
        const chain = Object.assign(Promise.resolve({ data: boundary.members, error: null }), {
          eq: () => chain,
          in: () => chain,
          limit: () => chain,
          maybeSingle: async () => read,
        });
        return chain;
      },
      update: (values: Row) => {
        const filters: Row = {};
        const record = () => {
          const existing = boundary.updates.find((entry) => entry.values === values);
          if (!existing) boundary.updates.push({ table, values, filters });
        };
        const chain = Object.assign(Promise.resolve({ data: null, error: null }), {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            record();
            return chain;
          },
          in: (column: string, value: unknown) => {
            filters[column] = value;
            record();
            return chain;
          },
          select: () => chain,
          maybeSingle: async () => boundary.writes[table] ?? { data: null, error: null },
        });
        return chain;
      },
      insert: async (values: Row) => {
        boundary.inserts.push({ table, values });
        return { data: null, error: boundary.insertResult.error };
      },
    }),
  }),
}));

vi.mock("@/lib/email/send", () => ({ sendEmail: boundary.sendEmail }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    SUPABASE_SECRET_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: boundary.logWarn, error: boundary.logError, debug: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const ORDER_ID = "0e000000-0000-4000-8000-000000000001";
const EXPERT_ID = "0e000000-0000-4000-8000-000000000002";
const OTHER_EXPERT_ID = "0e000000-0000-4000-8000-000000000003";
const ORG_ID = "0e000000-0000-4000-8000-000000000004";
const OPS_ID = "0e000000-0000-4000-8000-000000000005";
const MEMBER_ID = "0e000000-0000-4000-8000-000000000006";

/** A wall clock time far enough ahead that the schema's own future check never expires. */
const FUTURE = "2099-07-15T09:30";

const { scheduleOrder, rescheduleOrder, unscheduleOrder, setOrderDeliveryState } = await import(
  "@/features/ops-admin/actions"
);

/** The check violation the guards raise, in the shape PostgREST hands back. */
const checkViolation = (message: string) => ({ code: "23514", message, details: null, hint: null });

/** The update recorded against a table, or undefined when the action never wrote it. */
const updateOf = (table: string) => boundary.updates.find((entry) => entry.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  boundary.claims = { sub: OPS_ID, app_metadata: { role: "ops" } };
  boundary.updates = [];
  boundary.inserts = [];
  boundary.queued = {};
  boundary.members = [{ user_id: MEMBER_ID }];
  boundary.insertResult = { error: null };
  boundary.reads = {
    orders: {
      data: {
        id: ORDER_ID,
        status: "paid",
        organization_id: ORG_ID,
        package_name_snapshot: "Safety Culture",
        assigned_expert_id: null,
      },
      error: null,
    },
    // No active assignment yet, so the happy path inserts one.
    expert_assignments: { data: null, error: null },
    profiles: { data: { full_name: "Erika Expert" }, error: null },
  };
  boundary.writes = { orders: { data: { id: ORDER_ID }, error: null } };
  boundary.sendEmail.mockResolvedValue({ ok: true, runId: "run" });
});

describe("the ops check on every action (AC-8)", () => {
  const callers = [
    ["a client", { sub: MEMBER_ID, app_metadata: { role: "client" } }],
    ["an expert", { sub: EXPERT_ID, app_metadata: { role: "expert" } }],
    ["an anonymous visitor", null],
    ["a session with no role claim", { sub: MEMBER_ID, app_metadata: {} }],
  ] as const;

  for (const [who, claims] of callers) {
    it(`answers forbidden to ${who}, and writes nothing`, async () => {
      boundary.claims = claims as Record<string, unknown> | null;
      expect(
        await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
      ).toEqual({ ok: false, error: "forbidden" });
      expect(
        await rescheduleOrder(null, {
          orderId: ORDER_ID,
          scheduledAt: FUTURE,
          expertId: EXPERT_ID,
        }),
      ).toEqual({ ok: false, error: "forbidden" });
      expect(await unscheduleOrder(null, { orderId: ORDER_ID })).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await setOrderDeliveryState(null, { orderId: ORDER_ID, next: "delivered" })).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(boundary.updates).toHaveLength(0);
      expect(boundary.inserts).toHaveLength(0);
      expect(boundary.sendEmail).not.toHaveBeenCalled();
    });
  }

  it("answers forbidden to an ops role with no subject, since the actor id is written", async () => {
    boundary.claims = { app_metadata: { role: "ops" } };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("scheduleOrder (AC-3)", () => {
  it("grants the expert access, moves the order and emails every member", async () => {
    const result = await scheduleOrder(null, {
      orderId: ORDER_ID,
      scheduledAt: FUTURE,
      expertId: EXPERT_ID,
    });
    expect(result).toEqual({ ok: true });

    // The assignment is written first, so a deactivated expert is refused before the order moves.
    expect(boundary.inserts[0]).toMatchObject({
      table: "expert_assignments",
      values: {
        organization_id: ORG_ID,
        expert_id: EXPERT_ID,
        status: "active",
        assigned_by: OPS_ID,
      },
    });

    expect(updateOf("orders")).toMatchObject({
      values: {
        status: "scheduled",
        scheduled_at: "2099-07-15T07:30:00.000Z",
        assigned_expert_id: EXPERT_ID,
        scheduled_by: OPS_ID,
      },
      // Guarded on the status the read saw: a concurrent refund or schedule is never overwritten.
      filters: { id: ORDER_ID, status: "paid" },
    });

    expect(boundary.sendEmail).toHaveBeenCalledTimes(1);
    expect(boundary.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "assessment_scheduled",
        recipient: { userId: MEMBER_ID },
        organizationId: ORG_ID,
        idempotencyKey: `assessment-scheduled/${ORDER_ID}/${MEMBER_ID}`,
        // The instant travels, never a formatted string: the template renders it per language.
        data: {
          scheduledAt: "2099-07-15T07:30:00.000Z",
          expertName: "Erika Expert",
          packageName: "Safety Culture",
        },
      }),
    );
  });

  it("emails every member of the organization, whatever their role", async () => {
    boundary.members = [{ user_id: MEMBER_ID }, { user_id: OTHER_EXPERT_ID }];
    await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID });
    expect(boundary.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("reuses an assignment that is already active rather than inserting a second one", async () => {
    boundary.reads.expert_assignments = { data: { id: "assignment-id" }, error: null };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: true });
    expect(boundary.inserts).toHaveLength(0);
    expect(updateOf("orders")).toBeDefined();
  });

  it("treats a duplicate assignment insert as success: the access exists either way", async () => {
    boundary.insertResult = { error: { code: "23505", message: "duplicate key" } };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: true });
  });

  it("refuses an order that is not paid, without touching the assignment (AC-6)", async () => {
    for (const status of ["pending", "scheduled", "delivered", "refunded", "cancelled"]) {
      boundary.updates = [];
      boundary.inserts = [];
      boundary.reads.orders = {
        data: { id: ORDER_ID, status, organization_id: ORG_ID, package_name_snapshot: "P" },
        error: null,
      };
      expect(
        await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
      ).toEqual({ ok: false, error: "not_paid" });
      expect(boundary.inserts).toHaveLength(0);
      expect(boundary.updates).toHaveLength(0);
    }
  });

  it("answers not_found for an order nobody holds", async () => {
    boundary.reads.orders = { data: null, error: null };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("reports a deactivated expert before the order moves (AC-4)", async () => {
    boundary.insertResult = { error: checkViolation("expert_not_active: someone is inactive") };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "expert_not_assignable" });
    // The order never moved and nobody was told a date that was never booked.
    expect(updateOf("orders")).toBeUndefined();
    expect(boundary.sendEmail).not.toHaveBeenCalled();
  });

  it("reports a past date from the schema under its own code (AC-5)", async () => {
    expect(
      await scheduleOrder(null, {
        orderId: ORDER_ID,
        scheduledAt: "2020-01-15T09:30",
        expertId: EXPERT_ID,
      }),
    ).toEqual({ ok: false, error: "date_not_future" });
    expect(boundary.inserts).toHaveLength(0);
  });

  it("reports the database's own past date refusal as date_not_future too", async () => {
    boundary.writes.orders = {
      data: null,
      error: checkViolation("orders scheduled_at must be in the future"),
    };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "date_not_future" });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
  });

  it("reports any other malformed input as validation", async () => {
    expect(
      await scheduleOrder(null, { orderId: "nope", scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "validation" });
    expect(await scheduleOrder(null, null)).toEqual({ ok: false, error: "validation" });
  });

  it("tells the loser of a race invalid_transition rather than overwriting the winner", async () => {
    // The guarded update matched no row: another ops user moved the order in between.
    boundary.writes.orders = { data: null, error: null };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
  });

  it("maps the trigger's own status guard to invalid_transition", async () => {
    boundary.writes.orders = {
      data: null,
      error: checkViolation("orders status is already scheduled"),
    };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("sends a real fault to Sentry and answers unexpected", async () => {
    boundary.writes.orders = {
      data: null,
      error: { code: "42501", message: "permission denied for table orders" },
    };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalled();
  });

  it("keeps the booking when the expert has no name, and says so in the log", async () => {
    boundary.reads.profiles = { data: { full_name: "   " }, error: null };
    expect(
      await scheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: true });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
    expect(boundary.logWarn).toHaveBeenCalled();
  });
});

describe("rescheduleOrder (AC-7a)", () => {
  beforeEach(() => {
    boundary.reads.orders = {
      data: {
        id: ORDER_ID,
        status: "in_progress",
        organization_id: ORG_ID,
        assigned_expert_id: EXPERT_ID,
      },
      error: null,
    };
  });

  it("corrects the date without moving the status, and never writes one", async () => {
    const result = await rescheduleOrder(null, {
      orderId: ORDER_ID,
      // A past date is the point here: ops record a visit that already happened.
      scheduledAt: "2020-01-15T09:30",
      expertId: EXPERT_ID,
    });
    expect(result).toEqual({ ok: true });
    const update = updateOf("orders");
    expect(update?.values).not.toHaveProperty("status");
    expect(update).toMatchObject({
      values: {
        scheduled_at: "2020-01-15T08:30:00.000Z",
        assigned_expert_id: EXPERT_ID,
        scheduled_by: OPS_ID,
      },
      filters: { id: ORDER_ID, status: ["scheduled", "in_progress", "delivered"] },
    });
    // The expert did not change, so no grant and no end.
    expect(boundary.inserts).toHaveLength(0);
    expect(updateOf("expert_assignments")).toBeUndefined();
  });

  it("ends the superseded expert's access when nothing else of that organization names them", async () => {
    boundary.queued.orders = [
      {
        data: {
          id: ORDER_ID,
          status: "scheduled",
          organization_id: ORG_ID,
          assigned_expert_id: EXPERT_ID,
        },
        error: null,
      },
      // The second `orders` read asks whether the superseded expert is still booked: nobody else
      // names them, so the old grant is ended.
      { data: null, error: null },
    ];
    boundary.reads.expert_assignments = { data: null, error: null };
    const result = await rescheduleOrder(null, {
      orderId: ORDER_ID,
      scheduledAt: FUTURE,
      expertId: OTHER_EXPERT_ID,
    });
    expect(result).toEqual({ ok: true });
    // The new grant is written before the order, as on the schedule path.
    expect(boundary.inserts[0]).toMatchObject({
      table: "expert_assignments",
      values: { expert_id: OTHER_EXPERT_ID, status: "active" },
    });
    expect(updateOf("expert_assignments")).toMatchObject({
      values: { status: "ended" },
      filters: { organization_id: ORG_ID, expert_id: EXPERT_ID, status: "active" },
    });
  });

  it("keeps the superseded expert's access when another live order still names them", async () => {
    boundary.queued.orders = [
      {
        data: {
          id: ORDER_ID,
          status: "scheduled",
          organization_id: ORG_ID,
          assigned_expert_id: EXPERT_ID,
        },
        error: null,
      },
      // Another order of the same organization is still theirs, so the grant stands (invariant 4).
      { data: { id: "another-order" }, error: null },
    ];
    boundary.reads.expert_assignments = { data: null, error: null };
    expect(
      await rescheduleOrder(null, {
        orderId: ORDER_ID,
        scheduledAt: FUTURE,
        expertId: OTHER_EXPERT_ID,
      }),
    ).toEqual({ ok: true });
    expect(updateOf("expert_assignments")).toBeUndefined();
  });

  it("refuses a correction on an order that is not booked", async () => {
    for (const status of ["paid", "pending", "refunded", "cancelled", "expired"]) {
      boundary.updates = [];
      boundary.reads.orders = {
        data: { id: ORDER_ID, status, organization_id: ORG_ID, assigned_expert_id: null },
        error: null,
      };
      expect(
        await rescheduleOrder(null, {
          orderId: ORDER_ID,
          scheduledAt: FUTURE,
          expertId: EXPERT_ID,
        }),
      ).toEqual({ ok: false, error: "not_scheduled" });
      expect(boundary.updates).toHaveLength(0);
    }
  });

  it("reports a deactivated new expert without touching the order", async () => {
    boundary.insertResult = { error: checkViolation("expert_not_active: someone is inactive") };
    expect(
      await rescheduleOrder(null, {
        orderId: ORDER_ID,
        scheduledAt: FUTURE,
        expertId: OTHER_EXPERT_ID,
      }),
    ).toEqual({ ok: false, error: "expert_not_assignable" });
    expect(updateOf("orders")).toBeUndefined();
  });

  it("reports a lost race as invalid_transition", async () => {
    boundary.writes.orders = { data: null, error: null };
    expect(
      await rescheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("reports a delivery column guard as unexpected, since the shape is the action's own fault", async () => {
    boundary.writes.orders = {
      data: null,
      error: checkViolation("orders in_progress requires scheduled_at and assigned_expert_id"),
    };
    expect(
      await rescheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "unexpected" });
  });

  it("answers not_found and validation the same way scheduling does", async () => {
    boundary.reads.orders = { data: null, error: null };
    expect(
      await rescheduleOrder(null, { orderId: ORDER_ID, scheduledAt: FUTURE, expertId: EXPERT_ID }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await rescheduleOrder(null, { orderId: ORDER_ID })).toEqual({
      ok: false,
      error: "validation",
    });
  });
});

describe("unscheduleOrder (AC-7)", () => {
  beforeEach(() => {
    boundary.reads.orders = { data: { id: ORDER_ID, status: "scheduled" }, error: null };
  });

  it("clears both columns in the same statement the status moves back to paid", async () => {
    expect(await unscheduleOrder(null, { orderId: ORDER_ID })).toEqual({ ok: true });
    expect(updateOf("orders")).toMatchObject({
      values: { status: "paid", scheduled_at: null, assigned_expert_id: null },
      filters: { id: ORDER_ID, status: "scheduled" },
    });
  });

  it("leaves the expert's assignment active on purpose (invariant 4)", async () => {
    await unscheduleOrder(null, { orderId: ORDER_ID });
    expect(updateOf("expert_assignments")).toBeUndefined();
    expect(boundary.inserts).toHaveLength(0);
  });

  it("refuses to release an order with work behind it", async () => {
    for (const status of ["in_progress", "delivered", "paid"]) {
      boundary.updates = [];
      boundary.reads.orders = { data: { id: ORDER_ID, status }, error: null };
      expect(await unscheduleOrder(null, { orderId: ORDER_ID })).toEqual({
        ok: false,
        error: "not_scheduled",
      });
      expect(boundary.updates).toHaveLength(0);
    }
  });

  it("reports a lost race as invalid_transition", async () => {
    boundary.writes.orders = { data: null, error: null };
    expect(await unscheduleOrder(null, { orderId: ORDER_ID })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });
});

describe("setOrderDeliveryState (AC-6)", () => {
  it("moves scheduled to in_progress without stamping a delivery time", async () => {
    boundary.reads.orders = { data: { id: ORDER_ID, status: "scheduled" }, error: null };
    expect(await setOrderDeliveryState(null, { orderId: ORDER_ID, next: "in_progress" })).toEqual({
      ok: true,
    });
    const update = updateOf("orders");
    expect(update?.values).toEqual({ status: "in_progress" });
    expect(update?.filters).toEqual({ id: ORDER_ID, status: "scheduled" });
  });

  it("moves in_progress to delivered and stamps delivered_at in the action", async () => {
    boundary.reads.orders = { data: { id: ORDER_ID, status: "in_progress" }, error: null };
    expect(await setOrderDeliveryState(null, { orderId: ORDER_ID, next: "delivered" })).toEqual({
      ok: true,
    });
    const update = updateOf("orders");
    expect(update?.values).toMatchObject({ status: "delivered" });
    expect(typeof update?.values.delivered_at).toBe("string");
    expect(update?.filters).toEqual({ id: ORDER_ID, status: "in_progress" });
  });

  it("refuses a skipped edge before it reaches the database", async () => {
    // paid straight to delivered, and scheduled straight to delivered.
    for (const [status, next] of [
      ["paid", "delivered"],
      ["scheduled", "delivered"],
      ["delivered", "in_progress"],
      ["in_progress", "in_progress"],
    ] as const) {
      boundary.updates = [];
      boundary.reads.orders = { data: { id: ORDER_ID, status }, error: null };
      expect(await setOrderDeliveryState(null, { orderId: ORDER_ID, next })).toEqual({
        ok: false,
        error: "invalid_transition",
      });
      expect(boundary.updates).toHaveLength(0);
    }
  });

  it("refuses a status the caller invented", async () => {
    boundary.reads.orders = { data: { id: ORDER_ID, status: "scheduled" }, error: null };
    expect(await setOrderDeliveryState(null, { orderId: ORDER_ID, next: "refunded" })).toEqual({
      ok: false,
      error: "validation",
    });
  });

  it("tells the loser of a double advance invalid_transition", async () => {
    boundary.reads.orders = { data: { id: ORDER_ID, status: "scheduled" }, error: null };
    boundary.writes.orders = { data: null, error: null };
    expect(await setOrderDeliveryState(null, { orderId: ORDER_ID, next: "in_progress" })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("answers not_found for an order nobody holds", async () => {
    boundary.reads.orders = { data: null, error: null };
    expect(await setOrderDeliveryState(null, { orderId: ORDER_ID, next: "in_progress" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
