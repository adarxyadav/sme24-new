"use client";

import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";

export type MarketingLink = { readonly href: `/${string}`; readonly label: string };

/**
 * Public site header (spec 0003): wordmark, navigation links, language, theme and sign in. Links
 * collapse into a sheet below `md`. Runs in the browser; the marketing layout passes the links.
 */
export function MarketingHeader({ links }: { links: readonly MarketingLink[] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-md">
          <Logo size="md" />
        </Link>

        <nav aria-label={t("shell.mainNavigation")} className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LocaleSwitcher />
          <ThemeToggle />
          <Button asChild>
            <Link href="/sign-in">{t("common.signIn")}</Link>
          </Button>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              aria-label={t("shell.openMenu")}
            >
              <MenuIcon aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-80 flex-col gap-6 p-6">
            <SheetHeader className="p-0 text-left">
              <SheetTitle>{t("common.appName")}</SheetTitle>
              <SheetDescription>{t("shell.menuDescription")}</SheetDescription>
            </SheetHeader>
            {links.length > 0 ? (
              <nav aria-label={t("shell.mainNavigation")} className="flex flex-col gap-1">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-2 font-medium text-sm hover:bg-muted"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <LocaleSwitcher />
                <ThemeToggle />
              </div>
              <Button asChild className="w-full" size="lg">
                <Link href="/sign-in" onClick={() => setOpen(false)}>
                  {t("common.signIn")}
                </Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
