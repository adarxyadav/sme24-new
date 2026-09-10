import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { contactPageJsonLd } from "@/features/marketing/json-ld";
import { marketingMetadata } from "@/features/marketing/metadata";
import { SITE } from "@/features/marketing/site";
import { ClosingCta } from "@/features/marketing/ui/closing-cta";
import { EnquiryForm } from "@/features/marketing/ui/enquiry-form";
import { EnquiryFormFromQuery } from "@/features/marketing/ui/enquiry-form-from-query";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import { clientMessages } from "@/i18n/client-messages";
import { absoluteUrl } from "@/i18n/metadata";
import { Link } from "@/i18n/navigation";
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
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-40">
          <SectionHeader
            tier="anchor"
            as="h1"
            eyebrow={t("eyebrow")}
            title={t("title")}
            lead={t("lead")}
          />
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/*
          The facts are four short lines against a form ten times their height, so left alone they
          strand a third of the page. `self-start` plus `sticky` keeps them beside the field the
          visitor is filling rather than beside the whitespace under themselves, and the ruled rows
          carry the answer time promise the opener makes, so the column states something on its own.
        */}
        <section
          aria-labelledby="contact-facts-heading"
          className="flex flex-col gap-4 self-start lg:sticky lg:top-28"
        >
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
            <span className="flex flex-col border-t pt-3">
              <span className="text-muted-foreground text-xs">{t("facts.email")}</span>
              <a href={`mailto:${SITE.email}`} className="underline underline-offset-4">
                {SITE.email}
              </a>
            </span>
            {SITE.phone ? (
              <span className="flex flex-col border-t pt-3">
                <span className="text-muted-foreground text-xs">{t("facts.phone")}</span>
                <a
                  href={`tel:${SITE.phone.replaceAll(" ", "")}`}
                  className="underline underline-offset-4"
                >
                  {SITE.phone}
                </a>
              </span>
            ) : null}
            <span className="flex flex-col border-t pt-3">
              <span className="text-muted-foreground text-xs">{t("facts.response")}</span>
              <span>{t("facts.responseValue")}</span>
            </span>
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

      <ClosingCta title={t("closing.title")}>
        <Button asChild size="lg">
          <Link href="/sign-up">{t("closing.cta")}</Link>
        </Button>
      </ClosingCta>
    </>
  );
}
