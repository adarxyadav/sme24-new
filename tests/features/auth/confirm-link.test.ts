// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Emailed link landing (spec 0005, AC-5, AC-13): the destination `requestCode` passes as
 * `emailRedirectTo` is copied by the template into the link's `next`, so it must carry the locale
 * and nothing more. An ops or expert user who opens the link then falls through to the role home
 * instead of `/app` (which the proxy turns into `/forbidden`), while a client still lands on
 * `/app`. The Supabase action client and the environment are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  signInWithOtp:
    vi.fn<(input: { options: { emailRedirectTo: string } }) => Promise<{ error: null }>>(),
  verifyOtp: vi.fn(),
  user: null as Record<string, unknown> | null,
  claims: null as Record<string, unknown> | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: vi.fn() }));
vi.mock("@/lib/env", () => ({
  clientEnv: () => ({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
}));
vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      signInWithOtp: boundary.signInWithOtp,
      verifyOtp: boundary.verifyOtp,
      getUser: async () => ({ data: { user: boundary.user } }),
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
      signOut: vi.fn(),
    },
  }),
}));

const { requestCode } = await import("@/features/auth/actions");
const { GET } = await import("@/app/api/auth/confirm/route");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The `emailRedirectTo` the code request handed to Supabase, which the template copies into `next`. */
async function emailedNextFor(locale: string): Promise<string> {
  const result = await requestCode(null, { purpose: "sign-in", email: "user@example.com", locale });
  expect(result.ok).toBe(true);
  const call = boundary.signInWithOtp.mock.calls[0]?.[0];
  if (!call) throw new Error("signInWithOtp was not called");
  return call.options.emailRedirectTo;
}

/** Opens the emailed link the way the magic link template builds it and returns where it lands. */
async function openLink(next: string): Promise<string> {
  const params = new URLSearchParams({ token_hash: "hash", type: "magiclink", next });
  const response = await GET(new NextRequest(`http://localhost:3000/api/auth/confirm?${params}`));
  const location = new URL(response.headers.get("location") ?? "");
  return `${location.pathname}${location.search}`;
}

beforeEach(() => {
  boundary.signInWithOtp.mockReset();
  boundary.signInWithOtp.mockResolvedValue({ error: null });
  boundary.verifyOtp.mockResolvedValue({ error: null });
  boundary.user = { id: USER_ID, email_confirmed_at: "2026-09-06T00:00:00Z", user_metadata: {} };
  boundary.claims = { sub: USER_ID, app_metadata: { role: "ops" } };
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("the emailed sign in link (AC-5, AC-13)", () => {
  it("carries the locale and no area, so the role decides the landing", async () => {
    await expect(emailedNextFor("de-CH")).resolves.toBe("http://localhost:3000/de");
    boundary.signInWithOtp.mockClear();
    await expect(emailedNextFor("en-CH")).resolves.toBe("http://localhost:3000/en");
  });

  it("lands an ops user on the admin home in the link's locale", async () => {
    await expect(openLink(await emailedNextFor("de-CH"))).resolves.toBe("/de/admin");
  });

  it("lands an expert on the expert home in the link's locale", async () => {
    boundary.claims = { sub: USER_ID, app_metadata: { role: "expert" } };
    await expect(openLink(await emailedNextFor("en-CH"))).resolves.toBe("/en/expert");
  });

  it("lands a client with an organization on /app in the link's locale", async () => {
    boundary.claims = { sub: USER_ID, app_metadata: { role: "client", organization_id: ORG_ID } };
    await expect(openLink(await emailedNextFor("de-CH"))).resolves.toBe("/de/app");
  });

  it("sends a client without an organization to onboarding in the link's locale", async () => {
    boundary.claims = { sub: USER_ID, app_metadata: { role: "client" } };
    await expect(openLink(await emailedNextFor("de-CH"))).resolves.toBe("/de/app/onboarding");
  });

  it("keeps the locale of an expired link's error page", async () => {
    boundary.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "x" } });
    await expect(openLink(await emailedNextFor("de-CH"))).resolves.toBe(
      "/de/sign-in?error=link_expired&type=magiclink",
    );
  });
});
