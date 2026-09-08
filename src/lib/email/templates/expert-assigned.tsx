import type { ExpertAssignedData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The expert assigned email (spec 0013, AC-14): sent to every member of the client organization
 * when ops assign an expert to them. Names the expert and, when they have written one, their
 * headline; the headline sentence is dropped rather than left empty, because an expert can be
 * assignable before the profile is full. One button to the client area, where the same card
 * shows. Every string is a message key of `email.expert_assigned` or `email.layout`.
 */
export function ExpertAssignedEmail({ t, locale, data, href }: TemplateProps<ExpertAssignedData>) {
  const greeting = data.firstName
    ? t("email.expert_assigned.greeting", { firstName: data.firstName })
    : t("email.expert_assigned.greetingNeutral");
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.expert_assigned.preview", { expertName: data.expertName })}
      heading={greeting}
      button={{ label: t("email.expert_assigned.button"), href }}
      footer={{
        legal: t("email.layout.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>{t("email.expert_assigned.intro", { expertName: data.expertName })}</EmailText>
      {data.headline ? (
        <EmailText>{t("email.expert_assigned.headline", { headline: data.headline })}</EmailText>
      ) : null}
      <EmailText>{t("email.expert_assigned.nextStep")}</EmailText>
    </EmailLayout>
  );
}
