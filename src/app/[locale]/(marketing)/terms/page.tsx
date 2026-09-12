import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { TERMS_UPDATED } from "@/features/legal/dates";
import { CURRENT_TERMS_VERSION } from "@/features/legal/terms";
import { LegalPage, LegalProse, LegalSection } from "@/features/legal/ui/legal-page";
import { webPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { postalAddress, SITE } from "@/features/marketing/site";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { absoluteUrl } from "@/i18n/metadata";
import { resolveLocale } from "@/i18n/routing";

/**
 * The sections in the order the agreement reads, and the extra paragraph keys each carries beyond
 * `body`. The extras are written as whole keys rather than as a suffix joined to `id`, because a
 * template literal of two unions is their cross product: `${id}.${suffix}` would offer
 * `packages.benchmark`, which no catalogue has, and the whole loop would fail to type.
 */
const SECTIONS = [
  { id: "parties", extra: [] },
  { id: "service", extra: ["service.expert"] },
  { id: "account", extra: ["account.accuracy"] },
  { id: "packages", extra: ["packages.delivery"] },
  // Spec 0018, AC-16: the contact directory sold to the expert accounts, version 2 of the terms.
  {
    id: "purchasedContacts",
    extra: [
      "purchasedContacts.resale",
      "purchasedContacts.extraction",
      "purchasedContacts.objection",
      "purchasedContacts.law",
    ],
  },
  { id: "cancellation", extra: ["cancellation.refund"] },
  { id: "obligations", extra: ["obligations.safety"] },
  { id: "ip", extra: ["ip.aggregate"] },
  { id: "liability", extra: ["liability.benchmark"] },
  { id: "termination", extra: [] },
  { id: "changes", extra: ["changes.current"] },
  { id: "law", extra: [] },
] as const;

/** Title, description, alternates and social fields of the terms page (spec 0015, AC-6). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/terms">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("terms", resolveLocale(locale));
}

/**
 * The terms of use (spec 0015, AC-6): the parties, what we provide, payment, cancellation,
 * liability and the change process the signed in terms gate enforces. The parties and
 * jurisdiction come from `SITE`, so a move of the registered office is one edit. Prerendered in
 * both languages.
 */
export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta, format] = await Promise.all([
    getTranslations("legalPages.terms"),
    getTranslations("legalPages.terms.meta"),
    getFormatter({ locale: resolved }),
  ]);
  const updated = format.dateTime(new Date(TERMS_UPDATED), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const values = {
    name: SITE.legalName,
    address: postalAddress(),
    city: SITE.city,
    email: SITE.email,
    // The same constant the re consent dialog and the sign up form read, so the version this page
    // states is always the version being accepted (spec 0015, AC-10).
    version: CURRENT_TERMS_VERSION,
  };

  return (
    <>
      <JsonLd
        data={webPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/terms", resolved),
          inLanguage: resolved,
          dateModified: TERMS_UPDATED,
        })}
      />

      <LegalPage
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={t("lead")}
        meta={
          <>
            <span>{t("updated", { date: updated })}</span>
            <span>{t("version", { version: CURRENT_TERMS_VERSION })}</span>
          </>
        }
      >
        {SECTIONS.map((section) => (
          <LegalSection key={section.id} id={section.id} title={t(`${section.id}.title`)}>
            <LegalProse>{t(`${section.id}.body`, values)}</LegalProse>
            {section.extra.map((key) => (
              <LegalProse key={key}>{t(key, values)}</LegalProse>
            ))}
          </LegalSection>
        ))}
      </LegalPage>
    </>
  );
}
