import { createFormatterFor } from "@/i18n/standalone";
import type { BenchmarkReadyData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The benchmark ready email (spec 0008, AC-7): sent to every member once the company's first
 * snapshot exists. Greets by first name when known, names the company and how many KPIs were
 * compared, states the rounded annual cost and the saving when a cost was computed (the variant
 * without money asks for the headcount instead) and carries one button to the client area.
 * Every string is a message key of `email.benchmark_ready` or `email.layout`.
 */
export function BenchmarkReadyEmail({ t, locale, data, href }: TemplateProps<BenchmarkReadyData>) {
  const format = createFormatterFor(locale === "de" ? "de-CH" : "en-CH");
  const greeting = data.firstName
    ? t("email.benchmark_ready.greeting", { firstName: data.firstName })
    : t("email.benchmark_ready.greetingNeutral");
  const chf = (value: number) => format.number(value, "chfWhole");
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.benchmark_ready.preview")}
      heading={greeting}
      button={{ label: t("email.benchmark_ready.button"), href }}
      footer={{
        legal: t("email.layout.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>
        {t("email.benchmark_ready.intro", {
          companyName: data.companyName,
          kpisCompared: data.kpisCompared,
        })}
      </EmailText>
      {data.costChf !== undefined ? (
        <EmailText>
          {t("email.benchmark_ready.cost", { cost: chf(data.costChf) })}
          {data.savingMedianChf !== undefined
            ? ` ${t("email.benchmark_ready.saving", { saving: chf(data.savingMedianChf) })}`
            : ""}
        </EmailText>
      ) : (
        <EmailText>{t("email.benchmark_ready.noCost")}</EmailText>
      )}
      <EmailText>{t("email.benchmark_ready.nextStep")}</EmailText>
    </EmailLayout>
  );
}
