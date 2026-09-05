// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scaffold check task (spec 0004, AC-7): it resolves the user's stored language, writes the
 * payload message plus the translated summary, and updates the row status. The Trigger.dev SDK,
 * the task env and the service client are the boundaries; `task()` is replaced with the identity
 * so the `run` function can be called directly.
 */
const sdk = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  task: (options: unknown) => options,
  tasks: { onFailure: vi.fn() },
  logger: { info: sdk.info, warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({
    SUPABASE_SECRET_KEY: "service-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));

const db = vi.hoisted(() => ({
  profileLocale: null as { locale: string } | null,
  profileError: null as unknown,
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ patch: Record<string, unknown>; id: string }>,
  insertError: null as unknown,
  updateError: null as unknown,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: (secretKey: string, url: string) => {
    db.inserted.push({ __client: { secretKey, url } });
    return {
      from: (table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: db.profileLocale, error: db.profileError }),
              }),
            }),
          };
        }
        if (table === "scaffold_checks") {
          return {
            insert: (row: Record<string, unknown>) => {
              db.inserted.push(row);
              return {
                select: () => ({
                  single: async () =>
                    db.insertError
                      ? { data: null, error: db.insertError }
                      : { data: { id: "row-1" }, error: null },
                }),
              };
            },
            update: (patch: Record<string, unknown>) => ({
              eq: async (_column: string, id: string) => {
                db.updated.push({ patch, id });
                return { error: db.updateError };
              },
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  },
}));

const { scaffoldCheck } = await import("@/trigger/scaffold-check");

type Payload = { message: string; shouldFail?: boolean; userId?: string };
const run = (
  scaffoldCheck as unknown as { run: (payload: Payload, opts: unknown) => Promise<{ id: string }> }
).run;
const ctx = { ctx: { run: { id: "run-1" } } };

/** 4 September 2026, 13:05 UTC: 15:05 in Zurich, the AC-3 fixture. */
const AT = new Date("2026-09-04T13:05:00Z");

/** The rows the task actually inserted (the client construction marker is filtered out). */
function insertedRows() {
  return db.inserted.filter((row) => !("__client" in row));
}

describe("scaffold check task (spec 0004, AC-7)", () => {
  beforeEach(() => {
    db.profileLocale = null;
    db.profileError = null;
    db.inserted = [];
    db.updated = [];
    db.insertError = null;
    db.updateError = null;
    vi.useFakeTimers({ now: AT, toFake: ["Date"] });
  });

  it("writes the summary in the user's stored language and finishes the row as done", async () => {
    db.profileLocale = { locale: "en" };
    await expect(
      run({ message: "Triggered by ops@sme24.ch", userId: "user-1" }, ctx),
    ).resolves.toEqual({
      id: "row-1",
    });
    expect(insertedRows()).toEqual([
      {
        run_id: "run-1",
        message: "Triggered by ops@sme24.ch · Inserted on 04.09.2026, 15:05",
        status: "running",
      },
    ]);
    expect(db.updated).toEqual([{ patch: { status: "done" }, id: "row-1" }]);
    expect(sdk.info).toHaveBeenCalledWith(
      "scaffold check row written",
      expect.objectContaining({ id: "row-1", runId: "run-1", locale: "en-CH" }),
    );
  });

  it("uses English, the default, without a userId, so an anonymous trigger never touches profiles", async () => {
    await run({ message: "Smoke" }, ctx);
    expect(insertedRows()[0]?.message).toBe("Smoke · Inserted on 04.09.2026, 15:05");
  });

  it("falls back to English, the default, when the user's profile is gone, so a retry never fails forever", async () => {
    db.profileLocale = null;
    await run({ message: "Smoke", userId: "deleted-user" }, ctx);
    expect(insertedRows()[0]?.message).toBe("Smoke · Inserted on 04.09.2026, 15:05");
  });

  it("marks the row failed and throws when asked to fail, so the error reaches Sentry", async () => {
    await expect(run({ message: "Smoke", shouldFail: true }, ctx)).rejects.toThrow(
      "SME24 scaffold: test failure",
    );
    expect(db.updated).toEqual([{ patch: { status: "failed" }, id: "row-1" }]);
  });

  it("throws on an insert error so Trigger.dev can retry", async () => {
    db.insertError = new Error("connection reset");
    await expect(run({ message: "Smoke" }, ctx)).rejects.toThrow("connection reset");
    expect(db.updated).toEqual([]);
  });

  it("throws on a status update error after the row exists", async () => {
    db.updateError = new Error("permission denied");
    await expect(run({ message: "Smoke" }, ctx)).rejects.toThrow("permission denied");
  });

  it("throws on a profile lookup error instead of guessing a language", async () => {
    db.profileError = new Error("connection reset");
    await expect(run({ message: "Smoke", userId: "user-1" }, ctx)).rejects.toThrow(
      "connection reset",
    );
    expect(insertedRows()).toEqual([]);
  });
});
