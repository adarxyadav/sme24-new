"use client";

import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { PACKAGES } from "@/features/marketing/packages";
import { EnquiryForm } from "@/features/marketing/ui/enquiry-form";
import { Faq } from "@/features/marketing/ui/faq";
import { PackageCard } from "@/features/marketing/ui/package-card";

/**
 * The marketing primitives (spec 0009, AC-15): a fixed price and the retainer package card, the
 * FAQ accordion, and the enquiry form empty and in its error state, so axe scans every state.
 * Browser; the gallery page hands it the `marketing` messages.
 */
export function MarketingSection() {
  const t = useTranslations("gallery.marketing");
  const compliance = PACKAGES.find((entry) => entry.key === "compliance");
  const retainer = PACKAGES.find((entry) => entry.key === "retainer");

  return (
    <div className="flex flex-col gap-12">
      <Example label={t("packages")}>
        <ul className="grid w-full gap-px border bg-border sm:grid-cols-2">
          {[compliance, retainer].map((entry) =>
            entry ? (
              <li key={entry.key} className="flex">
                <PackageCard entry={entry} />
              </li>
            ) : null,
          )}
        </ul>
      </Example>
      <Example label={t("faq")}>
        <div className="w-full max-w-2xl">
          <Faq
            items={[
              { id: "one", question: t("faqQuestion"), answer: t("faqAnswer") },
              { id: "two", question: t("faqQuestionTwo"), answer: t("faqAnswerTwo") },
            ]}
          />
        </div>
      </Example>
      <div className="grid gap-12 lg:grid-cols-2">
        <Example label={t("formEmpty")}>
          <div className="w-full max-w-2xl">
            <EnquiryForm defaultTopic="general" />
          </div>
        </Example>
        <Example label={t("formInvalid")}>
          <div className="w-full max-w-2xl">
            <EnquiryForm defaultTopic="retainer" validateOnMount />
          </div>
        </Example>
      </div>
    </div>
  );
}
