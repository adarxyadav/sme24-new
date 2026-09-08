import { createTranslatorFor } from "@/i18n/standalone";
import { ExpertAssignedEmail } from "@/lib/email/templates/expert-assigned";

/** `pnpm email:dev` preview (spec 0013, AC-14): the German expert assigned email to a client member. */
export default async function ExpertAssignedDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <ExpertAssignedEmail
      t={t}
      locale="de"
      data={{
        firstName: "Fixture",
        expertName: "Dr. Fixture Muster",
        headline: "EHS lead auditor, ISO 45001 and Suva compliance",
      }}
      href="http://localhost:3000/de/app"
    />
  );
}
