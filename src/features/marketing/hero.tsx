import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Placeholder landing content. Feature 13 replaces it with the real marketing site. */
export function Hero() {
  const t = useTranslations("landing");

  return (
    <section className="mx-auto flex max-w-2xl flex-col items-start gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-lg text-muted-foreground">{t("lead")}</p>
      <Button asChild>
        <Link href="/sign-in">{t("signInCta")}</Link>
      </Button>
    </section>
  );
}
