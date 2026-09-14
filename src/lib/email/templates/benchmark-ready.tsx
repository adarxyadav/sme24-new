import { createFormatterFor } from "@/i18n/standalone";
import type { BenchmarkReadyData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The benchmark ready email (spec 0008, AC-7; spec 0022, AC-17): sent to every member once the
 * company's first snapshot exists. Greets by first name when known, names the company and how many
 * published peers the research found, states the rounded yearly loss and the saving at the peer
 * median in the snapshot's own currency (the variant without money asks for the figures instead)
 * and carries one button to the client area. Every string is a message key of
 * `email.benchmark_ready` or `email.layout`.
 *
 * The amount is formatted with the snapshot's currency rather than the `chfWhole` format, so a
 * client outside Switzerland is never told its losses in francs. Whole units as before: a modelled
 * figure must not look exact to the rappen.
 */
export function BenchmarkReadyEmail({ t, locale, data, href }: TemplateProps<BenchmarkReadyData>) {
  const format = createFormatterFor(locale === "de" ? "de-CH" : "en-CH");
  const greeting = data.firstName
    ? t("email.benchmark_ready.greeting", { firstName: data.firstName })
    : t("email.benchmark_ready.greetingNeutral");
  const money = (value: number) =>
    format.number(value, {
      style: "currency",
      currency: data.currency,
      maximumFractionDigits: 0,
    });
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
          peersCompared: data.peersCompared,
        })}
      </EmailText>
      {data.lossAmount !== undefined ? (
        <EmailText>
          {t("email.benchmark_ready.loss", { loss: money(data.lossAmount) })}
          {data.savingAtMedian !== undefined
            ? ` ${t("email.benchmark_ready.saving", { saving: money(data.savingAtMedian) })}`
            : ""}
        </EmailText>
      ) : (
        <EmailText>{t("email.benchmark_ready.noLoss")}</EmailText>
      )}
      <EmailText>{t("email.benchmark_ready.nextStep")}</EmailText>
    </EmailLayout>
  );
}
