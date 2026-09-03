import { defineConfig, devices } from "@playwright/test";

// Runs against PLAYWRIGHT_BASE_URL when set (the CI `e2e` job passes the Vercel deployment URL),
// otherwise starts a dev server on its own port so an app already on 3000 is never tested by mistake.
const localPort = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${localPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm dev --port ${localPort}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
