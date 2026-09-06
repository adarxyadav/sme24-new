import { describe, expect, it } from "vitest";
import { AREA_NAV, isNavItemActive } from "@/components/shell/nav";

const overview = AREA_NAV.admin.find((item) => item.href === "/admin");
const design = AREA_NAV.admin.find((item) => item.href === "/admin/design");
if (!overview || !design) throw new Error("admin nav needs the overview and design entries");

describe("isNavItemActive", () => {
  it("lights the area root only on the area root itself", () => {
    expect(isNavItemActive("/admin", overview)).toBe(true);
    expect(isNavItemActive("/admin/design", overview)).toBe(false);
    expect(isNavItemActive("/admin/projects/1", overview)).toBe(false);
  });

  it("lights a section on the section and on pages below it", () => {
    expect(isNavItemActive("/admin/design", design)).toBe(true);
    expect(isNavItemActive("/admin/design/tokens", design)).toBe(true);
    expect(isNavItemActive("/admin", design)).toBe(false);
    expect(isNavItemActive("/admin/designer", design)).toBe(false);
  });

  it("never lights an item from another area", () => {
    const [appOverview] = AREA_NAV.app;
    expect(appOverview && isNavItemActive("/admin", appOverview)).toBe(false);
  });
});

describe("the admin emails entry (spec 0006, AC-9)", () => {
  const emails = AREA_NAV.admin.find((item) => item.href === "/admin/emails");

  it("sits between the overview and the enquiries entry with its own label key", () => {
    expect(AREA_NAV.admin.map((item) => item.href)).toEqual([
      "/admin",
      "/admin/emails",
      "/admin/enquiries",
      "/admin/design",
    ]);
    expect(emails?.labelKey).toBe("admin.emails");
  });

  it("lights on the list and on a delivery detail page, not on the overview", () => {
    if (!emails) throw new Error("admin nav needs the emails entry");
    expect(isNavItemActive("/admin/emails", emails)).toBe(true);
    expect(isNavItemActive("/admin/emails/d0000000-0000-4000-8000-000000000001", emails)).toBe(
      true,
    );
    expect(isNavItemActive("/admin", emails)).toBe(false);
    expect(isNavItemActive("/admin/emails", overview)).toBe(false);
  });
});
