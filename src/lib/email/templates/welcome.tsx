import type { WelcomeData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The welcome email (spec 0006, AC-1): sent when a client's organization is created. Greets by
 * first name when known, names the organization, explains the company lookup as the next step and
 * carries one button to the client area. Every string is a message key of `email.welcome` or
 * `email.layout`; the task, the ops preview and the preview server render it.
 */
export function WelcomeEmail({ t, locale, data, href }: TemplateProps<WelcomeData>) {
  const greeting = data.firstName
    ? t("email.welcome.greeting", { firstName: data.firstName })
    : t("email.welcome.greetingNeutral");
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.welcome.preview", { organizationName: data.organizationName })}
      heading={greeting}
      button={{ label: t("email.welcome.button"), href }}
      footer={{
        legal: t("email.layout.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>{t("email.welcome.intro", { organizationName: data.organizationName })}</EmailText>
      <EmailText>{t("email.welcome.nextStep")}</EmailText>
    </EmailLayout>
  );
}
