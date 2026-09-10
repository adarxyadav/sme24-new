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
      <section>
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
      {/*
        The facts and the form are the page's one major, which is what the tier map in
        docs/design.md has always said of this band. Until 2026-09-10 it was a bare grid: no
        `section`, no closing hairline and no opener, so the two `text-lg` column headings were
        the only thing between the anchor's lead and a twelve field form. That left the one
        section this page exists for arriving with nothing said about it, and made contact the
        last page still off its own row in the tier map.
      */}
      <section aria-labelledby="reach-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
          <SectionHeader
            tier="major"
            id="reach-heading"
            eyebrow={t("reach.eyebrow")}
            title={t("reach.title")}
            lead={t("reach.lead")}
          />
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
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
              <h3 id="contact-facts-heading" className="font-semibold text-lg">
                {t("facts.heading")}
              </h3>
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
              <h3 id="enquiry-heading" className="font-semibold text-lg">
                {t("form.heading")}
              </h3>
              <NextIntlClientProvider messages={clientMessages(messages, ["marketing"])}>
                <Suspense fallback={<EnquiryForm defaultTopic="general" />}>
                  <EnquiryFormFromQuery />
                </Suspense>
              </NextIntlClientProvider>
            </section>
          </div>
        </div>
      </section>

      <ClosingCta title={t("closing.title")}>
        <Button asChild size="lg">
          <Link href="/sign-up">{t("closing.cta")}</Link>
        </Button>
      </ClosingCta>
    </>
  );
}
