import { createTranslatorFor } from "@/i18n/standalone";
import { EnquiryReceivedEmail } from "@/lib/email/templates/enquiry-received";

/** `pnpm email:dev` preview (spec 0009, AC-14): the English acknowledgement of a general question. */
export default async function EnquiryReceivedEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <EnquiryReceivedEmail
      t={t}
      locale="en"
      data={{ contactName: "Sam Example", topic: "general" }}
      href="http://localhost:3000/en"
    />
  );
}
