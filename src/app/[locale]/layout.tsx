import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import "../globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";
import { AnalyticsProvider } from "@/lib/analytics/client";

// Geist is the one brand typeface (spec 0003, amendment of 2026-09-04); Helvetica and Arial are its fallback.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  fallback: ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SME24", template: "%s · SME24" },
  description: "Fixed-price EHS consulting for regulated companies in Switzerland.",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // The font variables live on `html` because `font-sans` is applied there (spec 0003).
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      {/* Browser extensions (ColorZilla adds `cz-shortcut-listen`) mutate body attributes before hydration. */}
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <NextIntlClientProvider>
          <ThemeProvider>
            <TooltipProvider>
              <AnalyticsProvider>{children}</AnalyticsProvider>
            </TooltipProvider>
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
