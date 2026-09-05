// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ensureOrganization` after spec 0006 (AC-1, AC-2, AC-15): a fresh organization returns its id
 * with `created: true` and fires exactly one welcome email and one sign up alert, both keyed on
 * the organization id; `already_member` returns the organization from the refreshed claims (null
 * with a warning when the hook wrote none, the member still gets in) and sends nothing; a failed
 * trigger never fails the sign in. The Supabase action client and the two trigger helpers are the
 * boundaries.
 */
const boundary = vi.hoisted(() => ({
  rpc: vi.fn<() => Promise<{ data: unknown; error: { code: string; message: string } | null }>>(),
  refreshSession: vi.fn<() => Promise<{ error: { message: string } | null }>>(),
  claims: null as Record<string, unknown> | null,
  sendEmail: vi.fn(),
  sendOpsAlert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/send", () => ({ sendEmail: boundary.sendEmail }));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: boundary.sendOpsAlert }));

const { ensureOrganization } = await import("@/features/auth/session");
type Client = Parameters<typeof ensureOrganization>[0];
const supabase = {
  rpc: boundary.rpc,
  auth: {
    refreshSession: boundary.refreshSession,
    getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
  },
} as unknown as Client;

const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  boundary.rpc.mockResolvedValue({ data: ORG_ID, error: null });
  boundary.refreshSession.mockResolvedValue({ error: null });
  boundary.claims = { sub: USER_ID, app_metadata: { role: "client", organization_id: ORG_ID } };
  boundary.sendEmail.mockResolvedValue({ ok: true, runId: "run_email" });
  boundary.sendOpsAlert.mockResolvedValue({ ok: true, runId: "run_alert" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("ensureOrganization (AC-1, AC-2, AC-15)", () => {
  it("creates the organization, refreshes the session and fires the welcome email then the sign up alert", async () => {
    await expect(ensureOrganization(supabase, "Musterfirma AG")).resolves.toEqual({
      ok: true,
      organizationId: ORG_ID,
      created: true,
    });
    expect(boundary.rpc).toHaveBeenCalledWith("create_organization", { name: "Musterfirma AG" });
    expect(boundary.refreshSession).toHaveBeenCalledTimes(1);
    expect(boundary.sendEmail).toHaveBeenCalledWith({
      template: "welcome",
      data: { organizationName: "Musterfirma AG" },
      recipient: { userId: USER_ID },
      sourceEvent: "auth.organization_created",
      organizationId: ORG_ID,
      idempotencyKey: `welcome/${ORG_ID}`,
    });
    expect(boundary.sendOpsAlert).toHaveBeenCalledWith({
      kind: "client.signed_up",
      fields: { organizationName: "Musterfirma AG", userId: USER_ID },
      link: "/admin",
      idempotencyKey: `signup/${ORG_ID}`,
    });
    expect(boundary.sendEmail.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.sendOpsAlert.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("treats already_member as success with the organization from the claims and sends nothing", async () => {
    boundary.rpc.mockResolvedValue({
      data: null,
      error: { code: "SM409", message: "already a member" },
    });
    await expect(ensureOrganization(supabase, "Musterfirma AG")).resolves.toEqual({
      ok: true,
      organizationId: ORG_ID,
      created: false,
    });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
  });

  it("still completes the sign in when both triggers fail, logging each", async () => {
    boundary.sendEmail.mockResolvedValue({ ok: false, error: "trigger_unavailable" });
    boundary.sendOpsAlert.mockResolvedValue({ ok: false, error: "trigger_failed" });
    await expect(ensureOrganization(supabase, "Musterfirma AG")).resolves.toEqual({
      ok: true,
      organizationId: ORG_ID,
      created: true,
    });
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("refuses a non client without refreshing or sending", async () => {
    boundary.rpc.mockResolvedValue({
      data: null,
      error: { code: "SM403", message: "not a client" },
    });
    await expect(ensureOrganization(supabase, "X")).resolves.toEqual({
      ok: false,
      error: "not_a_client",
    });
    expect(boundary.refreshSession).not.toHaveBeenCalled();
    expect(boundary.sendEmail).not.toHaveBeenCalled();
  });

  it("fails on any other database error and on a failed session refresh, sending nothing", async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "dup" } });
    await expect(ensureOrganization(supabase, "X")).resolves.toEqual({
      ok: false,
      error: "failed",
    });

    boundary.rpc.mockResolvedValue({ data: ORG_ID, error: null });
    boundary.refreshSession.mockResolvedValue({ error: { message: "refresh token used" } });
    await expect(ensureOrganization(supabase, "X")).resolves.toEqual({
      ok: false,
      error: "failed",
    });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
  });

  it("fails when the refreshed claims carry no subject", async () => {
    boundary.claims = { app_metadata: { role: "client", organization_id: ORG_ID } };
    await expect(ensureOrganization(supabase, "X")).resolves.toEqual({
      ok: false,
      error: "failed",
    });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
  });

  it("lets an existing member in when the refreshed claims carry no organization, warning once and sending nothing", async () => {
    boundary.claims = { sub: USER_ID, app_metadata: { role: "client" } };
    boundary.rpc.mockResolvedValue({ data: null, error: { code: "SM409", message: "member" } });
    await expect(ensureOrganization(supabase, "X")).resolves.toEqual({
      ok: true,
      organizationId: null,
      created: false,
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(boundary.sendEmail).not.toHaveBeenCalled();
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
  });

  it("fails a fresh organization whose rpc answer carries no id, sending nothing", async () => {
    boundary.rpc.mockResolvedValue({ data: null, error: null });
    await expect(ensureOrganization(supabase, "X")).resolves.toEqual({
      ok: false,
      error: "failed",
    });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
  });
});
