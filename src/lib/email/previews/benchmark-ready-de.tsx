import { createTranslatorFor } from "@/i18n/standalone";
import { BenchmarkReadyEmail } from "@/lib/email/templates/benchmark-ready";

/** `pnpm email:dev` preview (spec 0008, AC-7): die deutsche Benchmark-Mail mit den Jahreskosten in der Währung des Snapshots (Spec 0022, AC-17). */
export default async function BenchmarkReadyDePreview() {
  const t = await createTranslatorFor("de-CH");
  return (
    <BenchmarkReadyEmail
      t={t}
      locale="de"
      data={{
        firstName: "Fixture",
        companyName: "Example Fixture AG",
        currency: "CHF",
        peersCompared: 5,
        lossAmount: 366_000,
        savingAtMedian: 122_000,
      }}
      href="http://localhost:3000/de/app"
    />
  );
}
