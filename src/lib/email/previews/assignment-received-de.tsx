import { createTranslatorFor } from "@/i18n/standalone";
import { AssignmentReceivedEmail } from "@/lib/email/templates/assignment-received";

/** `pnpm email:dev` preview (spec 0013, AC-14): the German assignment email to the expert. */
export default async function AssignmentReceivedDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <AssignmentReceivedEmail
      t={t}
      locale="de"
      data={{
        firstName: "Fixture",
        organizationName: "Example Fixture AG",
        organizationId: "00000000-0000-4000-8000-000000000001",
      }}
      href="http://localhost:3000/de/expert/clients/00000000-0000-4000-8000-000000000001"
    />
  );
}
