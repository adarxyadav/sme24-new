import { createTranslatorFor } from "@/i18n/standalone";
import { ExpertWelcomeEmail } from "@/lib/email/templates/expert-welcome";

/** `pnpm email:dev` preview (spec 0013, AC-14): the German expert welcome email. */
export default async function ExpertWelcomeDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <ExpertWelcomeEmail
      t={t}
      locale="de"
      data={{ firstName: "Fixture" }}
      href="http://localhost:3000/de/expert/profile"
    />
  );
}
