import { expect, test } from "@playwright/test";
import { seedPassword, signIn } from "./helpers";

/**
 * Role gate (AC-5) with the seeded users from supabase/seed.sql. Needs E2E_SEED_PASSWORD, so it
 * runs locally and against staging once the seed has been applied there; it skips elsewhere.
 */
test.skip(!seedPassword, "E2E_SEED_PASSWORD is not set; seeded users are unavailable");

test("anonymous visitors are sent to sign in", async ({ page }) => {
  await page.goto("/de/admin");
  await expect(page).toHaveURL(/\/de\/sign-in\?next=%2Fde%2Fadmin$/);
});

test("a client reaches /app but not /expert or /admin", async ({ page }) => {
  await signIn(page, "client@example.com");
  await expect(page).toHaveURL(/\/de\/app$/);
  await page.goto("/de/expert");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
  await page.goto("/de/admin");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
});

test("the second seeded client (own organization) reaches /app as well", async ({ page }) => {
  await signIn(page, "client2@example.com");
  await expect(page).toHaveURL(/\/de\/app$/);
  await page.goto("/de/admin");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
});

test("an expert reaches /expert but not /app or /admin", async ({ page }) => {
  await signIn(page, "expert@example.com");
  await expect(page).toHaveURL(/\/de\/expert$/);
  await page.goto("/de/app");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
  await page.goto("/de/admin");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
});

test("ops reaches /admin and sees the scaffold checks", async ({ page }) => {
  await signIn(page, "ops@example.com");
  await expect(page).toHaveURL(/\/de\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ops Admin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Grundgerüst prüfen" })).toBeVisible();
  await page.goto("/de/app");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
});

test("a wrong password is rejected", async ({ page }) => {
  await page.goto("/de/sign-in");
  await page.getByLabel("E-Mail").fill("ops@example.com");
  await page.getByLabel("Passwort").fill("definitely-wrong");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
