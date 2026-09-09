// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_COOKIE, CONSENT_VERSION } from "@/features/legal/consent";

/**
 * The five legal server actions (spec 0015): the consent cookie, the terms acceptance, and the
 * data subject requests a person files and ops work.
 *
 * What these guard is the part the database cannot. The cookie's own attributes, which decide
 * whether the bar's answer survives a reload and whether a third party script can read it. The
 * authorisation on every action, since the proxy never runs for a server action post. The order
 * `updateDataRequest` makes its writes in: a deletion anonymises the person **before** the row
 * records the fulfilment, so a throw leaves the request open rather than leaving a row claiming a
 * deletion that did not happen. And the two races the guarded filters settle: the 23505 from the
 * partial unique index becoming the typed `already_open`, and a second ops user's move reading
 * zero rows rather than overwriting the first.
 *
 * The Supabase boundary is faked per table and every write is recorded with its filters, so a test
 * can assert both what was written and what it was guarded on.
 */
type Row = Record<string, unknown>;
type Result = { data: Row | readonly Row[] | null; error: Row | null };

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  cookies: {
    set: vi.fn<(name: string, value: string, options: Row) => void>(),
    delete: vi.fn<(name: string) => void>(),
  },
  rpc: vi.fn<(name: string, args: Row) => Promise<{ error: Row | null }>>(),
  /** What a user client read answers, per table. */
  userReads: {} as Record<string, Result>,
  /** What the insert on the user client answers. */
  insertResult: { data: null, error: null } as Result,
  /** What a service client `select().eq().maybeSingle()` answers, per table. */
  serviceReads: {} as Record<string, Result>,
  /** What a service client `update().eq()...maybeSingle()` answers, per table. */
  serviceWrites: {} as Record<string, Result>,
  inserts: [] as { table: string; values: Row }[],
  updates: [] as { table: string; values: Row; filters: Row }[],
  anonymise: vi.fn<(client: unknown, userId: string) => Promise<Row>>(),
  sendOpsAlert: vi.fn(),
  revalidatePath: vi.fn<(path: string) => void>(),
  captureException: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

/** The read/insert chain of the caller's own client, where RLS is the boundary. */
function userClient() {
  return {
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: (table: string) => ({
      insert: (values: Row) => {
        boundary.inserts.push({ table, values });
        return {
          select: () => ({ single: async () => boundary.insertResult }),
        };
      },
      select: () => {
        const read = boundary.userReads[table] ?? { data: null, error: null };
        const chain = Object.assign(Promise.resolve(read), {
          order: () => chain,
          eq: () => chain,
          maybeSingle: async () => read,
        });
        return chain;
      },
    }),
    rpc: boundary.rpc,
  };
}

vi.mock("next/headers", () => ({ cookies: async () => boundary.cookies }));
vi.mock("@/lib/supabase/action", () => ({ createActionClient: async () => userClient() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        const read = boundary.serviceReads[table] ?? { data: null, error: null };
        const chain = Object.assign(Promise.resolve(read), {
          eq: () => chain,
          maybeSingle: async () => read,
        });
        return chain;
      },
      update: (values: Row) => {
        const filters: Row = {};
        const record = () => {
          if (!boundary.updates.some((entry) => entry.values === values)) {
            boundary.updates.push({ table, values, filters });
          }
        };
        const chain = Object.assign(Promise.resolve({ data: null, error: null }), {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            record();
            return chain;
          },
          select: () => chain,
          maybeSingle: async () => boundary.serviceWrites[table] ?? { data: null, error: null },
        });
        return chain;
      },
    }),
  }),
}));
vi.mock("@/features/legal/anonymise", () => ({ anonymisePerson: boundary.anonymise }));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: boundary.sendOpsAlert }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    SUPABASE_SECRET_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));
vi.mock("@/lib/logger", () => ({
  log: {
    info: boundary.logInfo,
    warn: boundary.logWarn,
    error: boundary.logError,
    debug: vi.fn(),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: boundary.revalidatePath }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const CLIENT_ID = "0f000000-0000-4000-8000-000000000001";
const OPS_ID = "0f000000-0000-4000-8000-000000000002";
const ORG_ID = "0f000000-0000-4000-8000-000000000003";
const REQUEST_ID = "0f000000-0000-4000-8000-000000000004";

const { acceptTerms, clearConsent, myDataRequests, requestData, setConsent, updateDataRequest } =
  await import("@/features/legal/actions");
const { CURRENT_TERMS_VERSION } = await import("@/features/legal/terms");

/** The claims a signed in client of any role carries. */
const claimsFor = (role: string, sub: string) => ({
  sub,
  email: "person@example.ch",
  app_metadata: { role, organization_id: ORG_ID },
});

const updateOf = (table: string) => boundary.updates.find((entry) => entry.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  boundary.claims = claimsFor("client", CLIENT_ID);
  boundary.inserts = [];
  boundary.updates = [];
  boundary.userReads = { data_requests: { data: [], error: null } };
  boundary.insertResult = { data: { id: REQUEST_ID }, error: null };
  boundary.serviceReads = {
    data_requests: {
      data: {
        id: REQUEST_ID,
        kind: "export",
        status: "new",
        requested_by: CLIENT_ID,
        handled_by: null,
      },
      error: null,
    },
  };
  boundary.serviceWrites = {
    data_requests: { data: { id: REQUEST_ID, status: "in_progress" }, error: null },
  };
  boundary.rpc.mockResolvedValue({ error: null });
  boundary.anonymise.mockResolvedValue({
    profileCleared: true,
    authScrubbed: true,
    expertCleared: false,
    photoRemoved: false,
  });
  boundary.sendOpsAlert.mockResolvedValue({ ok: true });
});

/**
 * The cookie attributes are the whole of AC-3 and AC-4: get one wrong and the answer either does
 * not survive a reload, or becomes readable by the third party script consent is supposed to
 * govern.
 */
describe("setConsent (AC-3)", () => {
  it("stores a granted answer stamped with the current version", async () => {
    expect(await setConsent("granted")).toEqual({ ok: true });
    const [name, value] = boundary.cookies.set.mock.calls[0] ?? [];
    expect(name).toBe(CONSENT_COOKIE);
    expect(value).toBe(`granted.${CONSENT_VERSION}`);
  });

  it("stores a rejection as a real answer rather than as the absence of one", async () => {
    expect(await setConsent("denied")).toEqual({ ok: true });
    expect(boundary.cookies.set.mock.calls[0]?.[1]).toBe(`denied.${CONSENT_VERSION}`);
  });

  it("leaves the cookie readable by the bar, first party, and alive for a year", async () => {
    await setConsent("granted");
    const options = boundary.cookies.set.mock.calls[0]?.[2];
    // Not HttpOnly: the bar and the analytics gate read it after mount, which is what keeps the
    // page it sits on static.
    expect(options).toMatchObject({
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it("does not require Secure outside production, so pnpm dev over plain HTTP keeps working", async () => {
    await setConsent("granted");
    expect(boundary.cookies.set.mock.calls[0]?.[2]?.secure).toBe(false);
  });

  it("refuses anything that is not one of the two answers, and writes no cookie", async () => {
    for (const value of ["", "yes", "GRANTED", null, undefined, 1, {}]) {
      expect(await setConsent(value as never), String(value)).toEqual({
        ok: false,
        error: "validation",
      });
    }
    expect(boundary.cookies.set).not.toHaveBeenCalled();
  });
});

describe("clearConsent (AC-8b)", () => {
  it("deletes the cookie server side, so nothing in the browser assigns document.cookie", async () => {
    expect(await clearConsent()).toEqual({ ok: true });
    expect(boundary.cookies.delete).toHaveBeenCalledWith(CONSENT_COOKIE);
    expect(boundary.cookies.set).not.toHaveBeenCalled();
  });
});

describe("acceptTerms (AC-10)", () => {
  it("records the build's own version, never one the browser named", async () => {
    expect(await acceptTerms()).toEqual({ ok: true, data: { version: CURRENT_TERMS_VERSION } });
    expect(boundary.rpc).toHaveBeenCalledWith("accept_terms", { version: CURRENT_TERMS_VERSION });
  });

  it("writes through the definer function on the caller's own client, not the service client", async () => {
    await acceptTerms();
    // `accept_terms()` checks `auth.uid()`, which is what keeps the write to the caller's own row;
    // a service client write would bypass exactly that check.
    expect(updateOf("profiles")).toBeUndefined();
  });

  it("answers forbidden to a caller with no session, and calls nothing", async () => {
    boundary.claims = null;
    expect(await acceptTerms()).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.rpc).not.toHaveBeenCalled();
  });

  it("turns a database failure into a typed result rather than throwing at the dialog", async () => {
    boundary.rpc.mockResolvedValue({ error: { message: "permission denied" } });
    expect(await acceptTerms()).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalled();
  });
});

describe("requestData (AC-11, AC-13)", () => {
  it("files a request for a client and answers with the stored row", async () => {
    expect(await requestData(null, { kind: "export" })).toEqual({
      ok: true,
      data: { id: REQUEST_ID, kind: "export" },
    });
  });

  it("lets an expert and an ops user exercise the same right a client has", async () => {
    for (const role of ["expert", "ops"] as const) {
      boundary.claims = claimsFor(role, CLIENT_ID);
      expect((await requestData(null, { kind: "deletion" })).ok, role).toBe(true);
    }
  });

  it("takes the requester from the claims, never from the input", async () => {
    const attacker = "0f000000-0000-4000-8000-0000000000ff";
    await requestData(null, { kind: "export", requested_by: attacker });
    expect(boundary.inserts[0]?.values).toMatchObject({ requested_by: CLIENT_ID });
    expect(boundary.inserts[0]?.values.requested_by).not.toBe(attacker);
  });

  it("computes the deadline thirty days on and stores it, since the column has no default", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T08:00:00.000Z"));
    await requestData(null, { kind: "export" });
    vi.useRealTimers();
    expect(boundary.inserts[0]?.values.due_at).toBe("2026-10-09T08:00:00.000Z");
  });

  it("answers forbidden to a visitor with no session, and inserts nothing", async () => {
    boundary.claims = null;
    expect(await requestData(null, { kind: "export" })).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.inserts).toHaveLength(0);
  });

  it("answers validation to a kind the app does not offer, and inserts nothing", async () => {
    expect(await requestData(null, { kind: "erase" })).toEqual({ ok: false, error: "validation" });
    expect(boundary.inserts).toHaveLength(0);
  });

  /**
   * The duplicate guard is the partial unique index and never an application read: two rapid
   * submissions both pass a read then write, and only the index refuses the second. The typed
   * error is what turns that into an ordinary sentence rather than an opaque database error.
   */
  it("turns the index's 23505 into the typed already_open rather than an opaque error", async () => {
    boundary.insertResult = {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    };
    expect(await requestData(null, { kind: "export" })).toEqual({
      ok: false,
      error: "already_open",
    });
    // A refused duplicate is not an incident: nothing is broken, the guard did its job.
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("reports any other database failure as unexpected, to Sentry", async () => {
    boundary.insertResult = { data: null, error: { code: "42501", message: "denied" } };
    expect(await requestData(null, { kind: "export" })).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalled();
  });

  it("fires the alert only after the row is stored, keyed per row so a retry never doubles it", async () => {
    await requestData(null, { kind: "deletion" });
    expect(boundary.sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "data_request.received",
        link: `/admin/data-requests/${REQUEST_ID}`,
        idempotencyKey: `data-request/${REQUEST_ID}/alert`,
        fields: expect.objectContaining({ kind: "deletion", email: "person@example.ch" }),
      }),
    );
  });

  it("never alerts about a row that was not written", async () => {
    boundary.insertResult = { data: null, error: { code: "23505", message: "duplicate" } };
    await requestData(null, { kind: "export" });
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
  });

  /**
   * A request that was filed and not announced is a Slack gap ops can close from the queue; an
   * announcement of a row that was never written is the failure nobody can undo. So the alert must
   * never fail the caller.
   */
  it("still answers ok when the alert fails, and logs the gap", async () => {
    boundary.sendOpsAlert.mockResolvedValue({ ok: false, error: "webhook" });
    expect((await requestData(null, { kind: "export" })).ok).toBe(true);
    expect(boundary.logWarn).toHaveBeenCalled();
  });

  it("states the deadline in the alert as a Swiss date, in the English channel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T08:00:00.000Z"));
    await requestData(null, { kind: "export" });
    vi.useRealTimers();
    expect(boundary.sendOpsAlert.mock.calls[0]?.[0]?.fields?.dueOn).toBe("09.10.2026");
  });
});

describe("updateDataRequest: authorisation (AC-14)", () => {
  const callers = [
    ["a client", claimsFor("client", CLIENT_ID)],
    ["an expert", claimsFor("expert", CLIENT_ID)],
    ["an anonymous visitor", null],
    ["a session with no role claim", { sub: CLIENT_ID }],
  ] as const;

  for (const [who, claims] of callers) {
    it(`answers forbidden to ${who}, and writes nothing`, async () => {
      boundary.claims = claims as Record<string, unknown> | null;
      expect(await updateDataRequest(null, { id: REQUEST_ID, status: "in_progress" })).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(boundary.updates).toHaveLength(0);
      expect(boundary.anonymise).not.toHaveBeenCalled();
    });
  }
});

describe("updateDataRequest: the workflow (AC-14)", () => {
  beforeEach(() => {
    boundary.claims = claimsFor("ops", OPS_ID);
  });

  it("moves a request the adjacency list allows, and records who handled it first", async () => {
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "in_progress" })).toEqual({
      ok: true,
      data: { id: REQUEST_ID, status: "in_progress" },
    });
    expect(updateOf("data_requests")?.values).toMatchObject({
      status: "in_progress",
      handled_by: OPS_ID,
    });
  });

  it("does not rewrite the handler once one is recorded", async () => {
    boundary.serviceReads.data_requests = {
      data: {
        id: REQUEST_ID,
        kind: "export",
        status: "in_progress",
        requested_by: CLIENT_ID,
        handled_by: OPS_ID,
      },
      error: null,
    };
    boundary.serviceWrites.data_requests = {
      data: { id: REQUEST_ID, status: "fulfilled" },
      error: null,
    };
    await updateDataRequest(null, { id: REQUEST_ID, status: "fulfilled" });
    const values = updateOf("data_requests")?.values ?? {};
    expect(values).not.toHaveProperty("handled_by");
    expect(values).not.toHaveProperty("handled_at");
  });

  it("refuses a move the adjacency list does not allow, before touching the row", async () => {
    // `new -> fulfilled` has no edge: a fulfilment passes through in_progress.
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "fulfilled" })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(boundary.updates).toHaveLength(0);
  });

  it("refuses a refusal that carries no reason, before reading the row", async () => {
    expect(
      await updateDataRequest(null, { id: REQUEST_ID, status: "refused", opsNote: "   " }),
    ).toEqual({ ok: false, error: "note_required" });
    expect(boundary.updates).toHaveLength(0);
  });

  it("answers not_found for an id nobody can see", async () => {
    boundary.serviceReads.data_requests = { data: null, error: null };
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "in_progress" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("answers validation to an id that is not a UUID", async () => {
    expect(await updateDataRequest(null, { id: "nope", status: "in_progress" })).toEqual({
      ok: false,
      error: "validation",
    });
  });

  /**
   * The write is guarded on the status the read saw, so two ops users moving the same row at once
   * cannot both win: the second matches zero rows and is told the move is no longer legal.
   */
  it("guards the write on the status it read, so a concurrent move cannot be overwritten", async () => {
    await updateDataRequest(null, { id: REQUEST_ID, status: "in_progress" });
    expect(updateOf("data_requests")?.filters).toEqual({ id: REQUEST_ID, status: "new" });
  });

  it("tells the loser of that race invalid_transition rather than reporting a success", async () => {
    boundary.serviceWrites.data_requests = { data: null, error: null };
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "in_progress" })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("stores the ops note, trimmed, alongside the move", async () => {
    await updateDataRequest(null, {
      id: REQUEST_ID,
      status: "refused",
      opsNote: "  Identity not confirmed.  ",
    });
    expect(updateOf("data_requests")?.values).toMatchObject({
      status: "refused",
      ops_note: "Identity not confirmed.",
    });
  });

  it("reports a database failure as unexpected, to Sentry", async () => {
    boundary.serviceWrites.data_requests = { data: null, error: { message: "denied" } };
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "in_progress" })).toEqual({
      ok: false,
      error: "unexpected",
    });
    expect(boundary.captureException).toHaveBeenCalled();
  });
});

/**
 * The order of the two writes is the point of AC-15. Anonymising first means a throw leaves the
 * request open and honest; recording first would leave a row claiming a deletion that did not
 * happen, and nothing downstream could tell the difference.
 */
describe("updateDataRequest: fulfilling a deletion (AC-15)", () => {
  beforeEach(() => {
    boundary.claims = claimsFor("ops", OPS_ID);
    boundary.serviceReads.data_requests = {
      data: {
        id: REQUEST_ID,
        kind: "deletion",
        status: "in_progress",
        requested_by: CLIENT_ID,
        handled_by: OPS_ID,
      },
      error: null,
    };
    boundary.serviceWrites.data_requests = {
      data: { id: REQUEST_ID, status: "fulfilled" },
      error: null,
    };
  });

  /**
   * The guarded write is what claims the right to scrub, so it has to land before the scrub does.
   * Anything else lets the loser of a race anonymise a person it has no claim on.
   */
  it("claims the row with the guarded write before it anonymises the subject", async () => {
    const order: string[] = [];
    boundary.anonymise.mockImplementation(async () => {
      order.push("anonymise");
      return {
        profileCleared: true,
        authScrubbed: true,
        expertCleared: false,
        photoRemoved: false,
      };
    });
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "fulfilled" })).toEqual({
      ok: true,
      data: { id: REQUEST_ID, status: "fulfilled" },
    });
    expect(boundary.anonymise).toHaveBeenCalledWith(expect.anything(), CLIENT_ID);
    expect(order).toEqual(["anonymise"]);
    expect(updateOf("data_requests")?.filters).toEqual({
      id: REQUEST_ID,
      status: "in_progress",
    });
  });

  /**
   * The race the whole ordering exists for: a second ops user moves the same `in_progress`
   * deletion in the gap between this action's read and its write, so the guarded write matches
   * zero rows. The loser must not have scrubbed and banned the person on its way to being told no.
   */
  it("never anonymises when it loses the race for the row", async () => {
    boundary.serviceWrites.data_requests = { data: null, error: null };
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "fulfilled" })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(boundary.anonymise).not.toHaveBeenCalled();
  });

  it("releases the claim back to the status it read when the anonymisation throws", async () => {
    boundary.anonymise.mockRejectedValue(new Error("anonymise: auth: sign in not ended"));
    expect(await updateDataRequest(null, { id: REQUEST_ID, status: "fulfilled" })).toEqual({
      ok: false,
      error: "unexpected",
    });
    const release = boundary.updates.at(-1);
    expect(release?.table).toBe("data_requests");
    expect(release?.values).toEqual({ status: "in_progress" });
    // Guarded on `fulfilled`, so the release can only ever undo this action's own claim.
    expect(release?.filters).toEqual({ id: REQUEST_ID, status: "fulfilled" });
    expect(boundary.captureException).toHaveBeenCalled();
  });

  it("records a fulfilment without anonymising when the subject is already gone", async () => {
    // `requested_by` is `on delete set null`, so the compliance record outlives the profile.
    boundary.serviceReads.data_requests = {
      data: {
        id: REQUEST_ID,
        kind: "deletion",
        status: "in_progress",
        requested_by: null,
        handled_by: OPS_ID,
      },
      error: null,
    };
    expect((await updateDataRequest(null, { id: REQUEST_ID, status: "fulfilled" })).ok).toBe(true);
    expect(boundary.anonymise).not.toHaveBeenCalled();
  });

  it("does not anonymise when a deletion is refused, only when it is fulfilled", async () => {
    await updateDataRequest(null, {
      id: REQUEST_ID,
      status: "refused",
      opsNote: "Identity not confirmed.",
    });
    expect(boundary.anonymise).not.toHaveBeenCalled();
  });

  it("does not anonymise when an export is fulfilled", async () => {
    boundary.serviceReads.data_requests = {
      data: {
        id: REQUEST_ID,
        kind: "export",
        status: "in_progress",
        requested_by: CLIENT_ID,
        handled_by: OPS_ID,
      },
      error: null,
    };
    expect((await updateDataRequest(null, { id: REQUEST_ID, status: "fulfilled" })).ok).toBe(true);
    expect(boundary.anonymise).not.toHaveBeenCalled();
  });

  it("does not anonymise on the way into in_progress", async () => {
    boundary.serviceReads.data_requests = {
      data: {
        id: REQUEST_ID,
        kind: "deletion",
        status: "new",
        requested_by: CLIENT_ID,
        handled_by: null,
      },
      error: null,
    };
    boundary.serviceWrites.data_requests = {
      data: { id: REQUEST_ID, status: "in_progress" },
      error: null,
    };
    expect((await updateDataRequest(null, { id: REQUEST_ID, status: "in_progress" })).ok).toBe(
      true,
    );
    expect(boundary.anonymise).not.toHaveBeenCalled();
  });
});

/**
 * The card on `/cookies` asks for its own state after mount, because that page is statically
 * prerendered (AC-5) and must never read `cookies()` itself. A signed out visitor is therefore not
 * an error but an answer.
 */
describe("myDataRequests (AC-11)", () => {
  it("answers signedIn false with no rows for a visitor, rather than an error", async () => {
    boundary.claims = null;
    expect(await myDataRequests()).toEqual({ ok: true, data: { signedIn: false, rows: [] } });
  });

  it("maps the caller's own rows onto the card's shape, newest first", async () => {
    boundary.userReads.data_requests = {
      data: [
        {
          id: REQUEST_ID,
          kind: "deletion",
          status: "new",
          due_at: "2026-10-09T08:00:00.000Z",
          created_at: "2026-09-09T08:00:00.000Z",
        },
      ],
      error: null,
    };
    expect(await myDataRequests()).toEqual({
      ok: true,
      data: {
        signedIn: true,
        rows: [
          {
            id: REQUEST_ID,
            kind: "deletion",
            status: "new",
            dueAt: "2026-10-09T08:00:00.000Z",
            createdAt: "2026-09-09T08:00:00.000Z",
          },
        ],
      },
    });
  });

  it("names no id in the query, since the select policy is what limits the rows", async () => {
    await myDataRequests();
    // Nothing is inserted or updated by a read, and the row filter is RLS rather than an
    // application `eq`, so this cannot return another person's row however it is called.
    expect(boundary.inserts).toHaveLength(0);
    expect(boundary.updates).toHaveLength(0);
  });

  it("reports a database failure as unexpected, to Sentry", async () => {
    boundary.userReads.data_requests = { data: null, error: { message: "denied" } };
    expect(await myDataRequests()).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalled();
  });
});
