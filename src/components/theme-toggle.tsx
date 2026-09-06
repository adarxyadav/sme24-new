"use client";

import { MonitorIcon, MoonIcon, SunIcon, SunMoonIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useSyncExternalStore } from "react";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
 * Segmented pill with one icon radio per theme (system, light, dark), the pattern of the Vercel
 * dashboard: a `radiogroup` with roving arrow key focus, each radio named by its label. Nothing is
 * checked until mount so server and client markup match. Used in the marketing header and footer,
 * the auth pages and the gallery. Runs in the browser.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const { mounted, choice, setTheme } = useThemeChoice();

  return (
    <RadioGroupPrimitive.Root
      aria-label={t("toggle")}
      orientation="horizontal"
      value={mounted ? choice : ""}
      onValueChange={(value) => {
        if (isThemeOption(value)) setTheme(value);
      }}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5",
        className,
      )}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = ICONS[option];
        return (
          <RadioGroupPrimitive.Item
            key={option}
            value={option}
            aria-label={t(option)}
            title={t(option)}
            className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=checked]:shadow-xs"
          >
            <Icon aria-hidden="true" className="size-4" />
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
