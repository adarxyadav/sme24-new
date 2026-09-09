import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { collectionPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import {
  cantonCounts,
  capacityCounts,
  completedIn,
  EXTRACTED_ON,
  REGISTER,
  REGISTER_SOURCE,
} from "@/features/marketing/register";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { RegisterDirectory } from "@/features/marketing/ui/register-directory";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import { clientMessages } from "@/i18n/client-messages";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** Title, description, alternates and social fields of the directory page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/expert-network/directory">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("directory", resolveLocale(locale));
}

/**
 * The expert directory (spec 0009 follow-up): the public SGAS register of occupational safety
 * specialists as proof of the pool behind the network, opened by the counts, then the coverage
 * per canton, then the searchable register itself. The register ships in the prerendered HTML,
 * so the page stays static in both languages and the filtering runs in the browser with no
 * request. It lists no contact details by design: matching is ours to do, and the register's
 * addresses and phone numbers are not ours to republish. `CollectionPage` structured data.
 */
export default async function DirectoryPage({
  params,
}: PageProps<"/[locale]/expert-network/directory">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta, format, messages] = await Promise.all([
    getTranslations("marketing.directory"),
    getTranslations("marketing.directory.meta"),
    getFormatter({ locale: resolved }),
    getMessages(),
  ]);

  const cantons = cantonCounts();
  const capacities = capacityCounts();
  const figures = [
    { key: "total", value: REGISTER.length },
    { key: "available", value: capacities.v },
    { key: "cantons", value: cantons.length },
    { key: "trained", value: completedIn(6) },
  ] as const;

  return (
    <>
      <JsonLd
        data={collectionPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/expert-network/directory", resolved),
          inLanguage: resolved,
        })}
      />

      <section className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-24 sm:px-6 md:py-40">
          <SectionHeader
            tier="anchor"
            as="h1"
            eyebrow={t("eyebrow")}
            title={t("title")}
            lead={t("lead")}
          />
          {/*
            The figures are a ledger rather than four cards: a caps label, the number as the
            statement and a note that adds a fact instead of restating it, the same shape the
            landing page uses for its proof points.
          */}
          <dl className="grid divide-y border-t sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
            {figures.map((figure) => (
              <div
                key={figure.key}
                className="grid grid-rows-[auto_auto_auto] gap-3 py-6 lg:row-span-3 lg:grid-rows-subgrid lg:px-6 lg:py-8 lg:first:pl-0 lg:last:pr-0"
              >
                <dt className="eyebrow self-end text-muted-foreground">
                  {t(`figures.${figure.key}.label`)}
                </dt>
                <dd className="font-semibold text-2xl tracking-headline tabular-nums md:text-display-sm">
                  {format.number(figure.value)}
                </dd>
                <dd className="max-w-prose text-muted-foreground text-sm">
                  {t(`figures.${figure.key}.note`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="coverage-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-28">
          <SectionHeader
            tier="major"
            id="coverage-heading"
            eyebrow={t("coverage.eyebrow")}
            title={t("coverage.title")}
            lead={t("coverage.lead")}
          />
          <ul className="grid gap-px border bg-border sm:grid-cols-3 lg:grid-cols-6">
            {cantons.map((entry) => (
              <li
                key={entry.canton}
                className="flex flex-col gap-1 bg-background px-6 py-5 text-center"
              >
                <span className="font-semibold text-xl tracking-headline">{entry.canton}</span>
                <span className="text-muted-foreground text-sm tabular-nums" data-numeric>
                  {format.number(entry.count)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="register-heading" className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-28">
          <SectionHeader
            tier="major"
            id="register-heading"
            eyebrow={t("register.eyebrow")}
            title={t("register.title")}
            lead={t("register.lead")}
          />
          <NextIntlClientProvider messages={clientMessages(messages, ["marketing"])}>
            <RegisterDirectory />
          </NextIntlClientProvider>
          <p className="max-w-prose text-muted-foreground text-sm">
            {t.rich("source", {
              date: format.dateTime(new Date(EXTRACTED_ON), "dateLong"),
              link: (chunks) => (
                <a
                  href={REGISTER_SOURCE}
                  rel="noreferrer"
                  target="_blank"
                  className="underline underline-offset-4"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </section>

      <ClosingCta title={t("closing.title")} lead={t("closing.lead")}>
        <Button asChild size="lg">
          <Link href="/sign-up">{t("closing.cta")}</Link>
        </Button>
      </ClosingCta>
    </>
  );
}
