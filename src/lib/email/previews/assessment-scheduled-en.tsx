import { createTranslatorFor } from "@/i18n/standalone";
import { AssessmentScheduledEmail } from "@/lib/email/templates/assessment-scheduled";

/** `pnpm email:dev` preview (spec 0014, AC-9): the English assessment scheduled email to a client member. */
export default async function AssessmentScheduledEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <AssessmentScheduledEmail
      t={t}
      locale="en"
      data={{
        firstName: "Fixture",
        scheduledAt: "2026-11-12T08:00:00.000Z",
        expertName: "Dr. Fixture Muster",
        packageName: "EHS System & Culture Snapshot",
      }}
      href="http://localhost:3000/en/app"
    />
  );
}
