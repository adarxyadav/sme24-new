import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { MARKETING_ROUTES } from "../src/i18n/pathnames";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * Localization (spec 0004, AC-1, AC-2, AC-11): English coverage with axe on every public page,
 * the query keeping switch, the signed in switch that persists, one CHF amount in the real browser
 * and the `/de-CH` guard. The signed in checks need the seeded ops user (E2E_SEED_PASSWORD).
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const route of [...MARKETING_ROUTES, "/sign-in"]) {
  test(`/en${route === "/" ? "" : route} renders in English without WCAG 2.2 AA violations (AC-11)`, async ({
    page,
  }) => {
    await page.goto(`/en${route === "/" ? "" : route}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-CH");
    await expect(page.getByRole("main")).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the marketing switcher keeps the query string (AC-2, AC-11)", async ({ page }) => {
  await page.goto("/de?x=1");
  await page
    .getByRole("navigation", { name: /sprache/i })
    .getByRole("link", { name: "English" })
    .click();
  await expect(page).toHaveURL(/\/en\?x=1$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-CH");
  await page
    .getByRole("navigation", { name: /language/i })
    .getByRole("link", { name: "Deutsch" })
    .click();
  await expect(page).toHaveURL(/\/de\?x=1$/);
});

test("/de-CH is not a second copy of the site: it ends on /de/de-CH with a 404 (AC-1, AC-11)", async ({
  page,
}) => {
  const response = await page.goto("/de-CH");
  await expect(page).toHaveURL(/\/de\/de-CH$/);
  expect(response?.status()).toBe(404);
});

test("the /de landing page ships the shared namespaces only, not the gallery (AC-6)", async ({
  request,
}) => {
  const html = await (await request.get("/de")).text();
  expect(html).toContain("Anmelden");
  expect(html).not.toContain("Jedes Grundelement in jedem Zustand");
});

test.describe("signed in", () => {
  test.skip(!seedPassword, "E2E_SEED_PASSWORD is not set; seeded users are unavailable");

  test("the sidebar menu switches the language, keeps the path and remembers it after a reload (AC-2, AC-11)", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.ops);
    await expect(page).toHaveURL(/\/de\/admin$/);

    await page.getByRole("button", { name: "Benutzermenü" }).click();
    await page.getByRole("menuitem", { name: /Sprache/ }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-CH");

    await page.reload();
    await page.getByRole("button", { name: "User menu" }).click();
    await expect(page.getByRole("menuitem", { name: /Language/ })).toContainText("English");

    // Back to German so the other suites, which sign in through /de, find the seeded state.
    await page.getByRole("menuitem", { name: /Language/ }).click();
    await page.getByRole("menuitemradio", { name: "Deutsch" }).click();
    await expect(page).toHaveURL(/\/de\/admin$/);
  });

  test("the gallery shows CHF 4’900.00 for 4900 in the real browser (AC-3, AC-11)", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.ops);
    await page.goto("/en/admin/design");
    await expect(page.locator("[data-format=chf]")).toHaveText("CHF 4’900.00");
    await page.goto("/de/admin/design");
    await expect(page.locator("[data-format=chf]")).toHaveText("CHF 4’900.00");
    await expect(page.locator("[data-format=dateLong]")).toHaveText("4. September 2026");
  });
});
