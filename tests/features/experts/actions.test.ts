// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The expert actions (spec 0013, AC-2, AC-3, AC-4, AC-5, AC-9, AC-10): every one authorises the
 * caller in the action rather than trusting the area gate, which never runs for an action post.
 * These are the spec's "Critical test scenarios" for Vitest: a client calling an ops action gets
 * `forbidden`; an expert sending `expertId` to `updateExpertProfile` gets `forbidden`; two
 * simultaneous assigns answer one `ok` and one `already_assigned`; a double onboarding submit
 * answers `ok` twice; and `inviteExpert`'s three failure branches. The action client, the invite
 * module, the mail and alert senders, analytics, the env and Sentry are the boundaries.
 */
type Op = [name: string, args: unknown[]];
type Call = { table: string; ops: Op[] };
type Rpc = { fn: string; args: unknown };
type Answer = { data: unknown; error: null | { code?: string; message: string } };

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  serviceCalls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  answer: (() => ({ data: null, error: null })) as (call: {
    table: string;
    ops: Array<[string, unknown[]]>;
  }) => { data: unknown; error: null | { code?: string; message: string } },
  serviceAnswer: (() => ({ data: null, error: null })) as (call: {
    table: string;
    ops: Array<[string, unknown[]]>;
  }) => { data: unknown; error: null | { code?: string; message: string } },
  rpcAnswer: (() => ({ data: null, error: null })) as (rpc: { fn: string; args: unknown }) => {
    data: unknown;
    error: null | { code?: string; message: string };
  },
  inviteStaffUser: vi.fn(),
  resendStaffInvite: vi.fn(),
  banStaffUser: vi.fn(),
  unbanStaffUser: vi.fn(),
  sendEmail: vi.fn(),
  sendOpsAlert: vi.fn(),
  captureServerEvent: vi.fn(),
  captureException: vi.fn(),
  revalidatePath: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

/** A recording chain: every call pushes an op, awaiting it asks the matching answer function. */
function chainFor(call: Call, answer: (call: Call) => Answer): Record<string | symbol, unknown> {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: Answer) => void) => resolve(answer(call));
        }
        return (...args: unknown[]) => {
          call.ops.push([String(prop), args]);
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      boundary.calls.push(call);
      return chainFor(call, boundary.answer);
    },
    rpc: async (fn: string, args: unknown) => {
      const rpc: Rpc = { fn, args };
      boundary.rpcs.push(rpc);
      return boundary.rpcAnswer(rpc);
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));

vi.mock("@/lib/auth/invite", () => ({
  createInviteClient: () => ({
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      boundary.serviceCalls.push(call);
      return chainFor(call, boundary.serviceAnswer);
    },
  }),
  inviteStaffUser: boundary.inviteStaffUser,
  resendStaffInvite: boundary.resendStaffInvite,
  banStaffUser: boundary.banStaffUser,
  unbanStaffUser: boundary.unbanStaffUser,
}));

vi.mock("@/lib/email/send", () => ({ sendEmail: boundary.sendEmail }));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: boundary.sendOpsAlert }));
vi.mock("@/lib/analytics/server", () => ({ captureServerEvent: boundary.captureServerEvent }));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));
vi.mock("next/cache", () => ({ revalidatePath: boundary.revalidatePath }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en-CH" }));
vi.mock("@/lib/logger", () => ({
  log: { info: boundary.info, warn: boundary.warn, error: boundary.error },
}));

import {
  assignExpert,
  completeExpertOnboarding,
  deactivateExpert,
  endAssignment,
  inviteExpert,
  reactivateExpert,
  resendInvite,
  saveExpertOpsNotes,
  updateExpertProfile,
} from "@/features/experts/actions";

const EXPERT = "e0000000-0000-4000-8000-000000000001";
const OTHER_EXPERT = "e0000000-0000-4000-8000-000000000002";
const OPS = "0b000000-0000-4000-8000-000000000003";
const CLIENT = "0c000000-0000-4000-8000-000000000004";
const ORG = "0a000000-0000-4000-8000-000000000005";
const ASSIGNMENT = "0d000000-0000-4000-8000-000000000006";

const claimsFor = (role: string, sub: string) => ({ sub, app_metadata: { role } });

/** The first op name of a call, which says what the statement does. */
const kind = (call: Call) => call.ops[0]?.[0] ?? "";

beforeEach(() => {
  boundary.claims = claimsFor("ops", OPS);
  boundary.calls = [];
  boundary.rpcs = [];
  boundary.serviceCalls = [];
  boundary.answer = () => ({ data: null, error: null });
  boundary.serviceAnswer = () => ({ data: null, error: null });
  boundary.rpcAnswer = () => ({ data: null, error: null });
  for (const fn of [
    boundary.inviteStaffUser,
    boundary.resendStaffInvite,
    boundary.banStaffUser,
    boundary.unbanStaffUser,
    boundary.sendEmail,
    boundary.sendOpsAlert,
    boundary.captureServerEvent,
    boundary.captureException,
    boundary.revalidatePath,
    boundary.warn,
    boundary.info,
    boundary.error,
  ])
    fn.mockReset();
  boundary.inviteStaffUser.mockResolvedValue({ ok: true, userId: EXPERT, expertId: EXPERT });
  boundary.resendStaffInvite.mockResolvedValue({ ok: true });
  boundary.banStaffUser.mockResolvedValue(true);
  boundary.unbanStaffUser.mockResolvedValue(true);
  boundary.sendEmail.mockResolvedValue({ ok: true });
  boundary.sendOpsAlert.mockResolvedValue({ ok: true });
  boundary.captureServerEvent.mockResolvedValue(true);
});

const validInvite = { email: "new@example.com", fullName: "New Expert", locale: "en" as const };

const validProfile = {
  headline: "Safety lead",
  bio: "",
  competencies: ["compliance"],
  industries: [],
  standards: [],
  languages: ["de"],
  regions: ["ZH"],
  availability: "available",
  availableFrom: "",
  availabilityNote: "",
  yearsExperience: "",
  phone: "",
};

const validOnboarding = {
  termsAccepted: true,
  fullName: "New Expert",
  headline: "Safety lead",
  languages: ["de"],
  regions: ["ZH"],
};

describe("the ops role gate (AC-13)", () => {
  // Every ops-only action, with an input that would otherwise succeed, so the refusal can only
  // come from the gate. A client and an expert both hold a valid session; the proxy never ran.
  const opsOnly: ReadonlyArray<readonly [string, () => Promise<{ ok: boolean }>]> = [
    ["inviteExpert", () => inviteExpert(null, validInvite)],
    ["resendInvite", () => resendInvite(null, { expertId: EXPERT })],
    ["assignExpert", () => assignExpert(null, { expertId: EXPERT, organizationId: ORG })],
    ["endAssignment", () => endAssignment(null, { assignmentId: ASSIGNMENT })],
    ["saveExpertOpsNotes", () => saveExpertOpsNotes(null, { expertId: EXPERT, notes: "ok" })],
    ["deactivateExpert", () => deactivateExpert(null, { expertId: EXPERT })],
    ["reactivateExpert", () => reactivateExpert(null, { expertId: EXPERT })],
  ];

  for (const [name, call] of opsOnly) {
    it(`${name} answers forbidden to a client and touches nothing`, async () => {
      boundary.claims = claimsFor("client", CLIENT);
      expect(await call()).toEqual({ ok: false, error: "forbidden" });
      expect(boundary.calls).toHaveLength(0);
      expect(boundary.rpcs).toHaveLength(0);
      expect(boundary.serviceCalls).toHaveLength(0);
      expect(boundary.revalidatePath).not.toHaveBeenCalled();
    });

    it(`${name} answers forbidden to an expert`, async () => {
      boundary.claims = claimsFor("expert", EXPERT);
      expect(await call()).toEqual({ ok: false, error: "forbidden" });
      expect(boundary.calls).toHaveLength(0);
    });

    it(`${name} answers forbidden when the claims carry no subject`, async () => {
      // The role is right but `sub` is missing, the case the `typeof claims?.sub` check exists for.
      boundary.claims = { app_metadata: { role: "ops" } };
      expect(await call()).toEqual({ ok: false, error: "forbidden" });
      expect(boundary.calls).toHaveLength(0);
    });

    it(`${name} answers forbidden with no session at all`, async () => {
      boundary.claims = null;
      expect(await call()).toEqual({ ok: false, error: "forbidden" });
      expect(boundary.calls).toHaveLength(0);
    });
  }
});

describe("the expert role gate (AC-4, AC-5)", () => {
  it("completeExpertOnboarding answers forbidden to ops and to a client", async () => {
    for (const claims of [claimsFor("ops", OPS), claimsFor("client", CLIENT), null]) {
      boundary.claims = claims;
      expect(await completeExpertOnboarding(null, validOnboarding)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(boundary.calls).toHaveLength(0);
      expect(boundary.rpcs).toHaveLength(0);
    }
  });

  it("completeExpertOnboarding refuses an inactive expert, who must not onboard their way back in", async () => {
    boundary.claims = claimsFor("expert", EXPERT);
    boundary.answer = () => ({ data: { status: "inactive" }, error: null });
    expect(await completeExpertOnboarding(null, validOnboarding)).toEqual({
      ok: false,
      error: "forbidden",
    });
    // The status was read, and nothing was written after it.
    expect(boundary.calls.map(kind)).toEqual(["select"]);
    expect(boundary.rpcs).toHaveLength(0);
  });

  it("updateExpertProfile answers forbidden to a client", async () => {
    boundary.claims = claimsFor("client", CLIENT);
    expect(await updateExpertProfile(null, validProfile)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(boundary.calls).toHaveLength(0);
  });

  it("updateExpertProfile refuses an expert who sends an expertId rather than writing their own row (AC-13)", async () => {
    boundary.claims = claimsFor("expert", EXPERT);
    boundary.answer = () => ({ data: { expert_id: EXPERT, updated_at: "t" }, error: null });
    expect(await updateExpertProfile(null, { ...validProfile, expertId: OTHER_EXPERT })).toEqual({
      ok: false,
      error: "forbidden",
    });
    // Refused before the update: an expert aiming at another row must not write anything at all.
    expect(boundary.calls).toHaveLength(0);
  });

  it("updateExpertProfile writes the caller's own row when no expertId is sent", async () => {
    boundary.claims = claimsFor("expert", EXPERT);
    boundary.answer = () => ({ data: { expert_id: EXPERT, updated_at: "t" }, error: null });
    const result = await updateExpertProfile(null, validProfile);
    expect(result).toEqual({ ok: true, data: { expertId: EXPERT, updatedAt: "t" } });
    expect(boundary.calls[0]?.ops).toContainEqual(["eq", ["expert_id", EXPERT]]);
  });

  it("updateExpertProfile lets ops write another expert's row", async () => {
    boundary.answer = () => ({ data: { expert_id: OTHER_EXPERT, updated_at: "t" }, error: null });
    const result = await updateExpertProfile(null, { ...validProfile, expertId: OTHER_EXPERT });
    expect(result).toEqual({ ok: true, data: { expertId: OTHER_EXPERT, updatedAt: "t" } });
    expect(boundary.calls[0]?.ops).toContainEqual(["eq", ["expert_id", OTHER_EXPERT]]);
  });

  it("updateExpertProfile answers forbidden when RLS hides the row rather than raising", async () => {
    boundary.claims = claimsFor("expert", EXPERT);
    boundary.answer = () => ({ data: null, error: null });
    expect(await updateExpertProfile(null, validProfile)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("inviteExpert (AC-2)", () => {
  it("fixes the role to expert and never takes it from the input", async () => {
    const result = await inviteExpert(null, { ...validInvite, role: "ops" });
    expect(result).toEqual({ ok: true, data: { expertId: EXPERT } });
    expect(boundary.inviteStaffUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: "new@example.com",
        role: "expert",
        locale: "en",
        fullName: "New Expert",
        invitedBy: OPS,
      }),
    );
  });

  it("answers already_invited without reporting it as a failure", async () => {
    boundary.inviteStaffUser.mockResolvedValue({
      ok: false,
      error: "already_invited",
      message: "already invited",
    });
    expect(await inviteExpert(null, validInvite)).toEqual({ ok: false, error: "already_invited" });
    expect(boundary.captureException).not.toHaveBeenCalled();
    expect(boundary.revalidatePath).not.toHaveBeenCalled();
  });

  it("answers email_taken without reporting it as a failure", async () => {
    boundary.inviteStaffUser.mockResolvedValue({
      ok: false,
      error: "email_taken",
      message: "email exists",
    });
    expect(await inviteExpert(null, validInvite)).toEqual({ ok: false, error: "email_taken" });
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("answers invite_failed and reports it when the send itself failed", async () => {
    boundary.inviteStaffUser.mockResolvedValue({
      ok: false,
      error: "invite_failed",
      message: "smtp down",
    });
    expect(await inviteExpert(null, validInvite)).toEqual({ ok: false, error: "invite_failed" });
    expect(boundary.captureException).toHaveBeenCalledOnce();
  });

  it("answers validation on a malformed address and never calls the invite path", async () => {
    expect(await inviteExpert(null, { ...validInvite, email: "not-an-address" })).toEqual({
      ok: false,
      error: "validation",
    });
    expect(boundary.inviteStaffUser).not.toHaveBeenCalled();
  });
});

describe("resendInvite (AC-3)", () => {
  const invitedRow = (locale: string | null) => ({
    data: { email: "new@example.com", status: "invited", profiles: locale ? { locale } : null },
    error: null,
  });

  it("sends in the invitee's stored language and refreshes invited_at", async () => {
    boundary.serviceAnswer = (call) =>
      kind(call) === "select" ? invitedRow("de") : { data: null, error: null };
    const result = await resendInvite(null, { expertId: EXPERT });
    expect(result.ok).toBe(true);
    expect(boundary.resendStaffInvite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "new@example.com", locale: "de" }),
    );
    expect(boundary.serviceCalls.map(kind)).toEqual(["select", "update"]);
  });

  it("refuses an expert who has already signed in", async () => {
    boundary.serviceAnswer = () => ({
      data: { email: "e@example.com", status: "active", profiles: { locale: "en" } },
      error: null,
    });
    expect(await resendInvite(null, { expertId: EXPERT })).toEqual({
      ok: false,
      error: "not_invited",
    });
    expect(boundary.resendStaffInvite).not.toHaveBeenCalled();
  });

  it("logs the fallback when the invitee's locale could not be read", async () => {
    boundary.serviceAnswer = (call) =>
      kind(call) === "select" ? invitedRow(null) : { data: null, error: null };
    await resendInvite(null, { expertId: EXPERT });
    expect(boundary.resendStaffInvite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locale: "en" }),
    );
    expect(boundary.info).toHaveBeenCalledWith(
      "expert invite locale fell back to en",
      expect.objectContaining({ expertId: EXPERT }),
    );
  });

  it("answers rate_limited without reporting it", async () => {
    boundary.serviceAnswer = (call) =>
      kind(call) === "select" ? invitedRow("en") : { data: null, error: null };
    boundary.resendStaffInvite.mockResolvedValue({ ok: false, error: "rate_limited" });
    expect(await resendInvite(null, { expertId: EXPERT })).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("still answers ok when only the invited_at stamp failed, because the email is already out", async () => {
    boundary.serviceAnswer = (call) =>
      kind(call) === "select"
        ? invitedRow("en")
        : { data: null, error: { message: "update refused" } };
    const result = await resendInvite(null, { expertId: EXPERT });
    expect(result.ok).toBe(true);
    expect(boundary.warn).toHaveBeenCalledWith(
      "expert invited_at not refreshed",
      expect.objectContaining({ expertId: EXPERT }),
    );
  });
});

describe("assignExpert (AC-9)", () => {
  const inserted = { data: { id: ASSIGNMENT }, error: null };

  it("inserts the assignment and stamps the ops caller as assigned_by", async () => {
    boundary.answer = () => inserted;
    boundary.serviceAnswer = () => ({ data: null, error: null });
    const result = await assignExpert(null, { expertId: EXPERT, organizationId: ORG });
    expect(result).toEqual({ ok: true, data: { assignmentId: ASSIGNMENT } });
    expect(boundary.calls[0]?.ops[0]).toEqual([
      "insert",
      [{ expert_id: EXPERT, organization_id: ORG, status: "active", assigned_by: OPS }],
    ]);
  });

  it("answers already_assigned on the unique violation, so the second of two simultaneous assigns loses", async () => {
    // Two callers race the same pair: the database decides, and the loser is told which case it is
    // rather than an unexpected error. One `ok`, one `already_assigned`.
    let first = true;
    boundary.answer = () => {
      if (first) {
        first = false;
        return inserted;
      }
      return { data: null, error: { code: "23505", message: "duplicate key" } };
    };
    const [a, b] = await Promise.all([
      assignExpert(null, { expertId: EXPERT, organizationId: ORG }),
      assignExpert(null, { expertId: EXPERT, organizationId: ORG }),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok && r.error === "already_assigned")).toHaveLength(1);
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("answers not_found on the foreign key violation", async () => {
    boundary.answer = () => ({ data: null, error: { code: "23503", message: "missing org" } });
    expect(await assignExpert(null, { expertId: EXPERT, organizationId: ORG })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("answers expert_not_active when the trigger raised during a racing deactivation", async () => {
    boundary.answer = () => ({
      data: null,
      error: { code: "23514", message: "expert_not_active: expert is inactive" },
    });
    expect(await assignExpert(null, { expertId: EXPERT, organizationId: ORG })).toEqual({
      ok: false,
      error: "expert_not_active",
    });
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("reports an unexpected check violation that is not the trigger's", async () => {
    boundary.answer = () => ({
      data: null,
      error: { code: "23514", message: "some other constraint" },
    });
    expect(await assignExpert(null, { expertId: EXPERT, organizationId: ORG })).toEqual({
      ok: false,
      error: "unexpected",
    });
    expect(boundary.captureException).toHaveBeenCalledOnce();
  });
});

describe("endAssignment (AC-10)", () => {
  it("ends only an assignment that is still active", async () => {
    boundary.answer = () => ({ data: { id: ASSIGNMENT, ended_at: "t" }, error: null });
    const result = await endAssignment(null, { assignmentId: ASSIGNMENT });
    expect(result).toEqual({ ok: true, data: { assignmentId: ASSIGNMENT, endedAt: "t" } });
    expect(boundary.calls[0]?.ops).toContainEqual(["eq", ["status", "active"]]);
  });

  it("answers not_found when the row was already ended", async () => {
    boundary.answer = () => ({ data: null, error: null });
    expect(await endAssignment(null, { assignmentId: ASSIGNMENT })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("completeExpertOnboarding (AC-4)", () => {
  beforeEach(() => {
    boundary.claims = claimsFor("expert", EXPERT);
    boundary.answer = (call) =>
      kind(call) === "select"
        ? { data: { status: "invited" }, error: null }
        : { data: null, error: null };
    boundary.serviceAnswer = () => ({
      data: { email: "e@example.com", competencies: ["compliance"] },
      error: null,
    });
  });

  it("writes consent, the name, the fields and the status in that order", async () => {
    const result = await completeExpertOnboarding(null, validOnboarding);
    expect(result).toEqual({ ok: true, data: { expertId: EXPERT } });
    expect(boundary.rpcs.map((rpc) => rpc.fn)).toEqual(["accept_terms", "set_expert_status"]);
    expect(boundary.rpcs[1]?.args).toEqual({ target: EXPERT, next: "active" });
    expect(boundary.calls.map((call) => call.table)).toEqual([
      "expert_profiles",
      "profiles",
      "expert_profiles",
    ]);
  });

  it("answers ok twice for a double submit and keys the welcome email per expert (AC-14)", async () => {
    // Idempotent by construction: `accept_terms` writes only while the stamp is null and
    // `set_expert_status` treats active → active as a no op, so both submits answer ok and the
    // shared idempotency key is what keeps one welcome email and one alert.
    const [a, b] = await Promise.all([
      completeExpertOnboarding(null, validOnboarding),
      completeExpertOnboarding(null, validOnboarding),
    ]);
    expect(a).toEqual({ ok: true, data: { expertId: EXPERT } });
    expect(b).toEqual({ ok: true, data: { expertId: EXPERT } });
    expect(boundary.sendEmail).toHaveBeenCalledTimes(2);
    for (const call of boundary.sendEmail.mock.calls)
      expect(call[0]).toMatchObject({
        template: "expert_welcome",
        idempotencyKey: `expert-welcome/${EXPERT}`,
      });
    for (const call of boundary.sendOpsAlert.mock.calls)
      expect(call[0]).toMatchObject({
        kind: "expert.onboarded",
        idempotencyKey: `expert-onboarded/${EXPERT}`,
      });
  });

  it("answers validation when consent was not given, and writes nothing", async () => {
    expect(
      await completeExpertOnboarding(null, { ...validOnboarding, termsAccepted: false }),
    ).toEqual({ ok: false, error: "validation" });
    expect(boundary.calls).toHaveLength(0);
    expect(boundary.rpcs).toHaveLength(0);
  });

  it("stops at the consent failure without moving the status", async () => {
    boundary.rpcAnswer = (rpc) =>
      rpc.fn === "accept_terms"
        ? { data: null, error: { message: "consent refused" } }
        : { data: null, error: null };
    expect(await completeExpertOnboarding(null, validOnboarding)).toEqual({
      ok: false,
      error: "unexpected",
    });
    expect(boundary.rpcs.map((rpc) => rpc.fn)).toEqual(["accept_terms"]);
  });
});

describe("deactivateExpert (AC-10)", () => {
  beforeEach(() => {
    boundary.answer = () => ({ data: [{ id: ASSIGNMENT }], error: null });
  });

  it("moves the status first, then sweeps the open assignments, then bans the sign in", async () => {
    // The order is the race guard: once the status is inactive the trigger refuses a new
    // assignment, so nothing can land behind the sweep.
    const result = await deactivateExpert(null, { expertId: EXPERT });
    expect(result).toEqual({ ok: true, data: { expertId: EXPERT, endedAssignments: 1 } });
    expect(boundary.rpcs[0]).toEqual({
      fn: "set_expert_status",
      args: { target: EXPERT, next: "inactive" },
    });
    expect(boundary.calls[0]?.ops).toContainEqual(["eq", ["status", "active"]]);
    expect(boundary.banStaffUser).toHaveBeenCalledWith(expect.anything(), EXPERT);
  });

  it("is idempotent: a rerun on an expert with no open assignments still answers ok", async () => {
    boundary.answer = () => ({ data: [], error: null });
    expect(await deactivateExpert(null, { expertId: EXPERT })).toEqual({
      ok: true,
      data: { expertId: EXPERT, endedAssignments: 0 },
    });
    expect(boundary.banStaffUser).toHaveBeenCalledOnce();
  });

  it("still answers ok when the ban failed, because the status already turns the expert away", async () => {
    boundary.banStaffUser.mockResolvedValue(false);
    const result = await deactivateExpert(null, { expertId: EXPERT });
    expect(result.ok).toBe(true);
    expect(boundary.warn).toHaveBeenCalledWith(
      "expert sign in not banned",
      expect.objectContaining({ expertId: EXPERT }),
    );
  });

  it("answers not_found when the status function found no such expert", async () => {
    boundary.rpcAnswer = () => ({ data: null, error: { message: "not_found: no such expert" } });
    expect(await deactivateExpert(null, { expertId: EXPERT })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(boundary.banStaffUser).not.toHaveBeenCalled();
  });

  it("stops before the ban when the sweep failed, so a rerun finishes it", async () => {
    boundary.answer = () => ({ data: null, error: { message: "sweep refused" } });
    expect(await deactivateExpert(null, { expertId: EXPERT })).toEqual({
      ok: false,
      error: "unexpected",
    });
    expect(boundary.banStaffUser).not.toHaveBeenCalled();
  });
});

describe("reactivateExpert (AC-10)", () => {
  it("returns an onboarded expert to active", async () => {
    boundary.answer = () => ({
      data: { status: "inactive", onboarded_at: "2026-09-01T00:00:00Z" },
      error: null,
    });
    expect(await reactivateExpert(null, { expertId: EXPERT })).toEqual({
      ok: true,
      data: { expertId: EXPERT, status: "active" },
    });
    expect(boundary.rpcs[0]?.args).toEqual({ target: EXPERT, next: "active" });
    expect(boundary.unbanStaffUser).toHaveBeenCalledWith(expect.anything(), EXPERT);
  });

  it("returns an expert who never onboarded to invited, so they meet the onboarding screen again", async () => {
    boundary.answer = () => ({ data: { status: "inactive", onboarded_at: null }, error: null });
    expect(await reactivateExpert(null, { expertId: EXPERT })).toEqual({
      ok: true,
      data: { expertId: EXPERT, status: "invited" },
    });
    expect(boundary.rpcs[0]?.args).toEqual({ target: EXPERT, next: "invited" });
  });

  it("answers already_active for an expert who is not deactivated", async () => {
    boundary.answer = () => ({ data: { status: "active", onboarded_at: "t" }, error: null });
    expect(await reactivateExpert(null, { expertId: EXPERT })).toEqual({
      ok: false,
      error: "already_active",
    });
    expect(boundary.rpcs).toHaveLength(0);
  });

  it("answers not_found for an expert who does not exist", async () => {
    boundary.answer = () => ({ data: null, error: null });
    expect(await reactivateExpert(null, { expertId: EXPERT })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("warns when the ban was not lifted, because the row now says they may sign in", async () => {
    boundary.answer = () => ({ data: { status: "inactive", onboarded_at: "t" }, error: null });
    boundary.unbanStaffUser.mockResolvedValue(false);
    const result = await reactivateExpert(null, { expertId: EXPERT });
    expect(result.ok).toBe(true);
    expect(boundary.warn).toHaveBeenCalledWith(
      "expert ban not lifted",
      expect.objectContaining({ expertId: EXPERT }),
    );
  });
});

describe("saveExpertOpsNotes (AC-8)", () => {
  it("upserts one row per expert and stamps the ops caller", async () => {
    const result = await saveExpertOpsNotes(null, { expertId: EXPERT, notes: "checked" });
    expect(result).toEqual({ ok: true, data: { expertId: EXPERT } });
    expect(boundary.calls[0]?.ops[0]).toEqual([
      "upsert",
      [{ expert_id: EXPERT, notes: "checked", updated_by: OPS }, { onConflict: "expert_id" }],
    ]);
  });

  it("treats an empty note as a real value, the way ops clear one", async () => {
    await saveExpertOpsNotes(null, { expertId: EXPERT, notes: "" });
    expect(boundary.calls[0]?.ops[0]?.[1][0]).toMatchObject({ notes: "" });
  });
});
