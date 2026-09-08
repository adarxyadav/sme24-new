import { createFormatterFor } from "@/i18n/standalone";
import type { AssessmentScheduledData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The assessment scheduled email (spec 0014, AC-9): sent to every member of the client
 * organization when ops book the on site visit. It answers the two questions the client has after
 * paying, when and who, so the date is rendered here rather than carried pre formatted in the
 * data: the same stored payload is rendered once per recipient language, and this is the one place
 * that turns the instant into Swiss local time. Every string is a message key of
 * `email.assessment_scheduled` or `email.layout`.
 */
export function AssessmentScheduledEmail({
  t,
  locale,
  data,
  href,
}: TemplateProps<AssessmentScheduledData>) {
  const format = createFormatterFor(locale === "de" ? "de-CH" : "en-CH");
  const greeting = data.firstName
    ? t("email.assessment_scheduled.greeting", { firstName: data.firstName })
    : t("email.assessment_scheduled.greetingNeutral");
  // The zone is Europe/Zurich in `formats`, so the wall clock time ops agreed is what is read.
  const scheduledAt = format.dateTime(new Date(data.scheduledAt), "dateTime");
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.assessment_scheduled.preview")}
      heading={greeting}
      button={{ label: t("email.assessment_scheduled.button"), href }}
      footer={{
        legal: t("email.layout.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>
        {t("email.assessment_scheduled.intro", { packageName: data.packageName })}
      </EmailText>
      <EmailText>
        {t("email.assessment_scheduled.appointment", {
          scheduledAt,
          expertName: data.expertName,
        })}
      </EmailText>
      <EmailText>{t("email.assessment_scheduled.prepare")}</EmailText>
      <EmailText>{t("email.assessment_scheduled.nextStep")}</EmailText>
    </EmailLayout>
  );
}
