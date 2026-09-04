import type { Page } from "@playwright/test";

/** Password of the seeded users (supabase/seed.sql); tests skip when it is unset. */
export const seedPassword = process.env.E2E_SEED_PASSWORD;

/** Seeded accounts by role (supabase/seed.sql). */
export const SEED_USERS = {
  client: "client@example.com",
  client2: "client2@example.com",
  expert: "expert@example.com",
  ops: "ops@example.com",
} as const;

/** Signs in through the German sign in page with the seeded password (Playwright). */
export async function signIn(page: Page, email: string) {
  await page.goto("/de/sign-in");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(seedPassword as string);
  await page.getByRole("button", { name: "Anmelden" }).click();
  // The server action redirects once the session cookies are set; wait for it before navigating on.
  await page.waitForURL((url) => !url.pathname.endsWith("/sign-in"));
}
