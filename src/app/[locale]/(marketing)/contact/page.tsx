import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Statement } from "@/components/brand/statement";
import { contactPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { SITE } from "@/features/marketing/site";
import { EnquiryForm } from "@/features/marketing/ui/enquiry-form";
import { EnquiryFormFromQuery } from "@/features/marketing/ui/enquiry-form-from-query";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { clientMessages } from "@/i18n/client-messages";
import { absoluteUrl } from "@/i18n/metadata";
import { resolveLocale } from "@/i18n/routing";

/** Title, description, alternates and social fields of the contact page (spec 0009, AC-1, AC-2). */
export async function generateMetadata({
  params,
}: Pick<PageProps<"/[locale]/contact">, "params">): Promise<Metadata> {
  const { locale } = await params;
  return marketingMetadata("contact", resolveLocale(locale));
}

/**
 * The contact page (spec 0009, AC-8): the contact facts with `address` markup, the enquiry form
 * (the topic query parameter is read on the client inside `Suspense`, so the page stays static)
 * and the `ContactPage` structured data. Prerendered in both languages.
 */
export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  setRequestLocale(resolved);
  const [t, meta, messages] = await Promise.all([
    getTranslations("marketing.contact"),
    getTranslations("marketing.contact.meta"),
    getMessages(),
  ]);

  return (
    <>
      <JsonLd
        data={contactPageJsonLd({
          name: meta("title"),
          description: meta("description"),
          url: absoluteUrl("/contact", resolved),
          inLanguage: resolved,
        })}
      />
      <section className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6 md:py-24">
          <p className="eyebrow text-muted-foreground">{t("eyebrow")}</p>
          <Statement
            as="h1"
            text={t("title")}
            className="max-w-4xl text-display-sm md:text-display"
          />
          <p className="max-w-prose text-lg text-muted-foreground">{t("lead")}</p>
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section aria-labelledby="contact-facts-heading" className="flex flex-col gap-4">
          <h2 id="contact-facts-heading" className="font-semibold text-lg">
            {t("facts.heading")}
          </h2>
          <address className="flex flex-col gap-3 text-sm not-italic">
            <span className="flex flex-col">
              <span className="font-medium">{SITE.legalName}</span>
              <span>{SITE.street}</span>
              <span>
                {SITE.postalCode} {SITE.city}
              </span>
            </span>
            <span className="flex flex-col">
              <span className="text-muted-foreground text-xs">{t("facts.email")}</span>
              <a href={`mailto:${SITE.email}`} className="underline underline-offset-4">
                {SITE.email}
              </a>
            </span>
            {SITE.phone ? (
              <span className="flex flex-col">
                <span className="text-muted-foreground text-xs">{t("facts.phone")}</span>
                <a
                  href={`tel:${SITE.phone.replaceAll(" ", "")}`}
                  className="underline underline-offset-4"
                >
                  {SITE.phone}
                </a>
              </span>
            ) : null}
          </address>
        </section>
        <section aria-labelledby="enquiry-heading" className="flex max-w-2xl flex-col gap-6">
          <h2 id="enquiry-heading" className="font-semibold text-lg">
            {t("form.heading")}
          </h2>
          <NextIntlClientProvider messages={clientMessages(messages, ["marketing"])}>
            <Suspense fallback={<EnquiryForm defaultTopic="general" />}>
              <EnquiryFormFromQuery />
            </Suspense>
          </NextIntlClientProvider>
        </section>
      </div>
    </>
  );
}
