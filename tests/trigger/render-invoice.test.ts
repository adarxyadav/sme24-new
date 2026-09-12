// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The exhausted render (spec 0011, AC-10): a failing invoice PDF never unwinds a payment. When
 * the worker has spent all three attempts, `onFailure` sets `pdf_failed_at`, names the invoice
 * and the order in an ops alert, and leaves the order alone, so the client keeps their purchase
 * and ops can retry the render by hand.
 *
 * The hook has to be `onFailure`, which the SDK runs once the run has exhausted every retry, and
 * never `catchError`, which runs on each uncaught error and exists to steer retrying. Carrying
 * these effects on `catchError` stamped `pdf_failed_at` and alerted ops on the first transient
 * error, healing itself only if a later attempt happened to succeed; the first test below pins
 * the hook so that regression cannot come back quietly.
 *
 * The hook is tested directly because it only runs after the retries are gone, which the local
 * dev worker skips: the app cannot be driven into this state. Mocking `schemaTask` to its own
 * options object is the pattern the other task suites use and makes the hook callable. Only the
 * SDK, the env, the service client and the alert are mocked; the alert schema and its registry
 * presenter are the real ones, so a field the presenter needs cannot go missing here.
 *
 * The confirmation email is deliberately not asserted from this hook. `confirm-order` triggers
 * the render without awaiting its outcome and sends the confirmation itself, so the email is
 * independent of the render by construction rather than by anything this hook does; the test at
 * the bottom pins that separation where it actually lives.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  /** The invoice the join answers with, or null when the row has gone. */
  invoice: null as Row | null,
  readError: null as { message: string } | null,
  updates: [] as Array<{ table: string; values: Row; filters: Row }>,
  alerts: [] as Row[],
  errors: [] as Array<{ message: string; fields: Row }>,
}));

vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  logger: {
    debug: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (message: string, fields: Row) => {
      boundary.errors.push({ message, fields });
    },
  },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/trigger/ops-alert", () => ({
  raiseAlertFromTask: async (alert: Row) => {
    boundary.alerts.push(alert);
  },
}));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({ SUPABASE_SECRET_KEY: "secret", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            // `buyerLabel` reads the buyer's name from organizations or profiles by id (spec 0018).
            if (table === "organizations") return { data: { name: "Musterfirma AG" }, error: null };
            if (table === "profiles") return { data: { full_name: "Erika Expert" }, error: null };
            return {
              data: boundary.readError ? null : boundary.invoice,
              error: boundary.readError,
            };
          },
        }),
      }),
      // `invoices` is updated without a `.select()`, so awaiting the builder itself has to
      // work, exactly as it does in PostgREST.
      update: (values: Row) => {
        const filters: Row = {};
        const chain = Object.assign(Promise.resolve({ data: null, error: null }), {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            boundary.updates.push({ table, values, filters });
            return chain;
          },
        });
        return chain;
      },
    }),
  }),
}));

const INVOICE = "0e000000-0000-4000-8000-000000000001";

const ctx = { run: { id: "run_render_1" }, attempt: { number: 3 } };

type Hooks = {
  onFailure?: (input: {
    payload: { invoiceId: string };
    error: unknown;
    ctx: typeof ctx;
  }) => Promise<void>;
  catchError?: unknown;
};

async function loadTask(): Promise<Hooks> {
  const module = await import("@/trigger/render-invoice");
  return module.renderInvoiceTask as unknown as Hooks;
}

async function loadHook() {
  const onFailure = (await loadTask()).onFailure;
  if (!onFailure) throw new Error("the task carries no onFailure hook");
  return onFailure;
}

beforeEach(() => {
  boundary.invoice = {
    number: "2026-0005",
    orders: { reference: "SME24-2026-0003" },
    organization_id: "org-1",
    buyer_expert_id: null,
  };
  boundary.readError = null;
  boundary.updates = [];
  boundary.alerts = [];
  boundary.errors = [];
});

describe("render-invoice onFailure (AC-10)", () => {
  it("carries the exhausted-retries effects on onFailure, never on catchError", async () => {
    // `catchError` fires on every failed attempt, so the stamp and the alert would land on the
    // first transient error rather than once the retries are gone. Only `onFailure` waits.
    const task = await loadTask();
    expect(typeof task.onFailure).toBe("function");
    expect(task.catchError).toBeUndefined();
  });

  it("stamps pdf_failed_at on the invoice it was given, and touches nothing else", async () => {
    const onFailure = await loadHook();
    const before = Date.now();
    await onFailure({ payload: { invoiceId: INVOICE }, error: new Error("pdfkit blew up"), ctx });

    expect(boundary.updates).toHaveLength(1);
    const update = boundary.updates[0];
    if (!update) throw new Error("the hook wrote nothing");
    expect(update.table).toBe("invoices");
    expect(update.filters).toEqual({ id: INVOICE });

    // The stamp is a real timestamp at the moment of the failure, not a placeholder.
    const stampedAt = Date.parse(String(update.values.pdf_failed_at));
    expect(stampedAt).toBeGreaterThanOrEqual(before);
    expect(stampedAt).toBeLessThanOrEqual(Date.now());

    // The order is what proves the payment survived: the hook must never write to it, and must
    // not clear the invoice's own paid state either.
    expect(boundary.updates.some((write) => write.table === "orders")).toBe(false);
    expect(Object.keys(update.values)).toEqual(["pdf_failed_at"]);
  });

  it("fires one ops alert naming the invoice, the order and the organization", async () => {
    const onFailure = await loadHook();
    await onFailure({
      payload: { invoiceId: INVOICE },
      error: new Error("invoice upload failed: storage refused"),
      ctx,
    });

    expect(boundary.alerts).toHaveLength(1);
    expect(boundary.alerts[0]).toEqual({
      kind: "invoice.render_failed",
      // Keyed on the invoice, so a re-run of the same failure raises one alert, not a new one.
      idempotencyKey: `invoice-render-failed/${INVOICE}`,
      fields: {
        invoiceNumber: "2026-0005",
        reference: "SME24-2026-0003",
        organizationName: "Musterfirma AG",
        errorMessage: "invoice upload failed: storage refused",
      },
    });
  });

  it("sends fields the real alert schema and its presenter accept", async () => {
    const onFailure = await loadHook();
    await onFailure({ payload: { invoiceId: INVOICE }, error: new Error("boom"), ctx });

    // The alert is only useful if the ops channel can actually render it, so parse the payload
    // the hook built with the production schema the `ops-alert` task itself parses, then present
    // it through the real registry rather than a stand-in.
    const { opsAlertPayloadSchema } = await import("@/lib/alerts/schema");
    const { presentAlert } = await import("@/lib/alerts/registry");
    const payload = opsAlertPayloadSchema.parse(boundary.alerts[0]);
    // Narrowing on the discriminant is what proves the hook picked the right kind: the union
    // would not give us these fields otherwise.
    if (payload.kind !== "invoice.render_failed") throw new Error(`wrong kind ${payload.kind}`);
    const view = presentAlert("invoice.render_failed", payload.fields, { now: new Date() });

    expect(view.title).toBe("Invoice render failed");
    expect(view.fields).toContainEqual(["Invoice", "2026-0005"]);
    expect(view.fields).toContainEqual(["Order", "SME24-2026-0003"]);
  });

  it("still records the failure when the invoice row cannot be read", async () => {
    boundary.readError = { message: "connection reset" };
    const onFailure = await loadHook();
    await onFailure({ payload: { invoiceId: INVOICE }, error: new Error("boom"), ctx });

    // A lookup that fails must not swallow the stamp or the alert: losing both would leave a
    // paid order with no PDF and nobody told.
    expect(boundary.updates).toHaveLength(1);
    expect(boundary.alerts).toHaveLength(1);
    // The ids stand in for the names, so the alert still parses and still points somewhere.
    expect(boundary.alerts[0]?.fields).toMatchObject({
      invoiceNumber: INVOICE,
      reference: INVOICE,
      organizationName: "Unknown organization",
    });
  });

  it("truncates a runaway error message to what the alert schema allows", async () => {
    const onFailure = await loadHook();
    await onFailure({ payload: { invoiceId: INVOICE }, error: new Error("x".repeat(2000)), ctx });

    const alert = boundary.alerts[0];
    if (!alert) throw new Error("the hook raised no alert");
    const { errorMessage } = alert.fields as { errorMessage: string };
    expect(errorMessage).toHaveLength(500);
    // Over the cap the schema would reject the alert, and ops would hear nothing at all.
    const { opsAlertPayloadSchema } = await import("@/lib/alerts/schema");
    expect(() => opsAlertPayloadSchema.parse(alert)).not.toThrow();
  });

  it("reports a non Error throw rather than losing the reason", async () => {
    const onFailure = await loadHook();
    await onFailure({ payload: { invoiceId: INVOICE }, error: "storage timed out", ctx });

    expect(boundary.alerts[0]?.fields).toMatchObject({ errorMessage: "storage timed out" });
    expect(boundary.errors.map((entry) => entry.message)).toContain(
      "invoice render exhausted its retries",
    );
  });
});

describe("the confirmation email is independent of the render (AC-10)", () => {
  it("is enqueued by confirm-order beside the render, never behind its result", async () => {
    // The third effect of AC-10 is structural, not behavioural: `confirm-order` triggers the
    // render and then sends the confirmation itself, so no outcome of the render task, including
    // this hook, can hold the email back. Reading the source is the honest way to pin that,
    // since the hook has no email seam to assert on.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/trigger/confirm-order.ts", "utf8");

    const renderAt = source.indexOf("renderInvoiceTask.trigger(");
    const emailAt = source.indexOf("await sendConfirmation(");
    expect(renderAt).toBeGreaterThan(-1);
    expect(emailAt).toBeGreaterThan(renderAt);

    // `.trigger` enqueues and returns; `.triggerAndWait` would couple the email to the render
    // and is what this guards against.
    expect(source).not.toContain("renderInvoiceTask.triggerAndWait");

    // And the email carries no attachment in this slice, so a missing PDF changes nothing
    // about the message the buyer receives.
    expect(source).toContain("invoiceAttached: false");
  });

  it("names an expert buyer's invoice through the shared buyer label (spec 0018, AC-10)", async () => {
    boundary.invoice = {
      number: "2026-0006",
      orders: { reference: "SME24-2026-0090" },
      organization_id: null,
      buyer_expert_id: "expert-1",
    };
    const onFailure = await loadHook();
    await onFailure({ payload: { invoiceId: INVOICE }, error: new Error("boom"), ctx });
    expect(boundary.alerts[0]?.fields).toMatchObject({ organizationName: "Expert: Erika Expert" });
  });
});
