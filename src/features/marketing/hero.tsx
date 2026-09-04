import { useTranslations } from "next-intl";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const POINTS = ["price", "negotiation", "kickoff"] as const;

/**
 * Landing content in the campaign voice: an eyebrow, a display statement on the jet black ground,
 * one lead sentence, the call to action and three short proof statements. Feature 13 replaces the
 * copy with the real site; the composition stays. Server component.
 */
export function Hero() {
  const t = useTranslations("landing");

  return (
    <>
      <section className="dark bg-background text-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-24 sm:px-6 md:py-36">
          <p className="eyebrow text-muted-foreground">{t("eyebrow")}</p>
          <Statement
            as="h1"
            text={t("title")}
            className="max-w-4xl text-display-sm md:text-display lg:text-display-lg"
          />
          <p className="max-w-prose text-lg text-muted-foreground">{t("lead")}</p>
          <Button asChild size="lg" className="mt-2">
            <Link href="/sign-in">{t("signInCta")}</Link>
          </Button>
        </div>
      </section>

      <section aria-label={t("pointsLabel")} className="border-b">
        <ul className="mx-auto grid max-w-6xl gap-px sm:grid-cols-3 sm:divide-x">
          {POINTS.map((point) => (
            <li key={point} className="flex flex-col gap-3 px-4 py-10 sm:px-6">
              <Statement as="h2" text={t(`points.${point}.title`)} className="text-display-sm" />
              <p className="max-w-prose text-muted-foreground text-sm">
                {t(`points.${point}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
