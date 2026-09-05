import { LayoutDashboardIcon, type LucideIcon, PaletteIcon } from "lucide-react";
import type { Messages } from "next-intl";
import type { Pathname } from "@/i18n/pathnames";
import type { Area } from "@/lib/auth/roles";

/** A key of the `nav` namespace that names one area entry (`app.overview`, `admin.design`). */
export type NavLabelKey = {
  [A in Area]: `${A}.${Extract<keyof Messages["nav"][A], string>}`;
}[Area];

/** One sidebar entry: the typed route, its `nav.<labelKey>` message and an icon. */
export type NavItem = {
  readonly href: Pathname;
  readonly labelKey: NavLabelKey;
  readonly icon: LucideIcon;
};

/**
 * Sidebar navigation per signed in area (spec 0003). Plain data with component references, no
 * client directive, so both the server shell and the client sidebar can import it. Later features
 * append their entries here.
 */
export const AREA_NAV: Record<Area, readonly NavItem[]> = {
  app: [{ href: "/app", labelKey: "app.overview", icon: LayoutDashboardIcon }],
  expert: [{ href: "/expert", labelKey: "expert.overview", icon: LayoutDashboardIcon }],
  admin: [
    { href: "/admin", labelKey: "admin.overview", icon: LayoutDashboardIcon },
    { href: "/admin/design", labelKey: "admin.design", icon: PaletteIcon },
  ],
};

/**
 * True when `pathname` (without the locale prefix) is the item or a page below it. The area root
 * (`/app`, `/expert`, `/admin`, a single segment) only matches exactly: every page in the area
 * sits below it, so a prefix match would keep "Overview" lit on all of them.
 */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  const isAreaRoot = !item.href.slice(1).includes("/");
  return !isAreaRoot && pathname.startsWith(`${item.href}/`);
}
