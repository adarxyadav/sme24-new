"use client";

import { MonitorIcon, MoonIcon, SunIcon, SunMoonIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The three preferences a user can pick; `next-themes` stores them in `localStorage.theme`. */
export const THEME_OPTIONS = ["system", "light", "dark"] as const;
export type ThemeOption = (typeof THEME_OPTIONS)[number];

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

const noopSubscribe = () => () => {};

/** True after hydration, false during server render and the first client render (browser). */
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function isThemeOption(value: string | undefined): value is ThemeOption {
  return (THEME_OPTIONS as readonly string[]).includes(value ?? "");
}

/** The current preference and a typed setter, safe to read only after mount (browser). */
function useThemeChoice() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const choice: ThemeOption = mounted && isThemeOption(theme) ? theme : "system";
  return { mounted, choice, setTheme: (next: ThemeOption) => setTheme(next) };
}

/**
 * Radio items for the three themes, meant for a `DropdownMenuRadioGroup` inside another menu
 * (the sidebar user menu). Runs in the browser.
 */
export function ThemeRadioItems() {
  const t = useTranslations("theme");
  const { choice, setTheme } = useThemeChoice();

  return (
    <DropdownMenuRadioGroup
      value={choice}
      onValueChange={(value) => {
        if (isThemeOption(value)) setTheme(value);
      }}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = ICONS[option];
        return (
          <DropdownMenuRadioItem key={option} value={option}>
            <Icon aria-hidden="true" />
            {t(option)}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

/**
 * A theme submenu for a user menu: trigger with the current choice, radio items inside. Runs in
 * the browser inside a `DropdownMenuContent`.
 */
export function ThemeSubmenu() {
  const t = useTranslations("theme");
  const { mounted, choice } = useThemeChoice();
  const Icon = mounted ? ICONS[choice] : SunMoonIcon;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon aria-hidden="true" />
        {t("label")}
        <span className="ml-auto text-muted-foreground text-xs">{mounted ? t(choice) : ""}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ThemeRadioItems />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Icon button that opens the three way theme menu (marketing header, gallery). Shows a neutral
 * icon until mounted so server and client markup match. Runs in the browser.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const { mounted, choice } = useThemeChoice();
  const Icon = mounted ? ICONS[choice] : SunMoonIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("toggle")} className={className}>
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <ThemeRadioItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
