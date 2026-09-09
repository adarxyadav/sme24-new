import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage, LegalProse, LegalSection } from "@/features/legal/ui/legal-page";
import { webPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { SITE } from "@/features/marketing/site";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { absoluteUrl } from "@/i18n/metadata";
import { resolveLocale } from "@/i18n/routing";

/** Title, description, alternates and social fields of the imprint page (spec 0015, AC-6). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/imprint">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("imprint", resolveLocale(locale));
}

/**
 * The imprint (spec 0015, AC-6): the operator, the registered address and a way to reach a
 * person, as Art. 3 UCA requires, entirely from `SITE` so it can never disagree with the contact
 * page. The phone row is omitted while the company has no number, the same rule the contact page
 * follows. Prerendered in both languages.
 */
export default async function ImprintPage({ params }: PageProps<"/[locale]/imprint">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta] = await Promise.all([
    getTranslations("legalPages.imprint"),
    getTranslations("legalPages.imprint.meta"),
  ]);

  return (
    <>
      <JsonLd
        data={webPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/imprint", resolved),
          inLanguage: resolved,
          // The imprint states facts rather than a policy, so its modified date is the day the
          // facts last changed, which is the day the site facts were set.
          dateModified: "2026-09-06",
        })}
      />

      <LegalPage eyebrow={t("eyebrow")} title={t("title")} lead={t("lead")}>
        <LegalSection id="operator" title={t("operator")}>
          <address className="flex flex-col gap-4 text-base not-italic leading-relaxed">
            <span className="flex flex-col">
              <span className="font-semibold">{SITE.legalName}</span>
              <span>{SITE.street}</span>
              <span>
                {SITE.postalCode} {SITE.city}
              </span>
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-muted-foreground text-sm">{t("email")}</span>
              <a href={`mailto:${SITE.email}`} className="w-fit underline underline-offset-4">
                {SITE.email}
              </a>
            </span>
            {SITE.phone ? (
              <span className="flex flex-col gap-1">
                <span className="text-muted-foreground text-sm">{t("phone")}</span>
                <a
                  href={`tel:${SITE.phone.replace(/\s/g, "")}`}
                  className="w-fit underline underline-offset-4"
                >
                  {SITE.phone}
                </a>
              </span>
            ) : null}
            <span className="flex flex-col gap-1">
              <span className="text-muted-foreground text-sm">{t("responsible")}</span>
              <span>{SITE.legalName}</span>
            </span>
          </address>
        </LegalSection>

        <LegalSection id="disclaimer" title={t("disclaimer.title")}>
          <LegalProse>{t("disclaimer.body")}</LegalProse>
        </LegalSection>

        <LegalSection id="copyright" title={t("copyright.title")}>
          <LegalProse>{t("copyright.body", { name: SITE.legalName })}</LegalProse>
        </LegalSection>
      </LegalPage>
    </>
  );
}
