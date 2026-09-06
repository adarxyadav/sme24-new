import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import en from "../messages/en-CH.json";
import {
  accountByEmail,
  createConfirmedClient,
  dbAvailable,
  deleteAccount,
  seedCompanyKpi,
  seedResearchedCompany,
  serviceClient,
} from "./db";
import { mailAvailable, uniqueEmail } from "./mail";

/**
 * The self assessment thread (spec 0010, AC-11): a confirmed client with a company, a succeeded
 * run and research rows seeded through the service client opens `/app`, sees the "Your figures"
 * card right after the KPI table with the newest year on file and the research values prefilled,
 * enters a missing figure, corrects a research value, sees "Your figure" in the table for that
 * year, clears the correction and sees the research value with its confidence again; the older
 * year hint lists the KPIs with a newer value. With `TRIGGER_DEV_RUNNING=1` the `client_edit`
 * snapshot is awaited too. Every string comes from the English catalog. Local stack only.
 */
const localOnly = !mailAvailable || !dbAvailable;
const workerRunning = process.env.TRIGGER_DEV_RUNNING === "1";
const PASSWORD = "korrekt-pferd-batterie";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SNAPSHOT_TIMEOUT = { timeout: 180_000, intervals: [1_000, 2_000] };
const strings = en.selfAssessment;
const table = en.research.table;
const LTIFR = "LTIFR (lost time injury frequency rate)";
const TRIFR = "TRIFR (total recordable injury frequency rate)";
const ACCIDENT_RATE = "Accident rate per 1 000 FTE";

test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");
test.describe.configure({ timeout: 300_000 });

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

function cell(page: Page, kpi: string, year: number) {
  return page.locator(`[data-kpi="${kpi}"] [data-year="${year}"]`);
}

async function screenshot(page: Page, name: string) {
  const prefix = process.env.SELF_ASSESSMENT_SCREENSHOT;
  if (prefix) await page.screenshot({ path: `${prefix}-${name}.png`, fullPage: true });
}

test("a client prefills from research, saves and corrects figures, sees them in the table and clears one", async ({
  page,
}) => {
  const email = uniqueEmail("self-assessment");
  try {
    await signInFresh(page, email, "Self Assessment AG");
    const account = await accountByEmail(email);
    const organizationId = account?.organization?.id;
    const userId = account?.user.id;
    if (!organizationId || !userId) throw new Error("the sign in created no organization");
    const { companyId, runId } = await seedResearchedCompany({
      organizationId,
      userId,
      name: "Self Assessment AG",
    });
    const seed = { organizationId, companyId, runId };
    await seedCompanyKpi({ ...seed, kpiKey: "ltifr", periodYear: 2024, value: 2.4 });
    await seedCompanyKpi({
      ...seed,
      kpiKey: "ltifr",
      periodYear: 2023,
      value: 3.1,
      confidence: 0.5,
    });
    await seedCompanyKpi({
      ...seed,
      kpiKey: "accident_rate_per_1000_fte",
      periodYear: 2024,
      value: 68,
    });

    await page.goto("/en/app");
    await expect(page.getByRole("heading", { level: 1, name: "Self Assessment AG" })).toBeVisible();

    // The section (AC-1): after the KPI table, before the source list, with its own heading.
    const section = page.locator("[data-self-assessment]");
    await expect(section.getByRole("heading", { level: 2, name: strings.heading })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const kpis = document.querySelector('section[aria-labelledby="kpis-heading"]');
        return kpis?.nextElementSibling?.hasAttribute("data-self-assessment") ?? false;
      }),
    ).toBe(true);

    // The prefill (AC-2, AC-3): the newest year on file, the research values, the captions.
    const form = section.locator("[data-kpi-form]");
    const yearPicker = section.getByRole("combobox", { name: strings.year });
    await expect(yearPicker).toHaveText("2024");
    const ltifr = section.getByRole("textbox", { name: LTIFR });
    await expect(ltifr).toHaveValue("2.4");
    await expect(section.locator('[data-kpi-field="ltifr"] [data-source-caption]')).toHaveText(
      strings.source.research,
    );
    const trifr = section.getByRole("textbox", { name: TRIFR });
    await expect(trifr).toHaveValue("");
    await expect(section.locator('[data-kpi-field="trifr"] [data-source-caption]')).toHaveText(
      strings.source.none,
    );
    await expect(
      section.getByRole("button", { name: strings.clear.replace("{kpi}", LTIFR) }),
    ).toHaveCount(0);
    await expect(section.locator("[data-older-year-hint]")).toHaveCount(0);
    await expect(cell(page, "ltifr", 2024).locator("[data-confidence]")).toBeVisible();
    await screenshot(page, "prefilled");
    await expectNoAxeViolations(page);

    // A comma decimal on a missing KPI (AC-4, AC-5, AC-8): saved, badge in the table.
    await trifr.fill("6,1");
    await section.getByRole("button", { name: strings.submit }).click();
    await expect(form.locator("[data-kpis-saved]")).toHaveText(strings.saved);
    if (workerRunning) {
      await expect(form.locator("[data-kpis-saved]")).toHaveAttribute("data-kpis-saved", "true");
    }
    await expect(cell(page, "trifr", 2024)).toContainText("6.10");
    await expect(cell(page, "trifr", 2024).locator('[data-source="client"]')).toHaveText(
      table.clientValue,
    );
    await expect(section.locator('[data-kpi-field="trifr"] [data-source-caption]')).toHaveText(
      strings.source.client,
    );
    await expect(
      section.getByRole("button", { name: strings.clear.replace("{kpi}", TRIFR) }),
    ).toBeVisible();

    // A correction of a research value (AC-5, AC-8): the client badge replaces the confidence.
    await ltifr.fill("2,9");
    await section.getByRole("button", { name: strings.submit }).click();
    await expect(cell(page, "ltifr", 2024)).toContainText("2.90");
    await expect(cell(page, "ltifr", 2024).locator('[data-source="client"]')).toBeVisible();
    await expect(cell(page, "ltifr", 2024).locator("[data-confidence]")).toHaveCount(0);
    await screenshot(page, "saved");

    // The stored rows (AC-5): two client rows, the research rows untouched.
    const db = serviceClient();
    const { data: clientRows } = await db
      .from("company_kpis")
      .select("kpi_key, period_year, value, source, confidence, research_run_id, created_by")
      .eq("company_id", companyId)
      .eq("source", "client")
      .order("kpi_key");
    expect(clientRows).toEqual([
      expect.objectContaining({
        kpi_key: "ltifr",
        period_year: 2024,
        value: 2.9,
        confidence: null,
        research_run_id: null,
        created_by: userId,
      }),
      expect.objectContaining({ kpi_key: "trifr", period_year: 2024, value: 6.1 }),
    ]);

    // The benchmark (AC-9): a client_edit snapshot lands and the segment shows it.
    if (workerRunning) {
      await expect
        .poll(async () => {
          const { count } = await db
            .from("benchmark_snapshots")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .eq("trigger_kind", "client_edit");
          return count ?? 0;
        }, SNAPSHOT_TIMEOUT)
        .toBeGreaterThan(0);
      await expect
        .poll(
          () => page.locator("[data-benchmark-state]").getAttribute("data-benchmark-state"),
          SNAPSHOT_TIMEOUT,
        )
        .toBe("ready");
    }

    // Clearing (AC-6, AC-7): the research value and its confidence are back.
    await section.getByRole("button", { name: strings.clear.replace("{kpi}", LTIFR) }).click();
    await expect(form.locator("[data-kpi-cleared]")).toHaveText(strings.cleared);
    await expect(cell(page, "ltifr", 2024)).toContainText("2.40");
    await expect(cell(page, "ltifr", 2024).locator("[data-confidence]")).toBeVisible();
    await expect(
      section.getByRole("button", { name: strings.clear.replace("{kpi}", LTIFR) }),
    ).toHaveCount(0);
    await expect(section.locator('[data-kpi-field="ltifr"] [data-source-caption]')).toHaveText(
      strings.source.research,
    );

    // An older year (AC-2, AC-7): the fields refill and the hint names the KPIs with a newer value.
    await yearPicker.click();
    await page.getByRole("option", { name: "2023" }).click();
    await expect(yearPicker).toHaveText("2023");
    await expect(ltifr).toHaveValue("3.1");
    await expect(trifr).toHaveValue("");
    const hint = section.locator("[data-older-year-hint]");
    await expect(hint).toContainText(strings.olderYearIntro);
    await expect(hint).toContainText(TRIFR);
    await expect(hint).toContainText(ACCIDENT_RATE);
    await expect(hint).toContainText("2024");
    await screenshot(page, "older-year");
    await expectNoAxeViolations(page);
  } finally {
    await deleteAccount(email);
  }
});

test("in the failed state the card follows the alert and a figure still saves", async ({
  page,
}) => {
  const email = uniqueEmail("self-assessment-failed");
  try {
    await signInFresh(page, email, "Failed Run AG");
    const account = await accountByEmail(email);
    const organizationId = account?.organization?.id;
    const userId = account?.user.id;
    if (!organizationId || !userId) throw new Error("the sign in created no organization");
    await seedResearchedCompany({
      organizationId,
      userId,
      name: "Failed Run AG",
      status: "failed",
    });

    await page.goto("/en/app");
    await expect(page.getByRole("heading", { level: 1, name: "Failed Run AG" })).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: en.research.failed.title }),
    ).toBeVisible();
    // The section (AC-1): no table in this state, so it follows the failed alert.
    expect(
      await page.evaluate(() => {
        const alerts = [...document.querySelectorAll('[role="alert"]')];
        const failed = alerts.find((node) => node.textContent?.includes("The research failed"));
        return failed?.nextElementSibling?.hasAttribute("data-self-assessment") ?? false;
      }),
    ).toBe(true);
    const section = page.locator("[data-self-assessment]");
    // No year on file: the picker defaults to last year (AC-2).
    const lastYear = new Date().getFullYear() - 1;
    await expect(section.getByRole("combobox", { name: strings.year })).toHaveText(
      String(lastYear),
    );
    await section.getByRole("combobox", { name: "ISO 45001 certified" }).click();
    await page.getByRole("option", { name: strings.yesNo.yes }).click();
    await section.getByRole("button", { name: strings.submit }).click();
    await expect(section.locator("[data-kpis-saved]")).toBeVisible();
    await expect(
      section.locator('[data-kpi-field="iso_45001_certified"] [data-source-caption]'),
    ).toHaveText(strings.source.client);
    await expectNoAxeViolations(page);
  } finally {
    await deleteAccount(email);
  }
});
