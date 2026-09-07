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

/**
 * The bar's own height (`h-16` = 4rem), which is also how far a page that pulls its first section
 * up behind the header (`-mt-16`) has to scroll before that section clears the bar.
 */
const HEADER_HEIGHT = 64;

/**
 * How the bar has to paint itself right now: `top` at rest, transparent, so whatever the page
 * opens with shows through and there is no seam; `hero` while a dark first section is scrolling
 * under it (inverted, over its own jet ground); `frosted` once the page proper has arrived.
 */
type BarState = "top" | "hero" | "frosted";

/**
 * The bar's state, driven by how far the dark first section still covers it rather than by a bare
 * scroll offset (browser). A page whose hero is pulled up behind the header keeps the inverted,
 * transparent bar for as long as the jet ground is actually behind it, and takes the frosted
 * ground only once the hero's bottom edge has passed under: a fixed threshold would drop the
 * inversion while the hero was still there, leaving the lockup dark on a translucent bar over
 * black. Pages without such a hero simply switch at the bar's own height.
 */
function useBarState(overDarkHero: boolean): BarState {
  const [state, setState] = useState<BarState>("top");

  useEffect(() => {
    const read = () => {
      // At rest the bar is transparent on every page, so the first section meets it without a
      // seam. This is the only state that paints no ground of its own.
      if (window.scrollY <= HEADER_HEIGHT) {
        setState("top");
        return;
      }
      if (!overDarkHero) {
        setState("frosted");
        return;
      }
      // The hero marks itself with `data-hero` (`RuledField`), so wrapping or reordering the block
      // cannot move this threshold; the first section of `main` is the fallback for a page that
      // has not marked one. While its bottom edge is still below the bar, the jet ground is what
      // the bar sits on and the inversion has to hold.
      const hero = document.querySelector("[data-hero]") ?? document.querySelector("main section");
      const covered = hero ? hero.getBoundingClientRect().bottom > HEADER_HEIGHT : false;
      setState(covered ? "hero" : "frosted");
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read, { passive: true });
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [overDarkHero]);

  return state;
}

/**
 * Public site header (spec 0003; spec 0009, AC-7): wordmark, navigation links with
 * `aria-current="page"` on the active one, the language switch and sign in. The bar sticks to the
 * top and is fully transparent until the page scrolls, so whatever the page opens with shows
 * through it in both themes and there is no seam; once the page proper is under it, it takes a
 * hairline and a frosted ground (`bg-background/85` plus a backdrop blur). On a page that opens
 * with the jet hero (`DARK_HERO_ROUTES`), the bar also carries `dark` for as long as that hero is
 * behind it, so the lockup, the links and the controls invert and read on that ground in light
 * mode too. The swap is driven by the hero's own bottom edge rather than a fixed scroll offset
 * (`useBarState`), because the frosted ground is only 85% opaque: dropping the inversion while
 * the jet hero was still behind the bar left a black lockup washed out over black, with the
 * hero's text showing through the bar. The two halves are not animated, so they always land
 * together. The theme control lives in the footer on desktop, and in the sheet below `md` where
 * the links also collapse. Runs in the browser; the marketing layout passes the links.
 */
export function MarketingHeader({ links }: { links: readonly MarketingLink[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const overDarkHero = DARK_HERO_ROUTES.includes(pathname);
  const state = useBarState(overDarkHero);
  const current = (href: StaticPathname) => (pathname === href ? ("page" as const) : undefined);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b",
        state === "top" && "border-transparent bg-transparent",
        state !== "top" &&
          "border-border bg-background/85 supports-backdrop-filter:backdrop-blur-md",
        // Over the hero the bar keeps the jet ground: `dark` re-resolves `bg-background/85` to the
        // dark token, so the frosting is black-on-black rather than a white veil over the hero.
        (state === "hero" || (state === "top" && overDarkHero)) && "dark text-foreground",
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
