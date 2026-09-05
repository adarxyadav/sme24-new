import { createTranslatorFor } from "@/i18n/standalone";
import { WelcomeEmail } from "@/lib/email/templates/welcome";

/** `pnpm email:dev` preview (spec 0006, AC-14): the English welcome with the neutral greeting. */
export default async function WelcomeEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <WelcomeEmail
      t={t}
      locale="en"
      data={{ organizationName: "Example Ltd" }}
      href="http://localhost:3000/en/app"
    />
  );
}
