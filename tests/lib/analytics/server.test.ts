// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `src/lib/analytics/server.ts` is `server-only`, which throws on import outside a server
// component; the same neutralising mock the other server module suites use.
vi.mock("server-only", () => ({}));

/**
 * `captureServerEvent`'s failure contract (spec 0017, AC-2, AC-8, AC-12). The claim under test is
 * the one every call site depends on: analytics never changes what the caller does. A bad payload,
 * an unconfigured PostHog and a transport that throws must all end the same way, as `false` and a
 * log line, never as an exception escaping into a server action's typed result or a task's retry.
 *
 * Dropping rather than sending a half-valid event is the deliberate choice: a missing event shows
 * as a gap in the funnel, while a wrong one is believed.
 *
 * `posthog-node` is mocked because the real client opens a network connection on construction.
 */

const posthog = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  constructed: [] as { key: string; host: string | undefined }[],
  /** Set by a test to make construction itself fail, standing for an unreachable host. */
  throwOnConstruct: null as Error | null,
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(key: string, options: { host?: string }) {
      if (posthog.throwOnConstruct) throw posthog.throwOnConstruct;
      posthog.constructed.push({ key, host: options.host });
    }
    capture = posthog.capture;
    shutdown = posthog.shutdown;
  },
}));

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test" as string | undefined,
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.test" as string | undefined,
}));

vi.mock("@/lib/env", () => ({ serverEnv: () => env }));

const { captureServerEvent } = await import("@/lib/analytics/server");

const DISTINCT_ID = "11111111-1111-4111-8111-111111111111";

/** A valid `lookup.started` payload; individual tests break one field on purpose. */
const LOOKUP = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  runId: "44444444-4444-4444-8444-444444444444",
  locale: "de",
} as const;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  posthog.constructed.length = 0;
  posthog.throwOnConstruct = null;
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe("captureServerEvent, the happy path", () => {
  it("sends the event with its parsed properties and flushes before returning", async () => {
    await expect(
      captureServerEvent({ distinctId: DISTINCT_ID, event: "lookup.started", properties: LOOKUP }),
    ).resolves.toBe(true);

    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: DISTINCT_ID,
      event: "lookup.started",
      properties: { ...LOOKUP, $lib_context: "server" },
    });
    // A Vercel function can freeze between invocations, so the send has to be flushed inside the
    // call rather than left in a buffer that may never drain.
    expect(posthog.shutdown).toHaveBeenCalledTimes(1);
  });
});

describe("captureServerEvent drops a bad payload (AC-2, AC-12)", () => {
  it("returns false and never throws when a property fails its schema", async () => {
    await expect(
      captureServerEvent({
        distinctId: DISTINCT_ID,
        event: "lookup.started",
        // A value that arrived null from a database row, or a transposed pair: believable, and
        // exactly what the schema exists to stop.
        properties: { ...LOOKUP, companyId: "not-a-uuid" },
      }),
    ).resolves.toBe(false);

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("names the event and the offending path in the log line", async () => {
    await captureServerEvent({
      distinctId: DISTINCT_ID,
      event: "lookup.started",
      properties: { ...LOOKUP, locale: "de-CH" } as never,
    });

    // The log is the only trace a dropped event leaves, so it has to say which event and which
    // field, or a gap in the funnel is undiagnosable.
    const line = String(warn.mock.calls.at(0)?.[0] ?? "");
    expect(line).toContain("lookup.started");
    expect(line).toContain("locale");
  });

  it("drops a payload missing a required property entirely", async () => {
    const { companyId: _omitted, ...withoutCompany } = LOOKUP;
    await expect(
      captureServerEvent({
        distinctId: DISTINCT_ID,
        event: "lookup.started",
        properties: withoutCompany as never,
      }),
    ).resolves.toBe(false);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("strips a property the schema does not declare rather than forwarding it", async () => {
    await expect(
      captureServerEvent({
        distinctId: DISTINCT_ID,
        event: "enquiry.sent",
        // The security rule in the spec: no email address, no contact name, no free text ever
        // becomes an event property. The schema is what enforces it, not the call site.
        properties: { locale: "en", topic: "retainer", message: "please call me" } as never,
      }),
    ).resolves.toBe(true);

    expect(posthog.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: { locale: "en", topic: "retainer", $lib_context: "server" },
      }),
    );
  });
});

describe("captureServerEvent when PostHog cannot be reached (AC-8)", () => {
  it("returns false without constructing a client when no key is configured", async () => {
    env.NEXT_PUBLIC_POSTHOG_KEY = undefined;

    await expect(
      captureServerEvent({ distinctId: DISTINCT_ID, event: "lookup.started", properties: LOOKUP }),
    ).resolves.toBe(false);

    // The local default. Every call site still runs its own work unchanged.
    expect(posthog.constructed).toHaveLength(0);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("swallows a transport failure and returns false rather than throwing into the caller", async () => {
    posthog.throwOnConstruct = new Error("getaddrinfo ENOTFOUND eu.i.posthog.test");

    await expect(
      captureServerEvent({ distinctId: DISTINCT_ID, event: "lookup.started", properties: LOOKUP }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("swallows a failure raised by the flush itself", async () => {
    posthog.shutdown.mockRejectedValueOnce(new Error("socket hang up"));

    // A task throws to be retried; an analytics flush must never be the reason it does.
    await expect(
      captureServerEvent({ distinctId: DISTINCT_ID, event: "lookup.started", properties: LOOKUP }),
    ).resolves.toBe(false);
  });
});
