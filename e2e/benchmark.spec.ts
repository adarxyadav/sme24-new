import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  accountByEmail,
  createConfirmedClient,
  dbAvailable,
  deleteAccount,
  serviceClient,
} from "./db";
import { mailAvailable, mailIds, noMailFor, readMail, uniqueEmail } from "./mail";

/**
 * The benchmark thread on the fixture research run (spec 0008, AC-16): a fresh client starts the
 * research, the worker (`pnpm trigger:dev` in fixture mode, `TRIGGER_DEV_RUNNING=1`) ends the run
 * `succeeded` and computes a snapshot from the committed seed, and the dashboard shows the
 * opportunity card, the priority gaps and the positions with deterministic values; axe runs on
 * the ready state. Without the worker the whole file skips; it also skips on a deployment.
 */
const localOnly = !mailAvailable || !dbAvailable;
const workerRunning = process.env.TRIGGER_DEV_RUNNING === "1";
const PASSWORD = "korrekt-pferd-batterie";
const RUN_TIMEOUT = { timeout: 180_000, intervals: [1_000, 2_000] };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// The fixture company: accident rate 68 per 1 000 FTE, 420 employees, lost days 12.5, NOGA 23.61
// (section C). The committed seed holds the section C accident rate quartiles 34.9, 49.9, 66.4
// and the assumptions 4 811 CHF per case, 1 100 CHF per day and the multipliers 2, 3.7 and 5.
const INCIDENTS = (68 * 420) / 1000;
const COST_PER_CASE = 4811 + 12.5 * 1100;
const ANNUAL = INCIDENTS * COST_PER_CASE * 3.7;
const AT_MEDIAN = ((49.9 * 420) / 1000) * COST_PER_CASE * 3.7;

test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");
test.skip(
  !workerRunning,
  "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs in fixture mode",
);
test.describe.configure({ timeout: 400_000 });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function signInFresh(page: Page, email: string, organizationName: string) {
  await createConfirmedClient(email, PASSWORD, organizationName);
  await page.goto("/en/sign-in");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/app$/);
}

test("the fixture run ends in a snapshot and the dashboard shows the card, the gaps and the positions", async ({
  page,
}) => {
  const email = uniqueEmail("benchmark");
  try {
    await signInFresh(page, email, "Benchmark Fixture AG");
    const seenBefore = await mailIds(email);
    await page.getByRole("button", { name: "Start research" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Benchmark Fixture AG" })).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect
      .poll(
        () => page.locator("[data-run-status]").first().getAttribute("data-run-status"),
        RUN_TIMEOUT,
      )
      .toBe("succeeded");

    // The snapshot lands a few seconds after the run; the Realtime channel or the poll refreshes the page.
    const segment = page.locator("[data-benchmark-state]");
    await expect(segment).toBeVisible();
    await expect
      .poll(() => segment.getAttribute("data-benchmark-state"), RUN_TIMEOUT)
      .toBe("ready");
    await expect(
      page.getByRole("heading", { level: 2, name: "Benchmark and opportunity" }),
    ).toBeVisible();

    // The opportunity card (AC-9 a): rounded headline, range, both savings, the provisional note.
    const card = page.locator("[data-opportunity-card]");
    expect(Number(await card.getAttribute("data-cost"))).toBeCloseTo(ANNUAL, 0);
    await expect(card.locator("[data-cost-headline]")).toContainText(/1.961.000/);
    await expect(card.locator("[data-saving-median]")).toContainText(/522.000/);
    await expect(card.getByText(/Computed on \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
    await expect(card.locator("[data-compared]")).toHaveAttribute("data-compared", "1");
    await expect(card.getByText("1 of 8 KPIs compared")).toBeVisible();
    await expect(page.locator("[data-provisional-note]")).toBeVisible();

    // The priority gaps (AC-9 b): the accident rate is the only KPI with a peer row in the seed.
    const gaps = page.locator("[data-gaps]");
    await expect(gaps).toHaveAttribute("data-gaps", "1");
    const gap = page.locator('[data-gap="accident_rate_per_1000_fte"]');
    await expect(gap).toHaveAttribute("data-rank", "1");
    await expect(gap.getByText("68.00 vs. median 49.90")).toBeVisible();
    await expect(gap.locator("[data-gap-saving]")).toContainText(/522.000/);

    // The positions (AC-9 c): one row per catalogue KPI, the band on the compared one.
    await expect(page.locator("[data-position-kpi]")).toHaveCount(8);
    const accident = page.locator('[data-position-kpi="accident_rate_per_1000_fte"]');
    await expect(accident).toHaveAttribute("data-position", "bottom_quarter");
    await expect(accident.locator("svg[data-value]")).toHaveAttribute("data-value", "68");
    await expect(accident.getByText("Bottom quarter", { exact: true })).toBeVisible();
    await expect(accident.locator(".sr-only")).toContainText(
      "your value 68.00 is in the band Bottom quarter",
    );
    await expect(
      accident.getByText(/Manufacturing · all sizes · 2022 \(nearest year\)/),
    ).toBeVisible();
    await expect(
      page.locator('[data-position-kpi="ltifr"]').getByText("No peer data yet"),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    // The benchmark ready email (AC-7): one delivery per member on the first snapshot, in the
    // member's language (the fixture client is German). It lands in Mailpit when the worker runs
    // on SMTP; a worker whose Trigger.dev environment carries a Resend key and an allowlist skips
    // the test address instead, so the inbox is asserted only on the SMTP transport.
    const db = serviceClient();
    const account = await accountByEmail(email);
    const { data: companyRow } = await db
      .from("companies")
      .select("id")
      .eq("name", "Benchmark Fixture AG")
      .maybeSingle();
    const deliveryKey = `benchmark-ready/${companyRow?.id}/${account?.user.id}`;
    const delivery = await expect
      .poll(
        async () => {
          const { data } = await db
            .from("email_deliveries")
            .select("status, locale, source_event, template, transport")
            .eq("idempotency_key", deliveryKey)
            .maybeSingle();
          return data && data.status !== "queued" && data.status !== "sending" ? data : null;
        },
        { timeout: 60_000, intervals: [1_000, 2_000] },
      )
      .not.toBeNull()
      .then(async () => {
        const { data } = await db
          .from("email_deliveries")
          .select("status, locale, source_event, template, transport")
          .eq("idempotency_key", deliveryKey)
          .single();
        return data;
      });
    expect(delivery).toMatchObject({
      locale: "de",
      source_event: "benchmark.snapshot_created",
      template: "benchmark_ready",
    });
    expect(["sent", "skipped"]).toContain(delivery?.status);
    if (delivery?.transport === "smtp") {
      const mail = await readMail(email, { seen: seenBefore, timeoutMs: 60_000 });
      expect(mail.subject).toBe("Ihr Benchmark für Benchmark Fixture AG ist bereit");
      expect(mail.html).toMatch(/1.961.000/);
      expect(mail.html).toMatch(/522.000/);
      expect(mail.links.some((link) => link.endsWith("/de/app"))).toBe(true);
    } else {
      console.log(
        `benchmark email not asserted in Mailpit: transport ${delivery?.transport}, status ${delivery?.status}`,
      );
    }
    const seenAfterFirst = await mailIds(email);

    // The disclosure (AC-10): closed by default, the formula, the five assumptions the cost used
    // (the fixture has a lost days row and an accident rate, so no hours and no default days), the inputs.
    const disclosure = page.locator("[data-calculation-disclosure]");
    await expect(disclosure.locator("[data-calculation-content]")).toBeHidden();
    await disclosure.getByRole("button", { name: "How this is calculated" }).click();
    const content = disclosure.locator("[data-calculation-content]");
    await expect(content).toBeVisible();
    await expect(content.locator("[data-fte-line]")).toBeVisible();
    await expect(content.locator("[data-assumption]")).toHaveCount(5);
    await expect(content.locator('[data-assumption="direct_cost_per_case_chf"]')).toHaveAttribute(
      "data-assumption-value",
      "4811",
    );
    await expect(
      content.locator('[data-assumption="indirect_multiplier"] [data-provisional]'),
    ).toBeVisible();
    await expect(content.locator('[data-assumption="hours_per_fte"]')).toHaveCount(0);
    await expect(content.locator("[data-input-headcount]")).toHaveAttribute(
      "data-input-headcount",
      "420",
    );
    await expect(content.locator("[data-input-industry]")).toHaveAttribute(
      "data-input-industry",
      "23.61",
    );
    await expect(content.locator('[data-input-kpi="accident_rate_per_1000_fte"]')).toContainText(
      "68.00 (2025, from the research) · peer: Manufacturing · all sizes · 2022",
    );
    await expect(content.locator('[data-input-kpi="ltifr"]')).toContainText("no peer row");
    await expectNoAxeViolations(page);

    // The facts form (AC-11, AC-12): a new headcount is saved, the benchmark is recomputed and the
    // card shows the new cost once the snapshot lands.
    const form = disclosure.locator("[data-facts-form]");
    await expect(form.getByLabel("Industry (NOGA division)")).toContainText("23");
    await form.getByLabel("Headcount").fill("500");
    await form.getByRole("button", { name: "Save and recalculate" }).click();
    await expect(form.locator("[data-facts-saved]")).toHaveAttribute("data-facts-saved", "true");
    const NEW_ANNUAL = ((68 * 500) / 1000) * COST_PER_CASE * 3.7;
    await expect
      .poll(async () => Number(await card.getAttribute("data-cost")), RUN_TIMEOUT)
      .toBeCloseTo(NEW_ANNUAL, 0);
    await expect(card.locator("[data-cost-headline]")).toContainText(/2.335.000/);
    // The second snapshot is not the first: no second delivery and no second email (AC-5, AC-7).
    expect(await noMailFor(email, seenAfterFirst)).toBe(true);
    const { count: benchmarkDeliveries } = await db
      .from("email_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("template", "benchmark_ready");
    expect(benchmarkDeliveries).toBe(1);
    if (process.env.BENCHMARK_SCREENSHOT) {
      await page.screenshot({ path: process.env.BENCHMARK_SCREENSHOT, fullPage: true });
    }

    // The stored rows (AC-5): two snapshots, the first keyed to the run, one KPI compared, the saving unrounded.
    const { data: company } = await db
      .from("companies")
      .select("id, employees_count, industry_code")
      .eq("name", "Benchmark Fixture AG")
      .maybeSingle();
    expect(company?.industry_code).toBe("23.61");
    const { data: snapshots } = await db
      .from("benchmark_snapshots")
      .select(
        "trigger_kind, research_run_id, kpis_compared, peer_provisional, saving_median_chf, created_at",
      )
      .eq("company_id", company?.id ?? "");
    expect(company?.employees_count).toBe(500);
    expect(snapshots).toHaveLength(2);
    const [first, second] = [...(snapshots ?? [])].sort((a, b) =>
      a.created_at < b.created_at ? -1 : 1,
    );
    expect(first?.trigger_kind).toBe("research");
    expect(first?.research_run_id).not.toBeNull();
    expect(first?.kpis_compared).toBe(1);
    expect(first?.peer_provisional).toBe(true);
    expect(Number(first?.saving_median_chf)).toBeCloseTo(ANNUAL - AT_MEDIAN, 0);
    expect(second?.trigger_kind).toBe("client_edit");
    expect(second?.research_run_id).toBeNull();
  } finally {
    // The delivery row outlives the user by design (recipient set to null), so it goes by hand.
    if (!process.env.BENCHMARK_KEEP_DELIVERIES) {
      await serviceClient().from("email_deliveries").delete().eq("recipient_email", email);
    }
    await deleteAccount(email);
  }
});
