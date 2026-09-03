import { describe, expect, it } from "vitest";
import { areaFromPathname, roleFromClaims } from "@/lib/auth/roles";

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
