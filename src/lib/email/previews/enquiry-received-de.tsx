import { createTranslatorFor } from "@/i18n/standalone";
import { EnquiryReceivedEmail } from "@/lib/email/templates/enquiry-received";

/** `pnpm email:dev` preview (spec 0009, AC-14): the German acknowledgement of a retainer request. */
export default async function EnquiryReceivedDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <EnquiryReceivedEmail
      t={t}
      locale="de"
      data={{ contactName: "Clara Muster", topic: "retainer" }}
      href="http://localhost:3000/de"
    />
  );
}
