import type { Metadata } from "next";
import { Geist_Mono, Urbanist } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import "../globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";
import { AnalyticsProvider } from "@/lib/analytics/client";

// Urbanist is the one brand typeface (brand guidelines v1.0); Helvetica and Arial are its fallback.
const urbanist = Urbanist({
  variable: "--font-urbanist",
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
      className={`${urbanist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
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
