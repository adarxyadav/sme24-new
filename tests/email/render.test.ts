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

/**
 * The enquiry acknowledgement (spec 0009, AC-14): greets by the contact name, names the topic in
 * the recipient's language, promises one working day and carries one button back to the site
 * on the bare locale URL without a trailing slash.
 */
describe("renderEmail enquiry_received", () => {
  const appUrl = "https://sme24.example";

  it("renders the German acknowledgement for a retainer request with the button to /de", async () => {
    const rendered = await renderEmail({
      template: "enquiry_received",
      locale: "de",
      data: { contactName: "Clara Muster", topic: "retainer" },
      appUrl,
    });
    expect(rendered.subject).toBe("Ihre Anfrage ist bei SME24 eingegangen");
    expect(rendered.html).toContain("Guten Tag Clara Muster");
    expect(rendered.html).toContain("Retainer-Anfrage");
    expect(rendered.html).toContain("innerhalb eines Arbeitstags");
    expect(rendered.html).toContain(`href="${appUrl}/de"`);
    expect(rendered.html).not.toContain(`href="${appUrl}/de/"`);
    expect(rendered.html).toContain('lang="de"');
    expect(rendered.text).toContain("Zurück zu SME24");
  });

  it("renders the English acknowledgement for a general question with the button to /en", async () => {
    const rendered = await renderEmail({
      template: "enquiry_received",
      locale: "en",
      data: { contactName: "Clara Muster", topic: "general" },
      appUrl: `${appUrl}/`,
    });
    expect(rendered.subject).toBe("Your enquiry has reached SME24");
    expect(rendered.html).toContain("Hello Clara Muster");
    expect(rendered.html).toContain("Thank you for your question.");
    expect(rendered.html).toContain("within one working day");
    expect(rendered.html).toContain(`href="${appUrl}/en"`);
    expect(rendered.html).toContain('lang="en"');
  });

  it("rejects an unknown topic and a missing contact name", async () => {
    await expect(
      renderEmail({
        template: "enquiry_received",
        locale: "de",
        data: { contactName: "Clara", topic: "sales" },
        appUrl,
      }),
    ).rejects.toThrow();
    await expect(
      renderEmail({
        template: "enquiry_received",
        locale: "de",
        data: { topic: "general" },
        appUrl,
      }),
    ).rejects.toThrow();
  });
});
