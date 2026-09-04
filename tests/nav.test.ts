import { describe, expect, it } from "vitest";
import { AREA_NAV, isNavItemActive } from "@/components/shell/nav";

const [overview, design] = AREA_NAV.admin;
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
