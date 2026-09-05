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

function claimsFor(role: string) {
  return { data: { claims: { sub: "user-1", app_metadata: { role } } } };
}

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
      boundary.getClaims.mockResolvedValue(claimsFor(role));
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
});
