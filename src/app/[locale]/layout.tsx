import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import "../globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { clientMessages } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";
import { AnalyticsProvider } from "@/lib/analytics/client";
import { clientEnv } from "@/lib/env";

// Geist is the one brand typeface (spec 0003, amendment of 2026-09-04); Helvetica and Arial are its fallback.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  fallback: ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Site title, the localized description (AC-12) and the metadata base for social images; an unknown locale gets the default one. */
export async function generateMetadata({
  params,
}: Pick<LayoutProps<"/[locale]">, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "metadata",
  });
  return {
    // Relative image URLs (the generated social cards, spec 0009 AC-2) resolve against the app URL.
    metadataBase: new URL(clientEnv().NEXT_PUBLIC_APP_URL),
    title: { default: "SME24", template: "%s · SME24" },
    description: t("description"),
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Only the shared namespaces reach the browser (spec 0004, AC-6); a page that needs a feature
  // namespace on the client wraps its children in a nested provider with `clientMessages`.
  const messages = clientMessages(await getMessages());

  // The font variables live on `html` because `font-sans` is applied there (spec 0003).
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      {/* Browser extensions (ColorZilla adds `cz-shortcut-listen`) mutate body attributes before hydration. */}
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            {/*
              `TooltipProvider` and `Toaster` live in `AreaShell`, not here: only the signed in
              areas use them, and in the root layout their ~25 kB gzipped sat on the critical path
              of every static marketing page (spec 0009, Follow-up, first LCP cut).
            */}
            <AnalyticsProvider>{children}</AnalyticsProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
