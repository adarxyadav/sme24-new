// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES } from "@/lib/email/registry";
import { renderEmail } from "@/lib/email/render";
import {
  assessmentScheduledDataSchema,
  EMAIL_TEMPLATE_NAMES,
  ORDER_SCHEDULED_EVENT,
} from "@/lib/email/schema";

/**
 * The assessment scheduled template (spec 0014, AC-9): registered on the `docs/email.md` rail,
 * rendered once per recipient language from the one stored payload.
 *
 * The part worth pinning is the date. `scheduledAt` travels as the stored instant, never as a
 * pre formatted string, so this template is the single place it becomes Swiss local time; a
 * template that rendered it in UTC would tell a client the wrong hour, and in winter the wrong
 * hour is an hour earlier than the visit ops actually booked.
 */
describe("renderEmail assessment_scheduled", () => {
  const appUrl = "https://sme24.example";

  /** A summer booking: 09:30 Zurich is 07:30Z, so a UTC render would say 07:30. */
  const summer = {
    scheduledAt: "2030-07-15T07:30:00.000Z",
    expertName: "Erika Muster",
    packageName: "Safety Culture",
  };

  it("is registered with its schema, the /app link and a notification", () => {
    expect(EMAIL_TEMPLATE_NAMES).toContain("assessment_scheduled");
    expect(EMAIL_TEMPLATES.assessment_scheduled.link).toBe("/app");
    expect(EMAIL_TEMPLATES.assessment_scheduled.notify).toBe(true);
    expect(ORDER_SCHEDULED_EVENT).toBe("order.scheduled");
  });

  it("takes the instant as ISO 8601 with an offset and refuses a pre formatted date", () => {
    expect(assessmentScheduledDataSchema.safeParse(summer).success).toBe(true);
    expect(
      assessmentScheduledDataSchema.safeParse({ ...summer, scheduledAt: "15.07.2030, 09:30" })
        .success,
    ).toBe(false);
    expect(assessmentScheduledDataSchema.safeParse({ ...summer, expertName: " " }).success).toBe(
      false,
    );
    expect(assessmentScheduledDataSchema.safeParse({ ...summer, packageName: "" }).success).toBe(
      false,
    );
  });

  it("renders the German email in Swiss local time with the first name and the /de/app button", async () => {
    const rendered = await renderEmail({
      template: "assessment_scheduled",
      locale: "de",
      data: { ...summer, firstName: "Clara" },
      appUrl,
    });
    expect(rendered.subject).toBe("Ihre Vor-Ort-Beurteilung ist terminiert");
    expect(rendered.html).toContain("Guten Tag Clara");
    expect(rendered.html).toContain("Safety Culture");
    expect(rendered.html).toContain("Erika Muster");
    // 07:30Z is 09:30 in Zurich in July: the summer offset, not UTC.
    expect(rendered.html).toContain("15.07.2030");
    expect(rendered.html).toContain("09:30");
    expect(rendered.html).not.toContain("07:30");
    expect(rendered.html).toContain(`href="${appUrl}/de/app"`);
    expect(rendered.html).toContain('lang="de"');
    expect(rendered.text).toContain("Zum Kundenbereich");
  });

  it("renders the English variant with the neutral greeting and the /en/app button", async () => {
    const rendered = await renderEmail({
      template: "assessment_scheduled",
      locale: "en",
      data: summer,
      appUrl,
    });
    expect(rendered.subject).toBe("Your on site assessment is booked");
    expect(rendered.html).toContain(">Hello<");
    expect(rendered.html).not.toContain("Hello undefined");
    expect(rendered.html).toContain("Erika Muster");
    expect(rendered.html).toContain("09:30");
    expect(rendered.html).toContain(`href="${appUrl}/en/app"`);
    expect(rendered.html).toContain('lang="en"');
  });

  it("renders a winter booking on the other Swiss offset", async () => {
    // 08:00Z is 09:00 in Zurich in January: UTC+1, an hour less than the summer offset.
    const rendered = await renderEmail({
      template: "assessment_scheduled",
      locale: "de",
      data: { ...summer, scheduledAt: "2030-01-15T08:00:00.000Z" },
      appUrl,
    });
    expect(rendered.html).toContain("15.01.2030");
    expect(rendered.html).toContain("09:00");
  });

  it("rejects data that fails the template schema rather than sending an empty date", async () => {
    await expect(
      renderEmail({ template: "assessment_scheduled", locale: "de", data: {}, appUrl }),
    ).rejects.toThrow();
  });
});
