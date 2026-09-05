import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Local runs read .env.local (seed password, Supabase keys for the auth assertions); CI sets its
// own variables and has no such file, which dotenv treats as a no op.
loadEnv({ path: ".env.local", quiet: true });

// Runs against PLAYWRIGHT_BASE_URL when set (the CI `e2e` job passes the Vercel deployment URL),
// otherwise starts a dev server on its own port so an app already on 3000 is never tested by mistake.
const localPort = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${localPort}`;

// Vercel protects preview deployments with Vercel Authentication; the CI job passes the project's
// "Protection Bypass for Automation" secret so the browser reaches the app instead of the login page.
// The second header asks Vercel to set the bypass cookie, so client side navigations stay bypassed.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders = bypassSecret
  ? { "x-vercel-protection-bypass": bypassSecret, "x-vercel-set-bypass-cookie": "true" }
  : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Locally one dev server and one Docker stack serve every worker: at five workers sign in
  // actions and axe scans time out (measured 2026-09-05), at two the suite passes and is fastest.
  workers: process.env.CI ? undefined : 2,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    extraHTTPHeaders,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Leftovers of an interrupted run (a timeout kills the worker before its cleanup) would trip the
  // pgTAP seed guard; the sweep runs on the local stack only and is a no op elsewhere.
  globalSetup: "./e2e/sweep.ts",
  globalTeardown: "./e2e/sweep.ts",
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm dev --port ${localPort}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
