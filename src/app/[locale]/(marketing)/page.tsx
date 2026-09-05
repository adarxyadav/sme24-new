import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/features/marketing/hero";
import { alternatesMetadata } from "@/i18n/metadata";
import { resolveLocale } from "@/i18n/routing";

/** Canonical and language alternates for the landing page (spec 0004, AC-10); title and description come from the locale layout. */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return alternatesMetadata("/", resolveLocale(locale));
}

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  return <Hero />;
}
