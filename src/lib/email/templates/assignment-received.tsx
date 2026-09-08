import type { AssignmentReceivedData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The assignment received email (spec 0013, AC-14): sent to the expert when ops assign them a
 * client organization. Names the client and carries one button to that client's read only page,
 * which is where the facts, KPIs and benchmark the expert prepares from live. The organization id
 * never appears in the body: it only shapes the link. Every string is a message key of
 * `email.assignment_received` or `email.layout`.
 */
export function AssignmentReceivedEmail({
  t,
  locale,
  data,
  href,
}: TemplateProps<AssignmentReceivedData>) {
  const greeting = data.firstName
    ? t("email.assignment_received.greeting", { firstName: data.firstName })
    : t("email.assignment_received.greetingNeutral");
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.assignment_received.preview", {
        organizationName: data.organizationName,
      })}
      heading={greeting}
      button={{ label: t("email.assignment_received.button"), href }}
      footer={{
        legal: t("email.layout.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>
        {t("email.assignment_received.intro", { organizationName: data.organizationName })}
      </EmailText>
      <EmailText>{t("email.assignment_received.nextStep")}</EmailText>
    </EmailLayout>
  );
}
