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
};

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

/**
 * The signed in navigation (spec 0003): wordmark, area navigation, user menu with language, theme
 * and sign out. Collapses to icons on desktop (state in shadcn's `sidebar_state` cookie) and
 * becomes a sheet below `md`. Runs in the browser inside `SidebarProvider`.
 */
export function AppSidebar({ area, email, role, locale }: AppSidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const signOutForm = useRef<HTMLFormElement>(null);
  const items = AREA_NAV[area];
  const roleLabel = isAppRole(role) ? t(`shell.role.${role}`) : role;

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
                  <span className="font-extrabold tracking-display">{t("common.appName")}</span>
                  <span className="text-sidebar-muted-foreground text-xs">
                    {t(`areas.${area}.title`)}
                  </span>
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
                const label = t(`nav.${area}.${item.labelKey}`);
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

      <SidebarFooter>
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
                    {initials(email)}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium text-sm">{email}</span>
                    <span className="truncate text-sidebar-muted-foreground text-xs">
                      {roleLabel}
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
                  <span className="truncate font-medium">{email}</span>
                  <span className="font-normal text-muted-foreground text-xs">{roleLabel}</span>
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
