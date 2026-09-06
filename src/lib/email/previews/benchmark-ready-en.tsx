import { createTranslatorFor } from "@/i18n/standalone";
import { BenchmarkReadyEmail } from "@/lib/email/templates/benchmark-ready";

/** `pnpm email:dev` preview (spec 0008, AC-7): the English benchmark ready email with a cost and a saving. */
export default async function BenchmarkReadyEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <BenchmarkReadyEmail
      t={t}
      locale="en"
      data={{
        firstName: undefined,
        companyName: "Example Fixture AG",
        kpisCompared: 5,
        costChf: 1_961_000,
        savingMedianChf: 522_000,
      }}
      href="http://localhost:3000/en/app"
    />
  );
}
