// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `submitEnquiry` (spec 0009, AC-9, AC-10): the honeypot and the timing check answer `ok` and
 * store nothing, the schema answers `validation` with the field keys, the two counted rate
 * limits answer `rate_limited`, an insert failure answers `unavailable` and reaches Sentry, a
 * failed alert or email trigger still answers `ok`, a signed in client's row carries their
 * organization and id while ops and anonymous rows stay anonymous, and the alert, the email and
 * the PostHog event carry the row's values. The headers, the two Supabase clients, the two
 * trigger helpers, the analytics client, the env, Sentry and the logger are the boundaries.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  claims: null as Record<string, unknown> | null,
  counts: { ip_hash: 0, email: 0 } as Record<string, number>,
  countError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  inserted: [] as Row[],
  countFilters: [] as Array<{ column: string; value: unknown }>,
  alert: vi.fn<() => Promise<unknown>>(),
  email: vi.fn<() => Promise<unknown>>(),
  capture: vi.fn<() => Promise<boolean>>(),
  captureException: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => boundary.headers.get(name) ?? null }),
}));
vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => builder() }),
}));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: boundary.alert }));
vi.mock("@/lib/email/send", () => ({ sendEmail: boundary.email }));
vi.mock("@/lib/analytics/server", () => ({ captureServerEvent: boundary.capture }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ SUPABASE_SECRET_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1" }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));
vi.mock("@/lib/logger", () => ({
  log: { info: boundary.info, warn: boundary.warn, error: vi.fn(), debug: vi.fn() },
}));

/** A PostgREST like builder: `select(...).eq().gte()` awaits to a count, `insert().select().single()` to the row. */
function builder() {
  let column = "";
  let payload: Row | undefined;
  const chain = {
    select: () => chain,
    insert: (value: Row) => {
      payload = value;
      return chain;
    },
    eq: (name: string, value: unknown) => {
      column = name;
      boundary.countFilters.push({ column: name, value });
      return chain;
    },
    gte: () => chain,
    single: async () => {
      if (boundary.insertError) return { data: null, error: boundary.insertError };
      const row = {
        id: `e1000000-0000-4000-8000-00000000000${boundary.inserted.length + 1}`,
        ...payload,
      };
      boundary.inserted.push(row);
      return { data: { id: row.id }, error: null };
    },
    // biome-ignore lint/suspicious/noThenProperty: the fake mimics PostgREST's thenable builder
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(
        boundary.countError
          ? { count: null, error: boundary.countError }
          : { count: boundary.counts[column] ?? 0, error: null },
      ).then(resolve, reject),
  };
  return chain;
}

const { submitEnquiry } = await import("@/features/marketing/actions");

const AT = new Date("2026-09-06T10:00:00Z");
const USER = "a0000000-0000-4000-8000-000000000002";
const ORG = "0a000000-0000-4000-8000-000000000000";

const input = {
  topic: "retainer",
  companyName: " Muster AG ",
  contactName: "Clara Muster",
  email: " Clara@Example.CH ",
  phone: "",
  headcountBand: "50-249",
  message: "We are looking for an ongoing EHS partner for two sites.",
  locale: "de",
  website: "",
  startedAt: String(AT.getTime() - 5_000),
};

beforeEach(() => {
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
  boundary.headers = new Map([["x-forwarded-for", "203.0.113.7, 10.0.0.1"]]);
  boundary.claims = null;
  boundary.counts = { ip_hash: 0, email: 0 };
  boundary.countError = null;
  boundary.insertError = null;
  boundary.inserted = [];
  boundary.countFilters = [];
  boundary.alert.mockResolvedValue({ ok: true, runId: "run_alert" });
  boundary.email.mockResolvedValue({ ok: true, runId: "run_email" });
  boundary.capture.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitEnquiry bot guards (AC-10)", () => {
  it("answers ok with a decoy id and stores nothing when the honeypot is filled", async () => {
    const result = await submitEnquiry(null, { ...input, website: "https://spam.example" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(boundary.inserted).toEqual([]);
    expect(boundary.alert).not.toHaveBeenCalled();
    expect(boundary.info).toHaveBeenCalledWith("enquiry rejected", { reason: "honeypot" });
  });

  it("answers ok and stores nothing when the form was submitted under three seconds after mount", async () => {
    const result = await submitEnquiry(null, { ...input, startedAt: String(AT.getTime() - 1_000) });
    expect(result.ok).toBe(true);
    expect(boundary.inserted).toEqual([]);
    expect(boundary.info).toHaveBeenCalledWith("enquiry rejected", { reason: "too_fast" });
  });

  it("treats a missing mount time as a bot", async () => {
    const { startedAt: _omitted, ...withoutStart } = input;
    const result = await submitEnquiry(null, withoutStart);
    expect(result.ok).toBe(true);
    expect(boundary.inserted).toEqual([]);
    expect(boundary.info).toHaveBeenCalledWith("enquiry rejected", { reason: "no_start" });
  });
});

describe("submitEnquiry validation and rate limits (AC-9, AC-10)", () => {
  it("answers validation with the per field message keys in the form's language", async () => {
    const result = await submitEnquiry(null, {
      ...input,
      companyName: "",
      email: "nope",
      message: "short",
    });
    expect(result).toMatchObject({ ok: false, error: "validation" });
    if (result.ok || result.error !== "validation") throw new Error("expected validation");
    expect(result.fields).toMatchObject({
      companyName: "companyRequired",
      message: "messageShort",
    });
    expect(Object.keys(result.fields).sort()).toEqual(["companyName", "email", "message"]);
    expect(boundary.inserted).toEqual([]);
  });

  it("answers rate_limited at the sixth submission from one address in an hour", async () => {
    boundary.counts = { ip_hash: 5, email: 0 };
    const result = await submitEnquiry(null, input);
    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(boundary.inserted).toEqual([]);
    expect(boundary.countFilters).toContainEqual({
      column: "ip_hash",
      value: createHash("sha256").update("203.0.113.7").digest("hex"),
    });
  });

  it("answers rate_limited at the fourth submission with one email in a day", async () => {
    boundary.counts = { ip_hash: 0, email: 3 };
    const result = await submitEnquiry(null, input);
    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(boundary.countFilters).toContainEqual({ column: "email", value: "clara@example.ch" });
  });

  it("lets the fifth address submission and the third email submission through", async () => {
    boundary.counts = { ip_hash: 4, email: 2 };
    const result = await submitEnquiry(null, input);
    expect(result.ok).toBe(true);
    expect(boundary.inserted).toHaveLength(1);
  });

  it("skips the address count and stores a null hash when no address header is set", async () => {
    boundary.headers = new Map();
    const result = await submitEnquiry(null, input);
    expect(result.ok).toBe(true);
    expect(boundary.countFilters.map((filter) => filter.column)).toEqual(["email"]);
    expect(boundary.inserted[0]).toMatchObject({ ip_hash: null });
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    boundary.headers = new Map([["x-real-ip", "198.51.100.9"]]);
    await submitEnquiry(null, input);
    expect(boundary.inserted[0]).toMatchObject({
      ip_hash: createHash("sha256").update("198.51.100.9").digest("hex"),
    });
  });

  it("answers unavailable and reports to Sentry when a count query fails", async () => {
    boundary.countError = { message: "connection refused" };
    const result = await submitEnquiry(null, input);
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
    expect(boundary.inserted).toEqual([]);
  });

  it("answers unavailable and reports to Sentry when the insert fails", async () => {
    boundary.insertError = { message: "permission denied" };
    const result = await submitEnquiry(null, input);
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
    expect(boundary.alert).not.toHaveBeenCalled();
    expect(boundary.email).not.toHaveBeenCalled();
  });
});

describe("submitEnquiry stores the row and fires the rails (AC-9)", () => {
  it("stores the normalised row anonymously and answers its id", async () => {
    const result = await submitEnquiry(null, input);
    expect(result).toEqual({ ok: true, data: { id: boundary.inserted[0]?.id } });
    expect(boundary.inserted[0]).toEqual({
      id: expect.any(String),
      topic: "retainer",
      company_name: "Muster AG",
      contact_name: "Clara Muster",
      email: "clara@example.ch",
      phone: null,
      headcount_band: "50-249",
      message: "We are looking for an ongoing EHS partner for two sites.",
      locale: "de",
      ip_hash: createHash("sha256").update("203.0.113.7").digest("hex"),
      organization_id: null,
      submitted_by: null,
    });
  });

  it("links the row to a signed in client's organization and user", async () => {
    boundary.claims = { sub: USER, app_metadata: { role: "client", organization_id: ORG } };
    await submitEnquiry(null, input);
    expect(boundary.inserted[0]).toMatchObject({ organization_id: ORG, submitted_by: USER });
  });

  it("keeps an ops or expert tester's row anonymous", async () => {
    boundary.claims = { sub: USER, app_metadata: { role: "ops" } };
    await submitEnquiry(null, input);
    expect(boundary.inserted[0]).toMatchObject({ organization_id: null, submitted_by: null });
  });

  it("fires the alert with the company and the topic label, the bare admin link and the row's key", async () => {
    const result = await submitEnquiry(null, input);
    const id = result.ok ? result.data.id : "";
    expect(boundary.alert).toHaveBeenCalledWith({
      kind: "enquiry.received",
      fields: { organizationName: "Muster AG", topic: "Retainer" },
      link: `/admin/enquiries/${id}`,
      idempotencyKey: `enquiry/${id}/alert`,
    });
  });

  it("fires the acknowledgement to the typed address in the page language with the row's key", async () => {
    const result = await submitEnquiry(null, { ...input, topic: "general" });
    const id = result.ok ? result.data.id : "";
    expect(boundary.email).toHaveBeenCalledWith({
      template: "enquiry_received",
      data: { contactName: "Clara Muster", topic: "general" },
      recipient: { email: "clara@example.ch", locale: "de" },
      sourceEvent: "enquiry.received",
      idempotencyKey: `enquiry/${id}/ack`,
    });
  });

  it("captures the enquiry_sent event with the id, the topic and the language", async () => {
    const result = await submitEnquiry(null, input);
    const id = result.ok ? result.data.id : "";
    expect(boundary.capture).toHaveBeenCalledWith({
      distinctId: id,
      event: "enquiry_sent",
      properties: { topic: "retainer", locale: "de" },
    });
  });

  it("still answers ok when the alert and the email trigger fail, and logs both", async () => {
    boundary.alert.mockResolvedValue({ ok: false, error: "trigger_failed" });
    boundary.email.mockResolvedValue({ ok: false, error: "trigger_unavailable" });
    const result = await submitEnquiry(null, input);
    expect(result.ok).toBe(true);
    expect(boundary.inserted).toHaveLength(1);
    expect(boundary.warn).toHaveBeenCalledWith(
      "enquiry alert not sent",
      expect.objectContaining({ error: "trigger_failed" }),
    );
    expect(boundary.warn).toHaveBeenCalledWith(
      "enquiry acknowledgement not sent",
      expect.objectContaining({ error: "trigger_unavailable" }),
    );
  });

  it("still answers ok when the analytics client throws", async () => {
    boundary.capture.mockRejectedValue(new Error("posthog down"));
    const result = await submitEnquiry(null, input);
    expect(result.ok).toBe(true);
    expect(boundary.warn).toHaveBeenCalledWith(
      "enquiry event not captured",
      expect.objectContaining({ reason: "Error: posthog down" }),
    );
  });
});
