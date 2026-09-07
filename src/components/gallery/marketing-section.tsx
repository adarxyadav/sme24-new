"use client";

import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { PACKAGES } from "@/features/marketing/packages";
import { EnquiryForm } from "@/features/marketing/ui/enquiry-form";
import { Faq } from "@/features/marketing/ui/faq";
import { HeroBenchmark } from "@/features/marketing/ui/hero-benchmark";
import { PackageCard } from "@/features/marketing/ui/package-card";
import { RegisterDirectory } from "@/features/marketing/ui/register-directory";
import { SectionHeader } from "@/features/marketing/ui/section-header";

/**
 * The marketing primitives (spec 0009, AC-15): the section opener at its three tiers, the landing
 * hero's example benchmark, a fixed
 * price and the retainer package card, the FAQ accordion, and the enquiry form empty and in its
 * error state, so axe scans every state.
 * Browser; the gallery page hands it the `marketing` messages.
 */
export function MarketingSection() {
  const t = useTranslations("gallery.marketing");
  const compliance = PACKAGES.find((entry) => entry.key === "compliance");
  const retainer = PACKAGES.find((entry) => entry.key === "retainer");

  return (
    <div className="flex flex-col gap-12">
      <Example label={t("sectionAnchor")}>
        <SectionHeader
          tier="anchor"
          eyebrow={t("sectionEyebrow")}
          title={t("sectionTitle")}
          lead={t("sectionLead")}
        />
      </Example>
      <Example label={t("sectionMajor")}>
        <SectionHeader
          tier="major"
          eyebrow={t("sectionEyebrow")}
          title={t("sectionTitle")}
          lead={t("sectionLead")}
        />
      </Example>
      <Example label={t("sectionMinor")}>
        <SectionHeader tier="minor" title={t("sectionTitle")} lead={t("sectionLead")} />
      </Example>
      <Example label={t("heroBenchmark")}>
        <HeroBenchmark className="w-full" />
      </Example>
      <Example label={t("packages")}>
        <ul className="grid w-full gap-px border bg-border sm:grid-cols-2">
          {[compliance, retainer].map((entry) =>
            entry ? (
              <li key={entry.key} className="flex min-w-0">
                <PackageCard entry={entry} />
              </li>
            ) : null,
          )}
        </ul>
      </Example>
      <Example label={t("registerDirectory")}>
        <RegisterDirectory />
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
