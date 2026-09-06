"use client";

import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
import { Link, usePathname } from "@/i18n/navigation";
import type { Pathname, StaticPathname } from "@/i18n/pathnames";
import { cn } from "@/lib/utils";

export type MarketingLink = { readonly href: StaticPathname; readonly label: string };

/**
 * Routes whose first section forces the jet ground in both themes. Only the landing hero does
 * (`src/app/[locale]/(marketing)/page.tsx`); the other three open on the page background, so the
 * transparent bar already matches them and must not invert. A page that gains or loses a dark
 * hero belongs in this list.
 */
const DARK_HERO_ROUTES: readonly Pathname[] = ["/"];

/** True once the page has scrolled past the header, so the bar can take its hairline (browser). */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const read = () => setScrolled(window.scrollY > 8);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  return scrolled;
}

/**
 * Public site header (spec 0003; spec 0009, AC-7): wordmark, navigation links with
 * `aria-current="page"` on the active one, the language switch and sign in. The bar sticks to the
 * top and is fully transparent until the page scrolls, so whatever the page opens with shows
 * through it in both themes and there is no seam; past 8px it takes a hairline and a frosted
 * ground (`bg-background/85` plus a backdrop blur). On a page that opens with the jet hero
 * (`DARK_HERO_ROUTES`), the unscrolled bar also carries `dark`, so the lockup, the links and the
 * controls invert and read on that ground in light mode too. The theme control lives in the
 * footer on desktop, and in the sheet below `md` where the links also collapse. Runs in the
 * browser; the marketing layout passes the links.
 */
export function MarketingHeader({ links }: { links: readonly MarketingLink[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const scrolled = useScrolled();
  const overDarkHero = DARK_HERO_ROUTES.includes(pathname);
  const current = (href: StaticPathname) => (pathname === href ? ("page" as const) : undefined);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors",
        scrolled
          ? "border-border bg-background/85 supports-backdrop-filter:backdrop-blur-md"
          : "border-transparent bg-transparent",
        !scrolled && overDarkHero && "dark text-foreground",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-md">
          <Logo size="md" />
        </Link>

        <nav
          aria-label={t("shell.mainNavigation")}
          className="hidden flex-1 items-center justify-center gap-8 md:flex"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current(link.href)}
              className="font-medium text-muted-foreground text-sm underline-offset-4 transition-colors hover:text-foreground hover:underline aria-[current=page]:text-foreground aria-[current=page]:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-3 md:flex">
          <LocaleSwitcher />
          <Button asChild>
            <Link href="/sign-in">{t("common.signIn")}</Link>
          </Button>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="ml-auto md:hidden"
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
                    aria-current={current(link.href)}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-2 font-medium text-sm hover:bg-muted aria-[current=page]:bg-muted"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            <div className="mt-auto flex flex-col gap-4">
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
