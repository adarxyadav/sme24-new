import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { HOUSE_ORGANIZATION_ID } from "../src/features/peers/catalogue";
import { dbAvailable, serviceClient } from "./db";
import { seedPassword, signIn } from "./helpers";

/**
 * The peer thread on `/admin/peers` (spec 0012, AC-1, AC-3, AC-4, AC-7, AC-12): ops add a peer by
 * hand, approve it (it becomes Peer A of its section and band), and start its research with the
 * explicit confirm; the run row lands in the house organization. With the worker running in
 * fixture mode (`TRIGGER_DEV_RUNNING=1`) the run ends `succeeded`, the peer's KPI rows exist and
 * `researched_at` is stamped by the database. axe runs on the list. Needs the seeded ops user and
 * the local stack; it skips elsewhere. Every fixture is removed at the end, so `pnpm test:db`
 * finds only the seed afterwards.
 */
const workerRunning = process.env.TRIGGER_DEV_RUNNING === "1";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const RUN_TIMEOUT = { timeout: 180_000, intervals: [1_000, 2_000] };
const PEER_NAME = `Peer Fixture ${Date.now()}`;

test.skip(!seedPassword || !dbAvailable, "needs E2E_SEED_PASSWORD and the local stack's keys");
test.describe.configure({ timeout: 400_000 });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

async function removePeer(name: string) {
  const supabase = serviceClient();
  const { error } = await supabase
    .from("companies")
    .delete()
    .eq("organization_id", HOUSE_ORGANIZATION_ID)
    .eq("name", name);
  if (error) throw error;
}

test("ops add a peer by hand, approve it and start its research with a confirm", async ({
  page,
}) => {
  try {
    await signIn(page, "ops@example.com");
    await page.goto("/en/admin/peers");
    await expect(page.getByRole("heading", { level: 1, name: "Peer companies" })).toBeVisible();
    await expectNoAxeViolations(page);

    // Add by hand: section F (construction), band 1 to 49.
    const form = page.locator("[data-add-peer-form]");
    await form.getByLabel("Company name").fill(PEER_NAME);
    await form.getByLabel("Legal name").fill(`${PEER_NAME} AG`);
    await form.getByLabel("Website").fill("peer-fixture.example");
    await form.getByLabel("Industry section").click();
    await page.getByRole("option", { name: /^F · Construction/ }).click();
    await form.getByRole("button", { name: "Add peer" }).click();
    await expect(page.getByText("Peer added as proposed.")).toBeVisible();

    const row = page.locator(`[data-peer-id]`, { hasText: PEER_NAME });
    await expect(row).toHaveAttribute("data-peer-status", "proposed", { timeout: 20_000 });
    await expect(row.locator("[data-status='proposed']")).toBeVisible();

    // Approve: the first peer of F · 1 to 49 takes Peer A (the test cleans up, so the slot is free).
    await row.locator("[data-action='approve']").click();
    await expect(page.getByText("Approved as Peer A.")).toBeVisible();
    await expect(row).toHaveAttribute("data-peer-status", "approved", { timeout: 20_000 });
    await expect(row).toHaveAttribute("data-peer-label", "Peer A");
    // The toast fades out over a few seconds; axe measures contrast mid animation otherwise.
    await expect(page.getByText("Approved as Peer A.")).toBeHidden({ timeout: 15_000 });
    await expectNoAxeViolations(page);

    // The client can now read the approved peer's company row through the widened policy.
    const supabase = serviceClient();
    const { data: company } = await supabase
      .from("companies")
      .select("id, is_peer, organization_id")
      .eq("organization_id", HOUSE_ORGANIZATION_ID)
      .eq("name", PEER_NAME)
      .single();
    expect(company?.is_peer).toBe(true);

    // Research: select the row, confirm the count, one run row lands in the house organization.
    await row.getByRole("checkbox").check();
    await page.locator("[data-research-selected]").click();
    const dialog = page.locator("[data-research-dialog]");
    await expect(dialog.getByRole("heading", { name: "Start 1 research run?" })).toBeVisible();
    await expect(dialog.getByText(PEER_NAME)).toBeVisible();
    await dialog.locator("[data-research-confirm]").click();
    await expect(page.getByText(/1 run started/)).toBeVisible({ timeout: 30_000 });
    const { data: runs } = await supabase
      .from("research_runs")
      .select("id, status, organization_id")
      .eq("company_id", company?.id ?? "");
    expect(runs?.length).toBe(1);
    expect(runs?.[0]?.organization_id).toBe(HOUSE_ORGANIZATION_ID);

    // A second batch while the run is open is skipped, not doubled.
    await page.reload();
    const openRow = page.locator(`[data-peer-id]`, { hasText: PEER_NAME });
    await expect(openRow.getByRole("checkbox")).toHaveCount(0);

    if (!workerRunning) return;
    await expect
      .poll(async () => {
        const { data } = await supabase
          .from("research_runs")
          .select("status")
          .eq("id", runs?.[0]?.id ?? "")
          .single();
        return data?.status;
      }, RUN_TIMEOUT)
      .toMatch(/succeeded|empty/);
    const { data: peer } = await supabase
      .from("peer_companies")
      .select("researched_at, last_run_id, failed_refreshes")
      .eq("company_id", company?.id ?? "")
      .single();
    expect(peer?.researched_at).not.toBeNull();
    expect(peer?.last_run_id).toBe(runs?.[0]?.id);
    expect(peer?.failed_refreshes).toBe(0);
    const { count } = await supabase
      .from("company_kpis")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company?.id ?? "");
    expect(count ?? 0).toBeGreaterThan(0);
    await page.reload();
    const doneRow = page.locator(`[data-peer-id]`, { hasText: PEER_NAME });
    await expect(doneRow.locator("time")).toBeVisible();
  } finally {
    await removePeer(PEER_NAME);
  }
});
