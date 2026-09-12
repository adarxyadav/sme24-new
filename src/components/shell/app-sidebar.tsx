"use client";

import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { LocaleMenuItems } from "@/components/shell/locale-menu-items";
import { AREA_NAV, isNavItemActive } from "@/components/shell/nav";
import { ThemeSubmenu } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { signOut } from "@/features/auth/actions";
import { Link, usePathname } from "@/i18n/navigation";
import { type Area, isAppRole } from "@/lib/auth/roles";

export type AppSidebarProps = {
  readonly area: Area;
  readonly email: string;
  readonly role: string;
  readonly locale: string;
  /** The signed in client's organization name, null for staff and for a client without one. */
  readonly organizationName?: string | null;
  /** `profiles.full_name`, null when the person has not set one. */
  readonly fullName?: string | null;
};

function initials(source: string): string {
  const trimmed = source.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  // A name gives one letter per word ("Musterfirma AG" reads as MA); an address has no words to
  // take, so its local part gives the first two letters instead.
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word.slice(0, 1))
      .join("")
      .toUpperCase();
  }
  const local = trimmed.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

/**
 * The signed in navigation (spec 0003): wordmark, area navigation, user menu with language, theme
 * and sign out. Collapses to icons on desktop (state in shadcn's `sidebar_state` cookie) and
 * becomes a sheet below `md`. Runs in the browser inside `SidebarProvider`.
 */
export function AppSidebar({
  area,
  email,
  role,
  locale,
  organizationName,
  fullName,
}: AppSidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const signOutForm = useRef<HTMLFormElement>(null);
  const items = AREA_NAV[area];
  // The client sees who they are here: their own company, not the role label every client shares.
  // Expert and ops keep the label, which is what tells the two staff areas apart. Per area through
  // `area`, so the area titles in `areas.*` stay as they are for the other two.
  const isClient = area === "app";
  const company = organizationName?.trim() || null;
  // A client with no organization yet still needs a second line under the wordmark, or the header
  // reflows the moment one is created.
  const areaLabel = isClient ? (company ?? t("shell.noOrganization")) : t(`areas.${area}.title`);
  const roleLabel = isAppRole(role) ? t(`shell.role.${role}`) : role;
  const accountPrimary = isClient ? areaLabel : email;
  const accountSecondary = isClient ? email : roleLabel;
  const menuName = fullName?.trim() || email;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip={t("common.appName")}
              className="group-data-[collapsible=icon]:justify-center"
            >
              <Link href={items[0]?.href ?? "/"}>
                <BrandMark className="h-7 w-8" />
                <span className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
                  {/* 600 like the `Logo` wordmark: the 2026-09-10 weight cap covers the mark too. */}
                  <span className="font-semibold tracking-display">{t("common.appName")}</span>
                  <span className="text-sidebar-muted-foreground text-xs">{areaLabel}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.label")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label={t("nav.label")}>
              {items.map((item) => {
                const active = isNavItemActive(pathname, item);
                const label = t(`nav.${item.labelKey}`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={label}>
                      <Link href={item.href} aria-current={active ? "page" : undefined}>
                        <item.icon aria-hidden="true" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* The cookie bar is fixed to the bottom of the viewport and the sidebar is `h-svh`, so the
          footer reserves the bar's height while it is showing (it publishes `--consent-bar-height`
          and removes it once answered). Without this the user menu sits underneath the bar and
          cannot be clicked. */}
      <SidebarFooter className="pb-[calc(var(--spacing)*2+var(--consent-bar-height,0px))]">
        <form ref={signOutForm} action={signOut} className="hidden">
          <input type="hidden" name="locale" value={locale} />
        </form>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  aria-label={t("shell.userMenu")}
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-semibold text-sidebar-primary-foreground text-xs"
                  >
                    {initials(accountPrimary)}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium text-sm">{accountPrimary}</span>
                    <span className="truncate text-sidebar-muted-foreground text-xs">
                      {accountSecondary}
                    </span>
                  </span>
                  <ChevronsUpDownIcon aria-hidden="true" className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "bottom" : "right"}
                align="end"
                className="min-w-56"
              >
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="truncate font-medium">{menuName}</span>
                  {/* Not truncated and never omitted: this is the one place the whole address is
                      readable, which the truncated trigger above cannot promise. */}
                  <span className="break-all font-normal text-muted-foreground text-xs">
                    {email}
                  </span>
                  {isClient ? null : (
                    <span className="font-normal text-muted-foreground text-xs">{roleLabel}</span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <LocaleMenuItems />
                  <ThemeSubmenu />
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()}>
                    <LogOutIcon aria-hidden="true" />
                    {t("common.signOut")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
