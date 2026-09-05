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

/** `CHF 4’900.00` with either grouping apostrophe (ICU version) and the no break space after CHF. */
const CHF_4900 = /^CHF\s4[’']900\.00$/;

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
  });

  test("the gallery form shows its errors in the page language: built in and custom (AC-8)", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.ops);
    await page.goto("/de/admin/design");
    const form = page.getByRole("region", { name: "Formulare" }).locator("form");
    await form.getByRole("button", { name: "Absenden" }).click();
    await expect(form.locator("#demo-company-error")).toHaveText(
      "Bitte geben Sie mindestens 2 Zeichen ein.",
    );
    await expect(form.locator("#demo-email-error")).toHaveText(/E-Mail/);

    await page.goto("/en/admin/design");
    const formEn = page.getByRole("region", { name: "Forms" }).locator("form");
    await formEn.getByRole("button", { name: "Submit" }).click();
    await expect(formEn.locator("#demo-company-error")).toHaveText(
      "Please enter at least 2 characters.",
    );
    await expect(formEn.locator("#demo-email-error")).toHaveText(/email/i);
  });

  test("the gallery shows CHF 4’900.00 for 4900 in the real browser (AC-3, AC-11)", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.ops);
    await page.goto("/en/admin/design");
    // The grouping apostrophe is U+2019 or U+0027 depending on the server's ICU version, and the
    // space after CHF is a no break space; a regex skips Playwright's whitespace normalisation.
    await expect(page.locator("[data-format=chf]")).toHaveText(CHF_4900);
    await page.goto("/de/admin/design");
    await expect(page.locator("[data-format=chf]")).toHaveText(CHF_4900);
    await expect(page.locator("[data-format=dateLong]")).toHaveText("4. September 2026");
  });
});
