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

  // The range leads and the working estimate follows (spec 0016, AC-13), the same order as the
  // card, so a forwarded email never presents a precise figure the dashboard has just qualified.
  it("leads with the range and carries the working estimate beneath it, in both languages", async () => {
    for (const [locale, expected] of [
      ["en", { range: "1’060’000 to 2’651’000", working: "Our working estimate" }],
      ["de", { range: "1’060’000 bis 2’651’000", working: "Unser Arbeitswert" }],
    ] as const) {
      const rendered = await renderEmail({
        template: "benchmark_ready",
        locale,
        data: {
          companyName: "Example Ltd",
          kpisCompared: 5,
          costChf: 1_961_000,
          costLowChf: 1_060_000,
          costHighChf: 2_651_000,
        },
        appUrl,
      });
      const [low, high] = expected.range.split(/ (?:to|bis) /) as [string, string];
      expect(rendered.html).toMatch(chfPattern(low));
      expect(rendered.html).toMatch(chfPattern(high));
      expect(rendered.html).toContain(expected.working);
      // The range is stated before the working estimate.
      expect(rendered.text.indexOf(expected.working)).toBeGreaterThan(0);
    }
  });

  // Half a range is never shown: without both ends the single figure stands alone, so an older
  // queued payload still sends (spec 0016, AC-13).
  it("falls back to the single figure when either range end is absent", async () => {
    for (const partial of [{ costLowChf: 1_060_000 }, { costHighChf: 2_651_000 }, {}]) {
      const rendered = await renderEmail({
        template: "benchmark_ready",
        locale: "en",
        data: { companyName: "Example Ltd", kpisCompared: 5, costChf: 1_961_000, ...partial },
        appUrl,
      });
      expect(rendered.html).toContain("cost you about");
      expect(rendered.html).not.toContain("Our working estimate");
      expect(rendered.html).toMatch(chfPattern("1’961’000"));
    }
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
