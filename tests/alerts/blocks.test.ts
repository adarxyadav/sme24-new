// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSlackMessage } from "@/lib/alerts/blocks";
import { presentAlert } from "@/lib/alerts/registry";
import { opsAlertPayloadSchema } from "@/lib/alerts/schema";

/**
 * The alert registry and the Block Kit builder (spec 0006, AC-2, AC-11): English titles, Swiss
 * formats, the person's name and language but never an email address, and one button to the app.
 */
describe("presentAlert and buildSlackMessage", () => {
  const now = new Date("2026-09-05T15:21:00.000Z");

  it("presents a client sign up with organization, name, language and Zurich time", () => {
    const view = presentAlert(
      "client.signed_up",
      { organizationName: "Musterfirma AG", userId: "11111111-1111-4111-8111-111111111111" },
      { now, person: { fullName: "Clara Client", language: "de" } },
    );
    expect(view.title).toBe("New client signed up");
    expect(view.fields).toEqual([
      ["Organization", "Musterfirma AG"],
      ["Name", "Clara Client"],
      ["Language", "German"],
      ["Time", "05.09.2026, 17:21"],
    ]);

    const message = buildSlackMessage(view, { link: "/admin", appUrl: "https://sme24.example/" });
    expect(message.text).toBe("New client signed up: Musterfirma AG");
    expect(JSON.stringify(message)).not.toContain("@");
    expect(message.blocks[0]).toEqual({
      type: "header",
      text: { type: "plain_text", text: "New client signed up", emoji: false },
    });
    expect(message.blocks[2]).toEqual({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open admin", emoji: false },
          url: "https://sme24.example/en/admin",
        },
      ],
    });
  });

  it("formats an amount in CHF and escapes mrkdwn control characters", () => {
    const view = presentAlert(
      "payment.received",
      { organizationName: "A & B <GmbH>", amountChf: 4900, reference: "INV-1" },
      { now },
    );
    const message = buildSlackMessage(view, { appUrl: "https://sme24.example" });
    const section = message.blocks[1] as { fields: Array<{ text: string }> };
    expect(section.fields[0]?.text).toBe("*Organization*\nA &amp; B &lt;GmbH&gt;");
    expect(section.fields[1]?.text).toContain("CHF");
    expect(section.fields[1]?.text).toContain("4");
    expect(section.fields[1]?.text).toContain("900.00");
    expect(message.blocks).toHaveLength(2);
  });

  it("types the fields per kind at the boundary", () => {
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "email.failed",
        fields: {
          deliveryId: "d0000000-0000-4000-8000-000000000001",
          template: "welcome",
          reason: "422",
        },
        link: "/admin/emails/d0000000-0000-4000-8000-000000000001",
        idempotencyKey: "email-failed/d0000000-0000-4000-8000-000000000001/1",
      }).success,
    ).toBe(true);
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "client.signed_up",
        fields: { organizationName: "X" },
        idempotencyKey: "signup/x",
      }).success,
    ).toBe(false);
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "ops.test",
        fields: { triggeredBy: "o" },
        link: "admin",
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
  });
});

describe("the external link of an alert (spec 0007, AC-10)", () => {
  const now = new Date("2026-09-06T10:00:00.000Z");
  const view = presentAlert(
    "research.run_failed",
    { runId: "run_7", organizationName: "Muster AG", reason: "provider_timeout: no result" },
    { now },
  );
  const runPage = "https://cloud.trigger.dev/projects/v3/proj_x/runs/run_7";

  it("buttons to the external URL when no app link is given", () => {
    const message = buildSlackMessage(view, {
      externalUrl: runPage,
      appUrl: "https://sme24.example",
    });
    expect(message.blocks[2]).toEqual({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open run", emoji: false },
          url: runPage,
        },
      ],
    });
  });

  it("lets the app link win when both are given", () => {
    const message = buildSlackMessage(view, {
      link: "/admin/research/run_7",
      externalUrl: runPage,
      appUrl: "https://sme24.example/",
    });
    const actions = message.blocks[2] as { elements: Array<{ url: string }> };
    expect(actions.elements[0]?.url).toBe("https://sme24.example/en/admin/research/run_7");
  });

  it("adds no button when neither link is given", () => {
    expect(buildSlackMessage(view, { appUrl: "https://sme24.example" }).blocks).toHaveLength(2);
  });

  it("accepts only an absolute https external link at the boundary", () => {
    const payload = {
      kind: "research.run_failed",
      fields: { runId: "run_7", organizationName: "Muster AG", reason: "stale" },
      idempotencyKey: "research-stale/run_7",
    };
    expect(opsAlertPayloadSchema.safeParse({ ...payload, externalUrl: runPage }).success).toBe(
      true,
    );
    expect(
      opsAlertPayloadSchema.safeParse({ ...payload, externalUrl: "http://cloud.trigger.dev/x" })
        .success,
    ).toBe(false);
    expect(opsAlertPayloadSchema.safeParse({ ...payload, externalUrl: "/admin" }).success).toBe(
      false,
    );
    expect(
      opsAlertPayloadSchema.safeParse({
        ...payload,
        externalUrl: `https://x.example/${"a".repeat(500)}`,
      }).success,
    ).toBe(false);
  });
});
