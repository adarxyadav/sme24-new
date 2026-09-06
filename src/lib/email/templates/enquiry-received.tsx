import type { EnquiryReceivedData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The enquiry acknowledgement (spec 0009, AC-14): sent to the visitor right after the contact
 * form stored their enquiry. Greets by the contact name, names the topic (the retainer or a
 * general question), promises a reply within one working day and carries one button back to the
 * site. Every string is a message key of `email.enquiry_received` or `email.layout`; the task, the
 * ops preview and the preview server render it.
 */
export function EnquiryReceivedEmail({
  t,
  locale,
  data,
  href,
}: TemplateProps<EnquiryReceivedData>) {
  const topic = t(`email.enquiry_received.topics.${data.topic}`);
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.enquiry_received.preview", { topic })}
      heading={t("email.enquiry_received.greeting", { contactName: data.contactName })}
      button={{ label: t("email.enquiry_received.button"), href }}
      footer={{
        legal: t("email.enquiry_received.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>{t("email.enquiry_received.intro", { topic })}</EmailText>
      <EmailText>{t("email.enquiry_received.reply")}</EmailText>
    </EmailLayout>
  );
}
