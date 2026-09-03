import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/features/marketing/hero";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Hero />;
}
