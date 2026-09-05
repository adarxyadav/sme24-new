// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderDeliveryPreview, renderEmail } from "@/lib/email/render";

/**
 * The welcome template renders in both languages from the one catalog (spec 0006, AC-14): the
 * subject and the button link follow the locale, the greeting follows the first name, and every
 * string comes from a message key (a missing key throws in test, spec 0004).
 */
describe("renderEmail welcome", () => {
  const appUrl = "https://sme24.example";

  it("renders the German welcome with the organization, the first name and the /de/app button", async () => {
    const rendered = await renderEmail({
      template: "welcome",
      locale: "de",
      data: { organizationName: "Musterfirma AG", firstName: "Clara" },
      appUrl,
    });
    expect(rendered.subject).toBe("Willkommen bei SME24, Musterfirma AG");
    expect(rendered.html).toContain("Guten Tag Clara");
    expect(rendered.html).toContain("Musterfirma AG");
    expect(rendered.html).toContain(`href="${appUrl}/de/app"`);
    expect(rendered.html).toContain('lang="de"');
    expect(rendered.text).toContain("Zum Kundenbereich");
  });

  it("renders the English welcome with the neutral greeting and the /en/app button", async () => {
    const rendered = await renderEmail({
      template: "welcome",
      locale: "en",
      data: { organizationName: "Example Ltd" },
      appUrl: `${appUrl}/`,
    });
    expect(rendered.subject).toBe("Welcome to SME24, Example Ltd");
    expect(rendered.html).toContain(">Hello<");
    expect(rendered.html).not.toContain("Hello undefined");
    expect(rendered.html).toContain(`href="${appUrl}/en/app"`);
    expect(rendered.html).toContain('lang="en"');
  });

  it("rejects data that fails the template schema", async () => {
    await expect(
      renderEmail({ template: "welcome", locale: "de", data: {}, appUrl }),
    ).rejects.toThrow();
  });
});

describe("renderDeliveryPreview", () => {
  it("rerenders a stored row and never throws", async () => {
    const ok = await renderDeliveryPreview(
      { template: "welcome", locale: "en", data: { organizationName: "Example Ltd" } },
      "https://sme24.example",
    );
    expect(ok).toMatchObject({ ok: true, subject: "Welcome to SME24, Example Ltd" });

    const unknown = await renderDeliveryPreview(
      { template: "nope", locale: "en", data: {} },
      "https://sme24.example",
    );
    expect(unknown).toEqual({ ok: false, error: "unknown_template" });

    const invalid = await renderDeliveryPreview(
      { template: "welcome", locale: "de", data: [] },
      "https://sme24.example",
    );
    expect(invalid).toEqual({ ok: false, error: "render_failed" });
  });
});
