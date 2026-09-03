import { describe, expect, it } from "vitest";
import { areaFromPathname, organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";

describe("role helpers (AC-5)", () => {
  it("maps localized area paths to the protected area", () => {
    expect(areaFromPathname("/de/app")).toBe("app");
    expect(areaFromPathname("/en/expert/anything")).toBe("expert");
    expect(areaFromPathname("/de/admin/")).toBe("admin");
  });

  it("treats public paths and lookalikes as public", () => {
    expect(areaFromPathname("/de")).toBeNull();
    expect(areaFromPathname("/de/apps")).toBeNull();
    expect(areaFromPathname("/de/sign-in")).toBeNull();
    expect(areaFromPathname("/admin")).toBeNull();
  });

  it("reads the role from app_metadata only", () => {
    expect(roleFromClaims({ app_metadata: { role: "ops" } })).toBe("ops");
    expect(roleFromClaims({ role: "ops" })).toBeNull();
    expect(roleFromClaims({ user_metadata: { role: "ops" } })).toBeNull();
    expect(roleFromClaims({ app_metadata: { role: "superuser" } })).toBeNull();
    expect(roleFromClaims(null)).toBeNull();
  });
});

describe("organizationIdFromClaims (spec 0002, AC-2)", () => {
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("reads the organization id from app_metadata", () => {
    expect(
      organizationIdFromClaims({
        app_metadata: { role: "client", organization_id: organizationId },
      }),
    ).toBe(organizationId);
  });

  it("returns null for a user without an organization (expert, ops, new client)", () => {
    expect(organizationIdFromClaims({ app_metadata: { role: "expert" } })).toBeNull();
    expect(organizationIdFromClaims({ app_metadata: { role: "ops" } })).toBeNull();
    expect(organizationIdFromClaims({ app_metadata: {} })).toBeNull();
  });

  it("ignores the claim outside app_metadata and non uuid values", () => {
    expect(organizationIdFromClaims({ organization_id: organizationId })).toBeNull();
    expect(
      organizationIdFromClaims({ user_metadata: { organization_id: organizationId } }),
    ).toBeNull();
    expect(
      organizationIdFromClaims({ app_metadata: { organization_id: "not-a-uuid" } }),
    ).toBeNull();
    expect(organizationIdFromClaims({ app_metadata: { organization_id: 42 } })).toBeNull();
    expect(organizationIdFromClaims({ app_metadata: { organization_id: "" } })).toBeNull();
    expect(organizationIdFromClaims(null)).toBeNull();
  });

  it("keeps roleFromClaims working next to the new claim", () => {
    expect(
      roleFromClaims({ app_metadata: { role: "client", organization_id: organizationId } }),
    ).toBe("client");
  });
});
