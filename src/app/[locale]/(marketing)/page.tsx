import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/features/marketing/hero";
import { resolveLocale } from "@/i18n/routing";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  return <Hero />;
}
