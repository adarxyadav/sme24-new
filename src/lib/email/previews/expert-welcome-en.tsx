import { createTranslatorFor } from "@/i18n/standalone";
import { ExpertWelcomeEmail } from "@/lib/email/templates/expert-welcome";

/** `pnpm email:dev` preview (spec 0013, AC-14): the English expert welcome email. */
export default async function ExpertWelcomeEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <ExpertWelcomeEmail
      t={t}
      locale="en"
      data={{ firstName: "Fixture" }}
      href="http://localhost:3000/en/expert/profile"
    />
  );
}
