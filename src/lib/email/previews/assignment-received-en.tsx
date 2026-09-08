import { createTranslatorFor } from "@/i18n/standalone";
import { AssignmentReceivedEmail } from "@/lib/email/templates/assignment-received";

/** `pnpm email:dev` preview (spec 0013, AC-14): the English assignment email to the expert. */
export default async function AssignmentReceivedEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <AssignmentReceivedEmail
      t={t}
      locale="en"
      data={{
        firstName: "Fixture",
        organizationName: "Example Fixture AG",
        organizationId: "00000000-0000-4000-8000-000000000001",
      }}
      href="http://localhost:3000/en/expert/clients/00000000-0000-4000-8000-000000000001"
    />
  );
}
