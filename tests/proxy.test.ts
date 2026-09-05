// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request proxy (spec 0001 area gate, spec 0004 AC-13): the sign in and forbidden redirects
 * are built with `getPathname` for the request's language, and the gate holds for every area in
 * both languages. next-intl's middleware and the Supabase proxy client are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  intl: vi.fn<(request: NextRequest) => NextResponse>(),
  getClaims: vi.fn<() => Promise<{ data: { claims: unknown } | null }>>(),
}));

vi.mock("next-intl/middleware", () => ({
  default: () => boundary.intl,
}));
vi.mock("@/lib/supabase/proxy", () => ({
  createProxyClient: () => ({ auth: { getClaims: boundary.getClaims } }),
}));

const { proxy } = await import("@/proxy");

function request(path: string) {
  return new NextRequest(`https://sme24.ch${path}`);
}

function claimsFor(role: string, organizationId?: string) {
  return {
    data: {
      claims: { sub: "user-1", app_metadata: { role, organization_id: organizationId } },
    },
  };
}

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Where the proxy sent the browser: the path plus query of the `location` header, or null. */
function redirectedTo(response: NextResponse) {
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

describe("request proxy (spec 0004, AC-13)", () => {
  beforeEach(() => {
    boundary.intl.mockImplementation(() => NextResponse.next());
    boundary.getClaims.mockResolvedValue({ data: { claims: null } });
  });

  it("returns next-intl's redirect untouched, without asking Supabase for claims", async () => {
    const redirect = NextResponse.redirect("https://sme24.ch/de");
    boundary.intl.mockReturnValue(redirect);
    const response = await proxy(request("/"));
    expect(response).toBe(redirect);
    expect(boundary.getClaims).not.toHaveBeenCalled();
  });

  it("lets public pages through in both languages without a session", async () => {
    for (const path of ["/de", "/en", "/de/sign-in", "/en/forbidden"]) {
      const response = await proxy(request(path));
      expect(redirectedTo(response)).toBeNull();
    }
  });

  it("sends a signed out visitor to the sign in page of the request's language with the full path as next", async () => {
    expect(redirectedTo(await proxy(request("/de/admin")))).toBe("/de/sign-in?next=%2Fde%2Fadmin");
    expect(redirectedTo(await proxy(request("/en/app/companies")))).toBe(
      "/en/sign-in?next=%2Fen%2Fapp%2Fcompanies",
    );
  });

  it("sends the wrong role to the forbidden page of the request's language", async () => {
    boundary.getClaims.mockResolvedValue(claimsFor("client"));
    expect(redirectedTo(await proxy(request("/de/admin")))).toBe("/de/forbidden");
    expect(redirectedTo(await proxy(request("/en/expert")))).toBe("/en/forbidden");
  });

  it("admits the matching role to its area in both languages", async () => {
    for (const [role, area] of [
      ["client", "app"],
      ["expert", "expert"],
      ["ops", "admin"],
    ] as const) {
      boundary.getClaims.mockResolvedValue(claimsFor(role, ORGANIZATION_ID));
      for (const prefix of ["de", "en"]) {
        const response = await proxy(request(`/${prefix}/${area}`));
        expect(redirectedTo(response)).toBeNull();
      }
    }
  });

  it("gates on app_metadata.role only, never on a top level role claim", async () => {
    boundary.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1", role: "ops", app_metadata: { role: "client" } } },
    });
    expect(redirectedTo(await proxy(request("/de/admin")))).toBe("/de/forbidden");
  });

  it("treats a session without a role as forbidden, not as signed out", async () => {
    boundary.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    expect(redirectedTo(await proxy(request("/en/app")))).toBe("/en/forbidden");
  });

  it("keeps the wrong role's refreshed cookies on the forbidden redirect", async () => {
    boundary.intl.mockImplementation(() => {
      const next = NextResponse.next();
      next.cookies.set("sb-token", "rotated");
      return next;
    });
    boundary.getClaims.mockResolvedValue(claimsFor("client", ORGANIZATION_ID));
    const response = await proxy(request("/de/admin"));
    expect(redirectedTo(response)).toBe("/de/forbidden");
    expect(response.cookies.get("sb-token")?.value).toBe("rotated");
  });
});

describe("auth pages and onboarding (spec 0005, AC-8)", () => {
  beforeEach(() => {
    boundary.intl.mockImplementation(() => NextResponse.next());
    boundary.getClaims.mockResolvedValue({ data: { claims: null } });
  });

  it("sends a signed in user from the auth pages to their role home in the request's language", async () => {
    boundary.getClaims.mockResolvedValue(claimsFor("ops"));
    for (const page of ["/sign-in", "/sign-up", "/verify-code", "/forgot-password"]) {
      expect(redirectedTo(await proxy(request(`/de${page}`)))).toBe("/de/admin");
      expect(redirectedTo(await proxy(request(`/en${page}`)))).toBe("/en/admin");
    }
    boundary.getClaims.mockResolvedValue(claimsFor("client", ORGANIZATION_ID));
    expect(redirectedTo(await proxy(request("/en/sign-in?next=%2Fen%2Fapp")))).toBe("/en/app");
  });

  it("leaves the reset password page alone for a signed in session (a recovery link is signed in on purpose)", async () => {
    boundary.getClaims.mockResolvedValue(claimsFor("client", ORGANIZATION_ID));
    expect(redirectedTo(await proxy(request("/de/reset-password")))).toBeNull();
  });

  it("lets a signed out visitor open every auth page", async () => {
    for (const page of [
      "/sign-in",
      "/sign-up",
      "/verify-code",
      "/forgot-password",
      "/reset-password",
    ]) {
      expect(redirectedTo(await proxy(request(`/de${page}`)))).toBeNull();
    }
  });

  it("sends a client without an organization claim from every /app path but onboarding to onboarding", async () => {
    boundary.getClaims.mockResolvedValue(claimsFor("client"));
    expect(redirectedTo(await proxy(request("/de/app")))).toBe("/de/app/onboarding");
    expect(redirectedTo(await proxy(request("/en/app/companies/1")))).toBe("/en/app/onboarding");
    expect(redirectedTo(await proxy(request("/de/app/onboarding")))).toBeNull();
  });

  it("sends a client with an organization claim from onboarding to /app and lets the rest through", async () => {
    boundary.getClaims.mockResolvedValue(claimsFor("client", ORGANIZATION_ID));
    expect(redirectedTo(await proxy(request("/de/app/onboarding")))).toBe("/de/app");
    expect(redirectedTo(await proxy(request("/en/app/onboarding")))).toBe("/en/app");
    expect(redirectedTo(await proxy(request("/de/app")))).toBeNull();
    expect(redirectedTo(await proxy(request("/de/app/companies")))).toBeNull();
  });

  it("never sends staff to onboarding: the rule applies to the client area only", async () => {
    boundary.getClaims.mockResolvedValue(claimsFor("expert"));
    expect(redirectedTo(await proxy(request("/de/expert")))).toBeNull();
    boundary.getClaims.mockResolvedValue(claimsFor("ops"));
    expect(redirectedTo(await proxy(request("/en/admin/design")))).toBeNull();
  });

  it("carries the refreshed cookies onto the onboarding redirect", async () => {
    boundary.intl.mockImplementation(() => {
      const next = NextResponse.next();
      next.cookies.set("sb-token", "rotated");
      return next;
    });
    boundary.getClaims.mockResolvedValue(claimsFor("client"));
    const response = await proxy(request("/de/app"));
    expect(redirectedTo(response)).toBe("/de/app/onboarding");
    expect(response.cookies.get("sb-token")?.value).toBe("rotated");
  });
});
