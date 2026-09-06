import { createFormatterFor } from "@/i18n/standalone";
import type { OrderConfirmedData } from "@/lib/email/schema";
import { EmailLayout, EmailText } from "./layout";
import type { TemplateProps } from "./props";

/**
 * The order confirmation (spec 0011, AC-9): sent once a purchase is settled, by card or by bank
 * transfer, with the invoice number, the order reference and the three amounts broken out so the
 * buyer's bookkeeper can see the MWST. When the invoice PDF failed to render the body says it
 * follows shortly instead of pointing at it (AC-10), so the email still goes out.
 * Every string is a message key of `email.order_confirmed` or `email.layout`.
 */
export function OrderConfirmedEmail({ t, locale, data, href }: TemplateProps<OrderConfirmedData>) {
  const format = createFormatterFor(locale === "de" ? "de-CH" : "en-CH");
  const greeting = data.firstName
    ? t("email.order_confirmed.greeting", { firstName: data.firstName })
    : t("email.order_confirmed.greetingNeutral");
  // The amounts arrive already converted to CHF; a template never divides Rappen.
  const chf = (value: number) => format.number(value, "chf");
  return (
    <EmailLayout
      locale={locale}
      brand={{ name: t("common.appName"), descriptor: t("brand.descriptor") }}
      preview={t("email.order_confirmed.preview")}
      heading={greeting}
      button={{ label: t("email.order_confirmed.button"), href }}
      footer={{
        legal: t("email.layout.footerLegal"),
        address: t("email.layout.footerAddress"),
        replyHint: t("email.layout.replyHint"),
      }}
    >
      <EmailText>{t("email.order_confirmed.intro", { packageName: data.packageName })}</EmailText>
      <EmailText>
        {t("email.order_confirmed.amounts", {
          net: chf(data.netChf),
          vatRate: format.number(data.vatRatePercent / 100, "percent"),
          vat: chf(data.vatChf),
          gross: chf(data.grossChf),
        })}
      </EmailText>
      <EmailText>
        {t("email.order_confirmed.references", {
          invoiceNumber: data.invoiceNumber,
          reference: data.reference,
        })}
      </EmailText>
      <EmailText>
        {data.invoiceAttached
          ? t("email.order_confirmed.invoiceAttached")
          : t("email.order_confirmed.invoiceFollows")}
      </EmailText>
      <EmailText>{t("email.order_confirmed.nextStep")}</EmailText>
    </EmailLayout>
  );
}
