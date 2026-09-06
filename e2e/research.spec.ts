import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURE_SOURCES, FIXTURE_VALUES, fixtureYears } from "../src/lib/research/fixture";
import { createConfirmedClient, dbAvailable, deleteAccount, serviceClient } from "./db";
import { mailAvailable, uniqueEmail } from "./mail";

/**
 * The company lookup and research thread on the fixture provider (spec 0007, AC-3, AC-7, AC-8,
 * AC-12): a fresh client signs in, sees the lookup form with the organization name prefilled,
 * starts the research and watches the run go queued → running. With `TRIGGER_DEV_RUNNING=1`
 * (`pnpm trigger:dev` up next to the local stack) the run finishes on the canned result: the
 * table shows eight KPIs for three years with the fixture values, an `empty` name shows the
 * info alert and the rerun form, a `fail` name shows the failed alert; axe runs on every state.
 * Without the worker only the queued state is asserted; the whole file skips on a deployment.
 */
const localOnly = !mailAvailable || !dbAvailable;
const workerRunning = process.env.TRIGGER_DEV_RUNNING === "1";
const PASSWORD = "korrekt-pferd-batterie";
// The fixture answers in about four seconds; the validation pass adds one Claude call (about 25
// seconds locally with the gateway key), so a run waits well past the default test timeout.
const RUN_TIMEOUT = { timeout: 120_000, intervals: [1_000, 2_000] };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

async function runStatus(page: Page) {
  return page.locator("[data-run-status]").first().getAttribute("data-run-status");
}

test("a client starts the research from the prefilled form and the run is queued", async ({
  page,
}) => {
  const email = uniqueEmail("research");
  try {
    await signInFresh(page, email, "Lookup Fixture AG");
    await expect(page.getByRole("heading", { level: 1, name: "Your company" })).toBeVisible();
    const name = page.getByLabel("Company name");
    await expect(name).toHaveValue("Lookup Fixture AG");
    await expect(page.getByRole("list", { name: "What happens next" })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByLabel("Website (optional)").fill("Example.ch/reports?x=1");
    await page.getByRole("button", { name: "Start research" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Lookup Fixture AG" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("[data-run-status]").first()).toBeVisible();
    expect(["queued", "running", "succeeded"]).toContain(await runStatus(page));
    await expect(page.getByText("4 of 5 runs left today")).toBeVisible();
    await expectNoAxeViolations(page);

    const db = serviceClient();
    const { data: company } = await db
      .from("companies")
      .select("website, country")
      .eq("name", "Lookup Fixture AG")
      .maybeSingle();
    expect(company).toEqual({ website: "https://example.ch", country: "CH" });

    test.skip(!workerRunning, "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs");
    await expect.poll(() => runStatus(page), RUN_TIMEOUT).toBe("succeeded");
    await expect(page.getByRole("heading", { level: 2, name: "Safety KPIs" })).toBeVisible();
    await expect(page.locator("[data-coverage]")).toHaveAttribute("data-coverage", "8");
    const years = fixtureYears();
    for (const year of years) {
      await expect(page.getByRole("columnheader", { name: String(year) })).toBeVisible();
    }
    const ltifr = page.locator('tr[data-kpi="ltifr"] [data-year]').first();
    await expect(ltifr.locator("[data-value]")).toHaveAttribute(
      "data-value",
      String(FIXTURE_VALUES.ltifr),
    );
    await expect(ltifr.locator("[data-confidence]")).toHaveAttribute("data-confidence", "high");
    await expect(
      page.locator('tr[data-kpi="iso_45001_certified"] [data-value]').first(),
    ).toHaveText("Yes");
    await expect(page.getByRole("heading", { level: 2, name: "Where we looked" })).toBeVisible();
    await expect(page.getByRole("link", { name: FIXTURE_SOURCES[0].title })).toBeVisible();
    await expect(page.locator("[data-sources-found]")).toHaveAttribute(
      "data-sources-found",
      String(FIXTURE_SOURCES.length),
    );
    await ltifr.getByRole("button", { name: /Sources for/ }).click();
    await expect(
      page.getByRole("dialog").getByRole("link", { name: FIXTURE_SOURCES[0].title }),
    ).toHaveAttribute("href", FIXTURE_SOURCES[0].url);
    await page.keyboard.press("Escape");
    await expectNoAxeViolations(page);
  } finally {
    await deleteAccount(email);
  }
});

test("an empty result shows the alert and the rerun form, and the rerun starts a new run", async ({
  page,
}) => {
  test.skip(!workerRunning, "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs");
  const email = uniqueEmail("research-empty");
  try {
    await signInFresh(page, email, "Empty Fixture AG");
    await page.getByRole("button", { name: "Start research" }).click();
    await expect(page.locator("[data-run-status]").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => runStatus(page), RUN_TIMEOUT).toBe("empty");
    await expect(page.getByText("No public disclosures found")).toBeVisible();
    await expect(
      page.getByText("Entering the KPIs by hand arrives with a later feature."),
    ).toBeVisible();
    await expect(page.getByText("4 of 5 runs left today")).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByLabel("Company name").fill("Corrected Fixture AG");
    await page.getByLabel("Legal name (optional)").fill("Corrected Fixture AG");
    await page.getByRole("button", { name: "Research again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Corrected Fixture AG" })).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByText("3 of 5 runs left today")).toBeVisible();
    await expect.poll(() => runStatus(page), RUN_TIMEOUT).toBe("succeeded");
    await expect(page.locator("[data-coverage]")).toHaveAttribute("data-coverage", "8");
    await expectNoAxeViolations(page);
  } finally {
    await deleteAccount(email);
  }
});

test("a provider failure shows the failed alert with its message and the rerun form", async ({
  page,
}) => {
  test.skip(!workerRunning, "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs");
  const email = uniqueEmail("research-fail");
  try {
    await signInFresh(page, email, "Fail Fixture AG");
    await page.getByRole("button", { name: "Start research" }).click();
    await expect(page.locator("[data-run-status]").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => runStatus(page), RUN_TIMEOUT).toBe("failed");
    await expect(page.getByText("The research failed")).toBeVisible();
    await expect(page.getByText(/The research provider was not reachable/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Research again" })).toBeEnabled();
    await expectNoAxeViolations(page);

    const db = serviceClient();
    const { data: run } = await db
      .from("research_runs")
      .select("error_code, finished_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(run?.error_code).toBe("provider_unavailable");
    expect(run?.finished_at).toBeTruthy();
  } finally {
    await deleteAccount(email);
  }
});
