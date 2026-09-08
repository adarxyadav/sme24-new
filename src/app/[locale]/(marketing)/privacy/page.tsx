import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PRIVACY_UPDATED } from "@/features/legal/dates";
import { PROCESSORS, RETENTION } from "@/features/legal/processors";
import { LegalPage, LegalProse, LegalSection } from "@/features/legal/ui/legal-page";
import { webPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { postalAddress, SITE } from "@/features/marketing/site";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

const COLLECTED = ["account", "work", "technical"] as const;
const PURPOSES = ["service", "legal", "improve", "consent"] as const;
const RIGHTS = ["access", "correct", "delete", "object", "complain"] as const;

/** Title, description, alternates and social fields of the privacy page (spec 0015, AC-6). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/privacy">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("privacy", resolveLocale(locale));
}

/**
 * The privacy policy (spec 0015, AC-6, AC-7, AC-8, AC-15): who is responsible, what is collected
 * and why, then the processor table from `PROCESSORS` and the retention table from `RETENTION`,
 * the rights, and what a deletion actually does. Both tables are rendered from the typed
 * constants, so the page cannot claim something the code does not do. Prerendered in both
 * languages: nothing here reads `searchParams`, `headers()` or `cookies()`.
 */
export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta, format] = await Promise.all([
    getTranslations("legalPages.privacy"),
    getTranslations("legalPages.privacy.meta"),
    getFormatter({ locale: resolved }),
  ]);
  const updated = format.dateTime(new Date(PRIVACY_UPDATED), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <JsonLd
        data={webPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/privacy", resolved),
          inLanguage: resolved,
          dateModified: PRIVACY_UPDATED,
        })}
      />

      <LegalPage
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={t("lead")}
        meta={<span>{t("updated", { date: updated })}</span>}
      >
        <LegalSection id="controller" title={t("controller.title")}>
          <LegalProse>
            {t("controller.body", {
              name: SITE.legalName,
              address: postalAddress(),
              email: SITE.email,
            })}
          </LegalProse>
          <LegalProse>{t("controller.law")}</LegalProse>
        </LegalSection>

        <LegalSection id="collected" title={t("collected.title")} lead={t("collected.lead")}>
          <dl className="flex flex-col gap-6">
            {COLLECTED.map((item) => (
              <div key={item} className="flex flex-col gap-1.5">
                <dt className="font-semibold">{t(`collected.${item}.title`)}</dt>
                <dd className="max-w-prose text-base leading-relaxed">
                  {t(`collected.${item}.body`)}
                </dd>
              </div>
            ))}
          </dl>
        </LegalSection>

        <LegalSection id="purposes" title={t("purposes.title")} lead={t("purposes.lead")}>
          <dl className="flex flex-col gap-6">
            {PURPOSES.map((item) => (
              <div key={item} className="flex flex-col gap-1.5">
                <dt className="font-semibold">{t(`purposes.${item}.title`)}</dt>
                <dd className="max-w-prose text-base leading-relaxed">
                  {t(`purposes.${item}.body`)}
                </dd>
              </div>
            ))}
          </dl>
        </LegalSection>

        <LegalSection id="processors" title={t("processors.title")} lead={t("processors.lead")}>
          {/* The table is wider than the prose measure on a phone and holds nothing focusable,
              so `scrollLabel` names its scroll box and makes it keyboard reachable. */}
          <Table scrollLabel={t("processors.title")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("processors.columnName")}</TableHead>
                <TableHead>{t("processors.columnPurpose")}</TableHead>
                <TableHead>{t("processors.columnRegion")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PROCESSORS.map((processor) => (
                <TableRow key={processor.id}>
                  <TableCell className="align-top font-medium">{processor.name}</TableCell>
                  <TableCell className="min-w-64 align-top text-muted-foreground">
                    {t(`processors.${processor.id}.purpose`)}
                  </TableCell>
                  <TableCell className="align-top whitespace-nowrap">
                    {t(`processors.regions.${processor.region}`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LegalProse>{t("processors.usNote")}</LegalProse>
        </LegalSection>

        <LegalSection id="retention" title={t("retention.title")} lead={t("retention.lead")}>
          {/* The table is wider than the prose measure on a phone and holds nothing focusable,
              so `scrollLabel` names its scroll box and makes it keyboard reachable. */}
          <Table scrollLabel={t("retention.title")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("retention.columnData")}</TableHead>
                <TableHead>{t("retention.columnPeriod")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RETENTION.map((row) => (
                <TableRow key={row.table}>
                  <TableCell className="min-w-64 align-top">
                    {t(`retention.${row.table}.purpose`)}
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    {t(`retention.kinds.${row.kind}`, { days: row.days ?? 0 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LegalProse>{t("retention.accountingNote")}</LegalProse>
        </LegalSection>

        <LegalSection
          id="rights"
          title={t("rights.title")}
          lead={t("rights.lead", { email: SITE.email })}
        >
          <ul className="flex max-w-prose list-disc flex-col gap-2 pl-5 leading-relaxed">
            {RIGHTS.map((right) => (
              <li key={right}>{t(`rights.${right}`)}</li>
            ))}
          </ul>
        </LegalSection>

        <LegalSection id="deletion" title={t("deletion.title")}>
          <LegalProse>{t("deletion.body")}</LegalProse>
          <LegalProse>{t("deletion.exception")}</LegalProse>
          <LegalProse>{t("deletion.note")}</LegalProse>
        </LegalSection>

        <LegalSection id="cookies" title={t("cookies.title")}>
          <LegalProse>
            {t.rich("cookies.body", {
              link: (chunks) => (
                <Link href="/cookies" className="underline underline-offset-4">
                  {chunks}
                </Link>
              ),
            })}
          </LegalProse>
        </LegalSection>

        <LegalSection id="security" title={t("security.title")}>
          <LegalProse>{t("security.body")}</LegalProse>
        </LegalSection>

        <LegalSection id="changes" title={t("changes.title")}>
          <LegalProse>{t("changes.body")}</LegalProse>
        </LegalSection>
      </LegalPage>
    </>
  );
}
