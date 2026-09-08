import { createTranslatorFor } from "@/i18n/standalone";
import { ExpertAssignedEmail } from "@/lib/email/templates/expert-assigned";

/** `pnpm email:dev` preview (spec 0013, AC-14): the English expert assigned email to a client member. */
export default async function ExpertAssignedEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <ExpertAssignedEmail
      t={t}
      locale="en"
      data={{
        firstName: "Fixture",
        expertName: "Dr. Fixture Muster",
        headline: "EHS lead auditor, ISO 45001 and Suva compliance",
      }}
      href="http://localhost:3000/en/app"
    />
  );
}
