import type { ExpertWelcomeData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The expert welcome email (spec 0013, AC-14): sent the moment an expert completes onboarding.
 * Greets by first name when known, says what the profile is used for and carries one button to
 * the profile page, so the expert's first move is to finish the fields matching will read. Every
 * string is a message key of `email.expert_welcome` or `email.layout`; the task, the ops preview
 * and the preview server render it.
 */
export function ExpertWelcomeEmail({ t, locale, data, href }: TemplateProps<ExpertWelcomeData>) {
  const greeting = data.firstName
    ? t("email.expert_welcome.greeting", { firstName: data.firstName })
    : t("email.expert_welcome.greetingNeutral");
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.expert_welcome.preview")}
      heading={greeting}
      button={{ label: t("email.expert_welcome.button"), href }}
      footer={{
        legal: t("email.layout.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>{t("email.expert_welcome.intro")}</EmailText>
      <EmailText>{t("email.expert_welcome.nextStep")}</EmailText>
    </EmailLayout>
  );
}
