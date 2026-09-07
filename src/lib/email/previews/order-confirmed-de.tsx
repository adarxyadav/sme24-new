import { createTranslatorFor } from "@/i18n/standalone";
import { OrderConfirmedEmail } from "@/lib/email/templates/order-confirmed";

/** `pnpm email:dev` preview (spec 0011, AC-9): the de-CH order confirmation with the invoice attached. */
export default async function OrderConfirmedDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <OrderConfirmedEmail
      t={t}
      locale="de"
      data={{
        firstName: undefined,
        packageName: "Safety Culture Assessment",
        reference: "SME24-2026-0042",
        invoiceNumber: "2026-0042",
        netChf: 2_000,
        vatChf: 162,
        grossChf: 2_162,
        vatRatePercent: 8.1,
        invoiceAttached: true,
      }}
      href="http://localhost:3000/de/app/orders"
    />
  );
}
