// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reveal and removal actions (spec 0018, AC-11, AC-12, AC-15): who the action serves, the
 * SQLSTATE codes the definer functions raise mapped to the typed errors, and the promise that no
 * address, name or company ever reaches an event or a log line. Only the boundaries are replaced:
 * the request context, Supabase, telemetry and the logger.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  expertStatus: "active" as string,
  rpc: vi.fn(),
  rpcCalls: [] as { name: string; args: Row }[],
  capture: vi.fn(),
  captureEvent: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: boundary.claims } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "expert_profiles"
              ? { data: { status: boundary.expertStatus }, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
    rpc: (name: string, args: Row) => {
      boundary.rpcCalls.push({ name, args });
      return { single: async () => boundary.rpc(name, args) };
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    SUPABASE_SECRET_KEY: "service-secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    INVOICE_DUE_DAYS: 30,
  }),
}));
vi.mock("@/lib/analytics/server", () => ({ captureServerEvent: boundary.captureEvent }));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.capture }));
vi.mock("@/lib/logger", () => ({
  log: { error: boundary.logError, info: boundary.logInfo, warn: vi.fn() },
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en-CH",
  getTranslations: async () => (key: string) => key,
}));

const { revealContact, removeDirectoryContact } = await import("@/features/directory/actions");

const EXPERT_ID = "e0000000-0000-4000-8000-000000000001";
const OPS_ID = "00000000-0000-4000-8000-0000000000ff";
const CONTACT_ID = "c0000000-0000-4000-8000-000000000001";

/** The row `directory_reveal` answers: the whole contact in clear plus the balance after. */
const REVEALED = {
  id: CONTACT_ID,
  company_name: "Alpha Werke AG",
  first_name: "Erika",
  last_name: "Muster",
  contact_title: "Head of Safety",
  email: "erika.muster@alpha.test",
  phone: "+41 41 123 45 67",
  mobile: null,
  unlocked_at: "2026-09-12T08:00:00Z",
  balance: 4,
  already_unlocked: false,
};

/** An error shaped the way PostgREST hands a `raise exception` up. */
const pgError = (code: string) => ({ code, message: `raised ${code}`, details: null, hint: null });

beforeEach(() => {
  vi.clearAllMocks();
  boundary.claims = { sub: EXPERT_ID, app_metadata: { role: "expert" } };
  boundary.expertStatus = "active";
  boundary.rpcCalls = [];
  boundary.rpc.mockResolvedValue({ data: REVEALED, error: null });
});

describe("revealContact (AC-11, AC-12)", () => {
  it("debits one credit and answers the raw values with the balance after", async () => {
    const result = await revealContact(null, { contactId: CONTACT_ID, locale: "de" });

    expect(boundary.rpcCalls).toEqual([
      { name: "directory_reveal", args: { contact_id: CONTACT_ID } },
    ]);
    expect(result).toEqual({
      ok: true,
      data: {
        contact: {
          contactId: CONTACT_ID,
          companyName: "Alpha Werke AG",
          firstName: "Erika",
          lastName: "Muster",
          title: "Head of Safety",
          email: "erika.muster@alpha.test",
          phone: "+41 41 123 45 67",
          mobile: null,
          unlockedAt: "2026-09-12T08:00:00Z",
        },
        balance: 4,
        alreadyUnlocked: false,
      },
    });
  });

  it("captures directory.unlocked with ids and codes only, never a name or an address", async () => {
    await revealContact(null, { contactId: CONTACT_ID, locale: "de" });

    expect(boundary.captureEvent).toHaveBeenCalledTimes(1);
    const [event] = boundary.captureEvent.mock.calls[0] as [
      { distinctId: string; event: string; properties: Row },
    ];
    expect(event.distinctId).toBe(EXPERT_ID);
    expect(event.event).toBe("directory.unlocked");
    // The two directory forms post the short code (`LOCALE_CODE[locale]`, so `de`), which is
    // what `revealContactSchema` requires. The event must record that same language.
    expect(event.properties).toEqual({
      locale: "de",
      contactId: CONTACT_ID,
      alreadyUnlocked: false,
      balanceAfter: 4,
    });
    const serialised = JSON.stringify(event);
    for (const secret of ["erika", "Muster", "alpha.test", "Alpha Werke", "123 45 67"]) {
      expect(serialised.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("reads the posted short code as the buyer's language, not the English default", async () => {
    // `unlock-cell.tsx` and `remove-contact-form.tsx` both post `LOCALE_CODE[locale]`, and both
    // schemas enum on `["de", "en"]`, so `de` is the value the action actually receives. If the
    // action resolves it against the full tags (`de-CH`), a German expert's event and validation
    // messages silently come back English.
    await revealContact(null, { contactId: CONTACT_ID, locale: "de" });
    const [german] = boundary.captureEvent.mock.calls[0] as [{ properties: { locale: string } }];
    expect(german.properties.locale).toBe("de");

    boundary.captureEvent.mockClear();
    await revealContact(null, { contactId: CONTACT_ID, locale: "en" });
    const [english] = boundary.captureEvent.mock.calls[0] as [{ properties: { locale: string } }];
    expect(english.properties.locale).toBe("en");
  });

  it("answers a second reveal of the same row as already unlocked, with nothing debited", async () => {
    boundary.rpc.mockResolvedValue({
      data: { ...REVEALED, balance: 4, already_unlocked: true },
      error: null,
    });

    const result = await revealContact(null, { contactId: CONTACT_ID, locale: "de" });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ alreadyUnlocked: true }),
      }),
    );
  });

  it("maps SM402 to insufficient_credits, so the row offers the credits link", async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: pgError("SM402") });

    const result = await revealContact(null, { contactId: CONTACT_ID, locale: "de" });

    expect(result).toEqual({ ok: false, error: "insufficient_credits" });
    // An expected refusal is not an incident.
    expect(boundary.capture).not.toHaveBeenCalled();
    expect(boundary.captureEvent).not.toHaveBeenCalled();
  });

  it("maps SM404 to not_found and SM403 to forbidden, neither reported to Sentry", async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: pgError("SM404") });
    expect(await revealContact(null, { contactId: CONTACT_ID, locale: "de" })).toEqual({
      ok: false,
      error: "not_found",
    });

    boundary.rpc.mockResolvedValue({ data: null, error: pgError("SM403") });
    expect(await revealContact(null, { contactId: CONTACT_ID, locale: "de" })).toEqual({
      ok: false,
      error: "forbidden",
    });

    expect(boundary.capture).not.toHaveBeenCalled();
  });

  it("reports an unknown database error to Sentry and answers unexpected, never throwing", async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: pgError("40001") });

    const result = await revealContact(null, { contactId: CONTACT_ID, locale: "de" });

    expect(result).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.capture).toHaveBeenCalledTimes(1);
    expect(boundary.logError).toHaveBeenCalledWith(
      "directory reveal failed",
      expect.objectContaining({ code: "40001" }),
    );
  });

  it("refuses a client caller before any rpc, because the proxy never runs for an action post", async () => {
    boundary.claims = { sub: "u1", app_metadata: { role: "client" } };

    expect(await revealContact(null, { contactId: CONTACT_ID, locale: "de" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(boundary.rpcCalls).toEqual([]);
  });

  it("refuses a signed out caller and an expert whose profile is not active", async () => {
    boundary.claims = null;
    expect(await revealContact(null, { contactId: CONTACT_ID, locale: "de" })).toEqual({
      ok: false,
      error: "forbidden",
    });

    boundary.claims = { sub: EXPERT_ID, app_metadata: { role: "expert" } };
    boundary.expertStatus = "invited";
    expect(await revealContact(null, { contactId: CONTACT_ID, locale: "de" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(boundary.rpcCalls).toEqual([]);
  });

  it("refuses a contact id that is not a uuid before the rpc", async () => {
    const result = await revealContact(null, { contactId: "not-a-uuid", locale: "de" });

    expect(result).toEqual({ ok: false, error: "validation" });
    expect(boundary.rpcCalls).toEqual([]);
  });
});

describe("removeDirectoryContact (AC-15)", () => {
  beforeEach(() => {
    boundary.claims = { sub: OPS_ID, app_metadata: { role: "ops" } };
    boundary.rpc.mockResolvedValue({
      data: { removed: true, unlocks_cascaded: 1 },
      error: null,
    });
  });

  it("passes the lowercased address and the reason, and reports what the removal cost", async () => {
    const result = await removeDirectoryContact(null, {
      email: "  Gone@Alpha.TEST ",
      reason: "data_subject_request",
      locale: "de",
    });

    expect(boundary.rpcCalls).toEqual([
      {
        name: "directory_remove_contact",
        args: { email: "gone@alpha.test", reason: "data_subject_request" },
      },
    ]);
    expect(result).toEqual({ ok: true, data: { outcome: "removed", unlocksCascaded: 1 } });
  });

  it("answers not_found when no row matched, the address still suppressed by the function", async () => {
    boundary.rpc.mockResolvedValue({ data: { removed: false, unlocks_cascaded: 0 }, error: null });

    const result = await removeDirectoryContact(null, {
      email: "nobody@alpha.test",
      reason: "ops",
      locale: "de",
    });

    expect(result).toEqual({ ok: true, data: { outcome: "not_found", unlocksCascaded: 0 } });
  });

  it("never writes the address to the log line", async () => {
    await removeDirectoryContact(null, {
      email: "gone@alpha.test",
      reason: "bounce",
      locale: "de",
    });

    expect(boundary.logInfo).toHaveBeenCalledWith(
      "ops removed a directory contact",
      expect.objectContaining({ actorId: OPS_ID, removed: true, reason: "bounce" }),
    );
    const logged = JSON.stringify(boundary.logInfo.mock.calls);
    expect(logged).not.toContain("gone@alpha.test");
  });

  it("refuses an expert and a signed out caller before any rpc", async () => {
    boundary.claims = { sub: EXPERT_ID, app_metadata: { role: "expert" } };
    expect(
      await removeDirectoryContact(null, { email: "gone@alpha.test", reason: "ops", locale: "de" }),
    ).toEqual({ ok: false, error: "forbidden" });

    boundary.claims = null;
    expect(
      await removeDirectoryContact(null, { email: "gone@alpha.test", reason: "ops", locale: "de" }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.rpcCalls).toEqual([]);
  });

  it("refuses a value that is not an address, and an unknown reason, before the rpc", async () => {
    expect(
      await removeDirectoryContact(null, { email: "not-an-address", reason: "ops", locale: "de" }),
    ).toEqual({ ok: false, error: "validation" });

    expect(
      await removeDirectoryContact(null, {
        email: "gone@alpha.test",
        reason: "whatever",
        locale: "de",
      }),
    ).toEqual({ ok: false, error: "validation" });
    expect(boundary.rpcCalls).toEqual([]);
  });

  it("reports an unknown database error to Sentry and answers unexpected", async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: pgError("40001") });

    const result = await removeDirectoryContact(null, {
      email: "gone@alpha.test",
      reason: "ops",
      locale: "de",
    });

    expect(result).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.capture).toHaveBeenCalledTimes(1);
  });
});
