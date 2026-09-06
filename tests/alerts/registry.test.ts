import { describe, expect, it } from "vitest";
import { ALERT_REGISTRY, presentAlert } from "@/lib/alerts/registry";
import { ALERT_KINDS, opsAlertPayloadSchema } from "@/lib/alerts/schema";

/**
 * The alert registry and its payload schema (spec 0006, AC-11): every kind, live or reserved, has
 * a presenter and a typed fields shape, the `email.failed` and `ops.test` presenters say what the
 * ops channel needs, a link must be a bare app path, and no kind ever carries an email address.
 */
const AT = new Date("2026-09-05T10:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DELIVERY_ID = "d0000000-0000-4000-8000-000000000001";

describe("ALERT_REGISTRY (AC-11)", () => {
  it("has a presenter for the three live and the three reserved kinds", () => {
    expect(Object.keys(ALERT_REGISTRY).sort()).toEqual([...ALERT_KINDS].sort());
  });

  it("presents a failed email with the template, the reason and the delivery id", () => {
    const view = presentAlert(
      "email.failed",
      { deliveryId: DELIVERY_ID, template: "welcome", reason: "domain not verified" },
      { now: AT },
    );
    expect(view.title).toBe("Email delivery failed");
    expect(view.fields).toEqual([
      ["Template", "welcome"],
      ["Reason", "domain not verified"],
      ["Delivery", DELIVERY_ID],
      ["Time", "05.09.2026, 12:00"],
    ]);
    expect(view.buttonLabel).toBe("Open delivery");
  });

  it("presents a test alert with who triggered it", () => {
    const view = presentAlert("ops.test", { triggeredBy: "Olga Ops" }, { now: AT });
    expect(view).toEqual({
      title: "Test alert",
      fields: [
        ["Triggered by", "Olga Ops"],
        ["Time", "05.09.2026, 12:00"],
      ],
      buttonLabel: "Open admin",
    });
  });

  it("falls back to Unknown when the sign up's person could not be resolved", () => {
    const view = presentAlert(
      "client.signed_up",
      { organizationName: "Musterfirma AG", userId: USER_ID },
      { now: AT },
    );
    expect(view.fields).toEqual(
      expect.arrayContaining([
        ["Name", "Unknown"],
        ["Language", "Unknown"],
      ]),
    );
  });

  it("names the language from the short code or the full locale and Unknown otherwise", () => {
    const language = (code: string) =>
      presentAlert(
        "client.signed_up",
        { organizationName: "X", userId: USER_ID },
        { now: AT, person: { fullName: "Clara", language: code } },
      ).fields.find(([label]) => label === "Language")?.[1];
    expect(language("de")).toBe("German");
    expect(language("de-CH")).toBe("German");
    expect(language("en-CH")).toBe("English");
    expect(language("fr")).toBe("Unknown");
  });

  it("presents the reserved kinds so features 8, 11 and 13 only add a caller", () => {
    expect(
      presentAlert(
        "research.run_failed",
        { runId: "run_7", organizationName: "Musterfirma AG", reason: "timeout" },
        { now: AT },
      ).buttonLabel,
    ).toBe("Open run");
    expect(
      presentAlert(
        "enquiry.received",
        { organizationName: "Musterfirma AG", topic: "Retainer" },
        { now: AT },
      ).fields[1],
    ).toEqual(["Topic", "Retainer"]);
  });
});

describe("opsAlertPayloadSchema (AC-11)", () => {
  it("accepts a live kind with its typed fields and a bare app path link", () => {
    const parsed = opsAlertPayloadSchema.safeParse({
      kind: "email.failed",
      fields: { deliveryId: DELIVERY_ID, template: "welcome", reason: "boom" },
      link: `/admin/emails/${DELIVERY_ID}`,
      idempotencyKey: `email-failed/${DELIVERY_ID}/1`,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects the fields of another kind, an absolute link and a missing key", () => {
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "ops.test",
        fields: { deliveryId: DELIVERY_ID },
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "ops.test",
        fields: { triggeredBy: "Olga" },
        link: "https://evil.example/admin",
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
    expect(
      opsAlertPayloadSchema.safeParse({ kind: "ops.test", fields: { triggeredBy: "Olga" } })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown kind and a negative amount", () => {
    expect(
      opsAlertPayloadSchema.safeParse({ kind: "made.up", fields: {}, idempotencyKey: "k" }).success,
    ).toBe(false);
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "payment.received",
        fields: { organizationName: "X", amountChf: -1, reference: "inv_1" },
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
  });

  it("carries no email address field on any kind, so Slack never sees one", () => {
    const signedUp = opsAlertPayloadSchema.safeParse({
      kind: "client.signed_up",
      fields: { organizationName: "X", userId: USER_ID, email: "clara@example.test" },
      idempotencyKey: "k",
    });
    expect(signedUp.success).toBe(true);
    expect(signedUp.success && signedUp.data.fields).not.toHaveProperty("email");
  });
});

describe("the benchmark.failed kind (spec 0008, AC-8)", () => {
  it("presents the organization, the company, the trigger kind, the reason and the time with an Open run button", () => {
    const view = presentAlert(
      "benchmark.failed",
      {
        organizationName: "Musterfirma AG",
        companyName: "Muster AG",
        triggerKind: "client_edit",
        errorMessage: "JWT expired",
      },
      { now: AT },
    );
    expect(view).toEqual({
      title: "Benchmark computation failed",
      fields: [
        ["Organization", "Musterfirma AG"],
        ["Company", "Muster AG"],
        ["Trigger", "client_edit"],
        ["Reason", "JWT expired"],
        ["Time", "05.09.2026, 12:00"],
      ],
      buttonLabel: "Open run",
    });
  });

  it("accepts the three trigger kinds with a Trigger.dev link and rejects an unknown kind or an empty reason", () => {
    const fields = {
      organizationName: "Musterfirma AG",
      companyName: "Muster AG",
      errorMessage: "boom",
    };
    for (const triggerKind of ["research", "client_edit", "recompute"]) {
      expect(
        opsAlertPayloadSchema.safeParse({
          kind: "benchmark.failed",
          fields: { ...fields, triggerKind },
          externalUrl: "https://cloud.trigger.dev/projects/v3/proj/runs/run_1",
          idempotencyKey: "benchmark-failed/run_1",
        }).success,
      ).toBe(true);
    }
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "benchmark.failed",
        fields: { ...fields, triggerKind: "manual" },
        idempotencyKey: "benchmark-failed/run_1",
      }).success,
    ).toBe(false);
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "benchmark.failed",
        fields: { ...fields, triggerKind: "research", errorMessage: "" },
        idempotencyKey: "benchmark-failed/run_1",
      }).success,
    ).toBe(false);
  });

  it("caps the reason at 500 characters so a stack trace never reaches Slack", () => {
    expect(
      opsAlertPayloadSchema.safeParse({
        kind: "benchmark.failed",
        fields: {
          organizationName: "X",
          companyName: "Y",
          triggerKind: "research",
          errorMessage: "x".repeat(501),
        },
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
  });
});
