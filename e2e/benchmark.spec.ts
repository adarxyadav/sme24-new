import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createConfirmedClient, dbAvailable, deleteAccount, serviceClient } from "./db";
import { mailAvailable, uniqueEmail } from "./mail";

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
    if (process.env.BENCHMARK_SCREENSHOT) {
      await page.screenshot({ path: process.env.BENCHMARK_SCREENSHOT, fullPage: true });
    }

    // The stored row (AC-5): one snapshot, keyed to the run, one KPI compared, the saving unrounded.
    const db = serviceClient();
    const { data: company } = await db
      .from("companies")
      .select("id, employees_count, industry_code")
      .eq("name", "Benchmark Fixture AG")
      .maybeSingle();
    expect(company?.employees_count).toBe(420);
    expect(company?.industry_code).toBe("23.61");
    const { data: snapshots } = await db
      .from("benchmark_snapshots")
      .select("trigger_kind, research_run_id, kpis_compared, peer_provisional, saving_median_chf")
      .eq("company_id", company?.id ?? "");
    expect(snapshots).toHaveLength(1);
    expect(snapshots?.[0]?.trigger_kind).toBe("research");
    expect(snapshots?.[0]?.research_run_id).not.toBeNull();
    expect(snapshots?.[0]?.kpis_compared).toBe(1);
    expect(snapshots?.[0]?.peer_provisional).toBe(true);
    expect(Number(snapshots?.[0]?.saving_median_chf)).toBeCloseTo(ANNUAL - AT_MEDIAN, 0);
  } finally {
    await deleteAccount(email);
  }
});
