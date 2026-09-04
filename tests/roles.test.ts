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

describe("organizationIdFromClaims rejects what the hook never writes (spec 0002, AC-2)", () => {
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("returns null when app_metadata is missing or not an object", () => {
    expect(organizationIdFromClaims({})).toBeNull();
    expect(organizationIdFromClaims({ app_metadata: null })).toBeNull();
    expect(organizationIdFromClaims({ app_metadata: organizationId })).toBeNull();
    expect(organizationIdFromClaims(undefined)).toBeNull();
    expect(organizationIdFromClaims("claims")).toBeNull();
  });

  it("rejects malformed uuids", () => {
    const malformed = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa", // one character short
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaaa", // one character long
      "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa", // no hyphens
      "gggggggg-gggg-4ggg-8ggg-gggggggggggg", // non hex characters
      ` ${organizationId}`, // surrounding whitespace
      `${organizationId}
`,
      `${organizationId}; drop table organizations`,
    ];
    for (const value of malformed) {
      expect(organizationIdFromClaims({ app_metadata: { organization_id: value } })).toBeNull();
    }
  });

  it("returns null for non string values even when they look like ids", () => {
    expect(organizationIdFromClaims({ app_metadata: { organization_id: null } })).toBeNull();
    expect(organizationIdFromClaims({ app_metadata: { organization_id: true } })).toBeNull();
    expect(
      organizationIdFromClaims({ app_metadata: { organization_id: [organizationId] } }),
    ).toBeNull();
    expect(
      organizationIdFromClaims({ app_metadata: { organization_id: { id: organizationId } } }),
    ).toBeNull();
  });

  it("never lets a top level role or organization_id override app_metadata", () => {
    const claims = {
      role: "ops",
      organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      app_metadata: { role: "client", organization_id: organizationId },
    };
    expect(roleFromClaims(claims)).toBe("client");
    expect(organizationIdFromClaims(claims)).toBe(organizationId);
    expect(roleFromClaims({ role: "ops", app_metadata: {} })).toBeNull();
    expect(
      organizationIdFromClaims({
        organization_id: organizationId,
        app_metadata: { role: "client" },
      }),
    ).toBeNull();
  });
});
