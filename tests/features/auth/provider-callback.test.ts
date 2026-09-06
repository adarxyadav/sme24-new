// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider sign in landing (spec 0005, AC-5): `signInWithProvider` carries the locale to the
 * callback on its own parameter and passes `next` only when the user asked for one, so an ops or
 * expert user with no `next` lands on the role home instead of `/app` (which the proxy turns into
 * `/forbidden`), while a client's valid `next` still wins. The Supabase action client, the
 * environment and Next's `redirect` are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  signInWithOAuth: vi.fn<(input: { options: { redirectTo: string } }) => Promise<unknown>>(),
  exchangeCodeForSession: vi.fn(),
  user: null as Record<string, unknown> | null,
  claims: null as Record<string, unknown> | null,
  redirect: vi.fn<(url: string) => never>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: vi.fn() }));
vi.mock("@/lib/env", () => ({
  clientEnv: () => ({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    boundary.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      signInWithOAuth: boundary.signInWithOAuth,
      exchangeCodeForSession: boundary.exchangeCodeForSession,
      getUser: async () => ({ data: { user: boundary.user } }),
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
      signOut: vi.fn(),
    },
  }),
}));

const { signInWithProvider } = await import("@/features/auth/actions");
const { GET } = await import("@/app/api/auth/callback/route");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The `redirectTo` the action handed to Supabase, parsed. */
async function callbackUrlFor(input: Record<string, unknown>): Promise<URL> {
  await expect(signInWithProvider(null, input)).rejects.toThrow("NEXT_REDIRECT");
  const call = boundary.signInWithOAuth.mock.calls[0]?.[0];
  if (!call) throw new Error("signInWithOAuth was not called");
  return new URL(call.options.redirectTo);
}

/** Runs the callback with a code and the given query and returns the redirect target's path and query. */
async function landAfterCallback(query: Record<string, string>): Promise<string> {
  const params = new URLSearchParams({ code: "pkce-code", ...query });
  const response = await GET(new NextRequest(`http://localhost:3000/api/auth/callback?${params}`));
  const location = new URL(response.headers.get("location") ?? "");
  return `${location.pathname}${location.search}`;
}

beforeEach(() => {
  boundary.signInWithOAuth.mockResolvedValue({
    data: { url: "https://accounts.google.com/o/oauth2/auth" },
    error: null,
  });
  boundary.exchangeCodeForSession.mockResolvedValue({ error: null });
  boundary.user = { id: USER_ID, email_confirmed_at: "2026-09-06T00:00:00Z", user_metadata: {} };
  boundary.claims = { sub: USER_ID, app_metadata: { role: "ops" } };
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("signInWithProvider callback URL (AC-5)", () => {
  it("carries the locale on its own parameter and no next when none was requested", async () => {
    const url = await callbackUrlFor({ provider: "google", locale: "de-CH" });
    expect(url.pathname).toBe("/api/auth/callback");
    expect(url.searchParams.get("locale")).toBe("de");
    expect(url.searchParams.has("next")).toBe(false);
  });

  it("passes a valid next inside the locale prefix along with the locale", async () => {
    const url = await callbackUrlFor({
      provider: "azure",
      locale: "en-CH",
      next: "/en/app/companies",
    });
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("next")).toBe("/en/app/companies");
  });

  it("drops a next outside the locale prefix", async () => {
    const url = await callbackUrlFor({ provider: "google", locale: "de-CH", next: "/en/app" });
    expect(url.searchParams.get("locale")).toBe("de");
    expect(url.searchParams.has("next")).toBe(false);
  });
});

describe("/api/auth/callback landing (AC-5)", () => {
  it("sends an ops user with no next to the admin home in the requested locale", async () => {
    await expect(landAfterCallback({ locale: "de" })).resolves.toBe("/de/admin");
  });

  it("sends an expert with no next to the expert home", async () => {
    boundary.claims = { sub: USER_ID, app_metadata: { role: "expert" } };
    await expect(landAfterCallback({ locale: "en" })).resolves.toBe("/en/expert");
  });

  it("honors a valid next for a client with an organization", async () => {
    boundary.claims = { sub: USER_ID, app_metadata: { role: "client", organization_id: ORG_ID } };
    await expect(landAfterCallback({ locale: "en", next: "/en/app/companies" })).resolves.toBe(
      "/en/app/companies",
    );
  });

  it("sends a client with an organization and no next to /app", async () => {
    boundary.claims = { sub: USER_ID, app_metadata: { role: "client", organization_id: ORG_ID } };
    await expect(landAfterCallback({ locale: "de" })).resolves.toBe("/de/app");
  });

  it("reads the locale for an error redirect from the locale parameter", async () => {
    boundary.exchangeCodeForSession.mockResolvedValue({
      error: { code: "bad_code", message: "x" },
    });
    await expect(landAfterCallback({ locale: "de" })).resolves.toBe("/de/sign-in?error=provider");
  });

  it("falls back to the default locale when the parameter is missing or unknown", async () => {
    await expect(landAfterCallback({})).resolves.toBe("/en/admin");
    await expect(landAfterCallback({ locale: "fr" })).resolves.toBe("/en/admin");
  });
});
