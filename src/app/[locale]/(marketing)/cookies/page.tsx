import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConsentControl } from "@/features/legal/ui/consent-control";
import { LegalPage, LegalProse, LegalSection } from "@/features/legal/ui/legal-page";
import { webPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { clientMessages } from "@/i18n/client-messages";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** Every cookie the app sets, in the order a reader meets them. */
const COOKIES = ["consent", "auth", "posthog"] as const;

/** Title, description, alternates and social fields of the cookies page (spec 0015, AC-6). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/cookies">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("cookies", resolveLocale(locale));
}

/**
 * The cookies page (spec 0015, AC-6, AC-8b): the full list of what is set and why, and the
 * consent control that re-opens the choice whatever the current cookie says, so someone who
 * rejected can later accept without clearing their browser.
 *
 * The control is a client component reading the cookie after mount, so the page stays statically
 * prerendered; the page never reads `cookies()` itself. It gets its strings through a nested
 * provider, because the page copy lives outside the shared namespaces on purpose: the legal text
 * is long, and shipping it to every client bundle would cost the first load budget for nothing.
 * Prerendered in both languages.
 */
export default async function CookiesPage({ params }: PageProps<"/[locale]/cookies">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta, messages] = await Promise.all([
    getTranslations("legalPages.cookiesPage"),
    getTranslations("legalPages.cookiesPage.meta"),
    getMessages(),
  ]);

  return (
    <>
      <JsonLd
        data={webPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/cookies", resolved),
          inLanguage: resolved,
          dateModified: "2026-09-09",
        })}
      />

      <LegalPage eyebrow={t("eyebrow")} title={t("title")} lead={t("lead")}>
        <LegalSection id="choice" title={t("choice.title")}>
          <NextIntlClientProvider messages={clientMessages(messages, ["legalPages"])}>
            <ConsentControl />
          </NextIntlClientProvider>
        </LegalSection>

        <LegalSection id="table" title={t("table.title")}>
          {/* The table overflows on a phone and holds nothing focusable, so the scroll
              region needs to be reachable by keyboard itself and needs a name to
              announce (axe `scrollable-region-focusable`, WCAG 2.1.1). */}
          <Table scrollLabel={t("table.title")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.columnName")}</TableHead>
                <TableHead>{t("table.columnPurpose")}</TableHead>
                <TableHead>{t("table.columnLife")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COOKIES.map((cookie) => (
                <TableRow key={cookie}>
                  <TableCell className="align-top font-mono text-sm">
                    {t(`items.${cookie}.name`)}
                  </TableCell>
                  <TableCell className="min-w-64 align-top text-muted-foreground">
                    {t(`items.${cookie}.purpose`)}
                  </TableCell>
                  <TableCell className="align-top whitespace-nowrap">
                    {t(`items.${cookie}.life`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </LegalSection>

        <LegalSection id="necessary" title={t("necessary.title")}>
          <LegalProse>{t("necessary.body")}</LegalProse>
        </LegalSection>

        <LegalSection id="more" title={t("more.title")}>
          <LegalProse>
            {t.rich("more.body", {
              link: (chunks) => (
                <Link href="/privacy" className="underline underline-offset-4">
                  {chunks}
                </Link>
              ),
            })}
          </LegalProse>
        </LegalSection>
      </LegalPage>
    </>
  );
}
