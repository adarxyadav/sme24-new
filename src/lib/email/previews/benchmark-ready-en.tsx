import { createTranslatorFor } from "@/i18n/standalone";
import { BenchmarkReadyEmail } from "@/lib/email/templates/benchmark-ready";

/** `pnpm email:dev` preview (spec 0008, AC-7): the English benchmark ready email with the yearly loss in the snapshot's currency (spec 0022, AC-17). */
export default async function BenchmarkReadyEnPreview() {
  const t = await createTranslatorFor("en-CH");
  return (
    <BenchmarkReadyEmail
      t={t}
      locale="en"
      data={{
        firstName: undefined,
        companyName: "Example Fixture AG",
        currency: "CHF",
        peersCompared: 5,
        lossAmount: 366_000,
        savingAtMedian: 122_000,
      }}
      href="http://localhost:3000/en/app"
    />
  );
}
