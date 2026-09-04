import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Placeholder landing content on the display scale. Feature 13 replaces it with the real site. */
export function Hero() {
  const t = useTranslations("landing");

  return (
    <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6 md:py-28">
      <h1 className="max-w-3xl font-semibold text-display-sm md:text-display">{t("title")}</h1>
      <p className="max-w-prose text-lg text-muted-foreground">{t("lead")}</p>
      <Button asChild size="lg">
        <Link href="/sign-in">{t("signInCta")}</Link>
      </Button>
    </section>
  );
}
