// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES } from "@/lib/email/registry";
import { renderEmail } from "@/lib/email/render";
import {
  BENCHMARK_SNAPSHOT_CREATED_EVENT,
  benchmarkReadyDataSchema,
  EMAIL_TEMPLATE_NAMES,
} from "@/lib/email/schema";

/**
 * The benchmark ready template (spec 0008, AC-7; spec 0022, AC-17): registered beside `welcome`,
 * renders in both languages with the rounded yearly loss in the snapshot's own currency and the ask
 * for the figures when no loss could be computed, and points its button at the client area.
 */
/**
 * de-CH groups thousands with U+2019 on ICU 77 and with the straight apostrophe U+0027 on ICU 78
 * (Node 22 in CI), which React escapes to `&#x27;` in HTML; the money assertions accept all three.
 */
const GROUP = "(?:’|'|&#x27;|&#39;)";
const moneyPattern = (currency: string, grouped: string) =>
  new RegExp(`${currency}.${grouped.split("’").join(GROUP)}`);

describe("renderEmail benchmark_ready", () => {
  const appUrl = "https://sme24.example";

  it("is registered with its schema, the /app link and a notification", () => {
    expect(EMAIL_TEMPLATE_NAMES).toContain("benchmark_ready");
    expect(EMAIL_TEMPLATES.benchmark_ready.link).toBe("/app");
    expect(EMAIL_TEMPLATES.benchmark_ready.notify).toBe(true);
    expect(BENCHMARK_SNAPSHOT_CREATED_EVENT).toBe("benchmark.snapshot_created");
    // The currency is a three letter code and is required: an amount with no currency is exactly
    // what the CHF only shape allowed (spec 0022, AC-17).
    expect(
      benchmarkReadyDataSchema.safeParse({ companyName: "X", currency: "chf", peersCompared: 0 })
        .success,
    ).toBe(false);
    expect(benchmarkReadyDataSchema.safeParse({ companyName: "X", peersCompared: 0 }).success).toBe(
      false,
    );
    expect(
      benchmarkReadyDataSchema.safeParse({ companyName: "X", currency: "CHF", peersCompared: 0 })
        .success,
    ).toBe(true);
  });

  it("renders the German email with the loss, the saving, the first name and the /de/app button", async () => {
    const rendered = await renderEmail({
      template: "benchmark_ready",
      locale: "de",
      data: {
        companyName: "Musterfirma AG",
        firstName: "Clara",
        currency: "CHF",
        peersCompared: 5,
        lossAmount: 366_000,
        savingAtMedian: 90_000,
      },
      appUrl,
    });
    expect(rendered.subject).toBe("Ihr Benchmark für Musterfirma AG ist bereit");
    expect(rendered.html).toContain("Guten Tag Clara");
    expect(rendered.html).toContain("5 Vergleichsunternehmen gefunden");
    expect(rendered.html).toMatch(moneyPattern("CHF", "366’000"));
    expect(rendered.html).toMatch(moneyPattern("CHF", "90’000"));
    expect(rendered.html).toContain(`href="${appUrl}/de/app"`);
    expect(rendered.text).toContain("Benchmark ansehen");
  });

  // The client's currency, never francs by default: the peers and the loss are priced in
  // `companies.currency` (spec 0022, AC-2, AC-17).
  it("states the money in the snapshot's own currency", async () => {
    const rendered = await renderEmail({
      template: "benchmark_ready",
      locale: "en",
      data: {
        companyName: "Example GmbH",
        currency: "EUR",
        peersCompared: 4,
        lossAmount: 366_000,
      },
      appUrl,
    });
    // `en-CH` groups with a comma and prints the euro sign; the point is the currency, not the mark.
    expect(rendered.html).toContain("€366,000");
    expect(rendered.html).not.toContain("CHF");
  });

  it("renders the English variant without money when no loss could be computed", async () => {
    const rendered = await renderEmail({
      template: "benchmark_ready",
      locale: "en",
      data: { companyName: "Example Ltd", currency: "CHF", peersCompared: 1 },
      appUrl,
    });
    expect(rendered.subject).toBe("Your benchmark for Example Ltd is ready");
    expect(rendered.html).toContain(">Hello<");
    expect(rendered.html).toContain("1 peer found");
    expect(rendered.html).toContain("Enter your headcount and your LTIFR");
    expect(rendered.html).not.toContain("CHF");
    expect(rendered.html).toContain(`href="${appUrl}/en/app"`);
  });
});
