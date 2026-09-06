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
 * The benchmark ready template (spec 0008, AC-7): registered beside `welcome`, renders in both
 * languages with the rounded money when a cost exists and the headcount ask when it does not,
 * and points its button at the client area.
 */
/**
 * de-CH groups thousands with U+2019 on ICU 77 and with the straight apostrophe U+0027 on ICU 78
 * (Node 22 in CI), which React escapes to `&#x27;` in HTML; the money assertions accept all three.
 */
const GROUP = "(?:’|'|&#x27;|&#39;)";
const chfPattern = (grouped: string) => new RegExp(`CHF.${grouped.split("’").join(GROUP)}`);

describe("renderEmail benchmark_ready", () => {
  const appUrl = "https://sme24.example";

  it("is registered with its schema, the /app link and a notification", () => {
    expect(EMAIL_TEMPLATE_NAMES).toContain("benchmark_ready");
    expect(EMAIL_TEMPLATES.benchmark_ready.link).toBe("/app");
    expect(EMAIL_TEMPLATES.benchmark_ready.notify).toBe(true);
    expect(BENCHMARK_SNAPSHOT_CREATED_EVENT).toBe("benchmark.snapshot_created");
    expect(benchmarkReadyDataSchema.safeParse({ companyName: "X", kpisCompared: 9 }).success).toBe(
      false,
    );
    expect(benchmarkReadyDataSchema.safeParse({ companyName: "X", kpisCompared: 0 }).success).toBe(
      true,
    );
  });

  it("renders the German email with the cost, the saving, the first name and the /de/app button", async () => {
    const rendered = await renderEmail({
      template: "benchmark_ready",
      locale: "de",
      data: {
        companyName: "Musterfirma AG",
        firstName: "Clara",
        kpisCompared: 5,
        costChf: 1_961_000,
        savingMedianChf: 522_000,
      },
      appUrl,
    });
    expect(rendered.subject).toBe("Ihr Benchmark für Musterfirma AG ist bereit");
    expect(rendered.html).toContain("Guten Tag Clara");
    expect(rendered.html).toContain("5 Kennzahlen verglichen");
    expect(rendered.html).toMatch(chfPattern("1’961’000"));
    expect(rendered.html).toMatch(chfPattern("522’000"));
    expect(rendered.html).toContain(`href="${appUrl}/de/app"`);
    expect(rendered.text).toContain("Benchmark ansehen");
  });

  it("renders the English variant without money when no cost was computed", async () => {
    const rendered = await renderEmail({
      template: "benchmark_ready",
      locale: "en",
      data: { companyName: "Example Ltd", kpisCompared: 1 },
      appUrl,
    });
    expect(rendered.subject).toBe("Your benchmark for Example Ltd is ready");
    expect(rendered.html).toContain(">Hello<");
    expect(rendered.html).toContain("1 KPI compared");
    expect(rendered.html).toContain("Add your headcount");
    expect(rendered.html).not.toContain("CHF");
    expect(rendered.html).toContain(`href="${appUrl}/en/app"`);
  });
});
