import { createTranslatorFor } from "@/i18n/standalone";
import { WelcomeEmail } from "@/lib/email/templates/welcome";

/** `pnpm email:dev` preview (spec 0006, AC-14): the German welcome with a first name. */
export default async function WelcomeDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <WelcomeEmail
      t={t}
      locale="de"
      data={{ organizationName: "Musterfirma AG", firstName: "Clara" }}
      href="http://localhost:3000/de/app"
    />
  );
}
