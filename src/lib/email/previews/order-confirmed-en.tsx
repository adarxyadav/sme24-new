import { createTranslatorFor } from "@/i18n/standalone";
import { OrderConfirmedEmail } from "@/lib/email/templates/order-confirmed";

/** `pnpm email:dev` preview (spec 0011, AC-9): the en-CH order confirmation with the invoice attached. */
export default async function OrderConfirmedEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <OrderConfirmedEmail
      t={t}
      locale="en"
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
      href="http://localhost:3000/en/app/orders"
    />
  );
}
