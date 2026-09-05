import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { accountByEmail, dbAvailable, deleteAccount } from "./db";
import { SEED_USERS } from "./helpers";
import {
  confirmLink,
  linkPath,
  mailAvailable,
  mailIds,
  noMailFor,
  readMail,
  uniqueEmail,
} from "./mail";

/**
 * Auth flows (spec 0005). The email dependent tests read Mailpit and assert rows through the
 * secret key, so they run only against the local stack and skip on a deployment.
 */
const localOnly = !mailAvailable || !dbAvailable;

test.describe("sign up with a password (AC-1, AC-11, AC-12, AC-13)", () => {
  test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");

  test("confirms through the emailed link in a fresh browser and lands on /app with an organization", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("signup");
    try {
      await page.goto("/de/sign-up");
      await page.getByLabel("Vor- und Nachname").fill("Tina Test");
      await page.getByLabel("Unternehmen").fill("Test AG");
      await page.getByLabel("Geschäftliche E-Mail").fill(email);
      await page.getByLabel("Passwort", { exact: true }).fill("korrekt-pferd-batterie");
      await page.getByLabel(/Nutzungsbedingungen/).check();
      await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
      await expect(page.getByText("Prüfen Sie Ihren Posteingang")).toBeVisible();

      const mail = await readMail(email);
      // German above English (spec 0005, templates).
      expect(mail.html).toMatch(/Bestätigen Sie Ihre E-Mail[\s\S]*Confirm your email/);
      const link = confirmLink(mail);
      expect(link).toContain("type=signup");
      expect(decodeURIComponent(link)).toContain("/de/app");

      // The link is verified by its token hash, so any browser works: a fresh context here.
      const context = await browser.newContext();
      const fresh = await context.newPage();
      await fresh.goto(linkPath(link));
      await expect(fresh).toHaveURL(/\/de\/app$/);
      await expect(fresh.getByRole("heading", { level: 1 })).toBeVisible();

      const account = await accountByEmail(email);
      expect(account?.profile?.role).toBe("client");
      expect(account?.profile?.full_name).toBe("Tina Test");
      expect(account?.profile?.locale).toBe("de");
      expect(account?.profile?.terms_accepted_at).toBeTruthy();
      expect(account?.organization?.name).toBe("Test AG");
      expect(account?.memberships).toEqual([
        { organization_id: account?.organization?.id, role: "owner" },
      ]);

      // A used link lands on sign in with the expired state and a resend button (AC-12).
      await context.clearCookies();
      await fresh.goto(linkPath(link));
      await expect(fresh).toHaveURL(/\/de\/sign-in\?error=link_expired&type=signup$/);
      await expect(fresh.getByText("abgelaufen oder wurde schon verwendet")).toBeVisible();
      await expect(fresh.getByRole("button", { name: "Neue E-Mail senden" })).toBeVisible();
      await context.close();
    } finally {
      await deleteAccount(email);
    }
  });

  test("an existing email shows the inbox state and sends nothing to the existing account", async ({
    page,
  }) => {
    const seen = await mailIds(SEED_USERS.client);
    await page.goto("/en/sign-up");
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByLabel("Company").fill("Impostor Ltd");
    await page.getByLabel("Work email").fill(SEED_USERS.client);
    await page.getByLabel("Password", { exact: true }).fill("another-password-8");
    await page.getByLabel(/terms of use/).check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    expect(await noMailFor(SEED_USERS.client, seen)).toBe(true);
  });
});

test.describe("auth pages render in both languages without axe violations (AC-13)", () => {
  for (const path of ["/de/sign-up", "/en/sign-up", "/de/sign-in", "/en/sign-in"]) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
