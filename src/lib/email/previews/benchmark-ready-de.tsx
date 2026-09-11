import { createTranslatorFor } from "@/i18n/standalone";
import { BenchmarkReadyEmail } from "@/lib/email/templates/benchmark-ready";

/** `pnpm email:dev` preview (spec 0008, AC-7): the German benchmark ready email leading with the cost range (spec 0016, AC-13). */
export default async function BenchmarkReadyDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <BenchmarkReadyEmail
      t={t}
      locale="de"
      data={{
        firstName: "Fixture",
        companyName: "Example Fixture AG",
        kpisCompared: 5,
        costChf: 1_961_000,
        costLowChf: 1_060_000,
        costHighChf: 2_651_000,
        savingMedianChf: 522_000,
      }}
      href="http://localhost:3000/de/app"
    />
  );
}
