import { createTranslatorFor } from "@/i18n/standalone";
import { AssessmentScheduledEmail } from "@/lib/email/templates/assessment-scheduled";

/** `pnpm email:dev` preview (spec 0014, AC-9): the German assessment scheduled email to a client member. */
export default async function AssessmentScheduledDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <AssessmentScheduledEmail
      t={t}
      locale="de"
      data={{
        firstName: "Fixture",
        scheduledAt: "2026-11-12T08:00:00.000Z",
        expertName: "Dr. Fixture Muster",
        packageName: "EHS-System- & Kultur-Snapshot",
      }}
      href="http://localhost:3000/de/app"
    />
  );
}
