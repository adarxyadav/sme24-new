import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { HOUSE_ORGANIZATION_ID } from "../src/features/peers/catalogue";
import { createConfirmedClient, dbAvailable, deleteAccount, serviceClient } from "./db";
import { seedPassword, signIn } from "./helpers";
import { uniqueEmail } from "./mail";

/**
 * The named peer thread on a client dashboard (spec 0012, AC-8, AC-9, AC-12, AC-13, AC-16,
 * AC-18): five approved peers of section C and band 250+ carry distinct accident rates, and a
 * fresh client's fixture research (NOGA 23.61, 420 employees, rate 68, the same band) computes a
 * version 2 snapshot whose accident rate carries a peer set of five; the dashboard renders the
 * dot strip with the percentile, the disclosure names the five peers with their sources and
 * dates, and the yes or no KPI gets no set. axe runs on the ready state.
 *
 * The peers' KPI rows are seeded rather than researched: the fixture provider answers every
 * company with the same UID and the same values, so five fixture runs in one organization
 * collide on the companies UID index and would give five identical peers. `e2e/peers.spec.ts`
 * covers the ops research path on one peer; this spec covers what the client then sees.
 */
const workerRunning = process.env.TRIGGER_DEV_RUNNING === "1";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const RUN_TIMEOUT = { timeout: 240_000, intervals: [2_000, 5_000] };
const PASSWORD = "korrekt-pferd-batterie";
const STAMP = Date.now();
const PEER_NAMES = [1, 2, 3, 4, 5].map((n) => `Peer Set Fixture ${n} ${STAMP}`);

test.skip(!seedPassword || !dbAvailable, "needs E2E_SEED_PASSWORD and the local stack's keys");
test.skip(
  !workerRunning,
  "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs in fixture mode",
);
test.describe.configure({ timeout: 900_000 });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

/** The peers' accident rates: the client's 68 beats Peer D and Peer E, ties none, so 40 %. */
const PEER_RATES = [40, 52, 61, 74, 88];
const PERCENTILE = "40";
const RESEARCHED_AT = "2026-03-02T09:00:00.000Z";

/**
 * Five approved peers of section C and band 250+ with one accident rate row each, inserted as
 * the service role with fixed labels and a research date, so the snapshot has a real peer set to
 * compare against.
 */
async function seedApprovedPeers() {
  const supabase = serviceClient();
  for (const [index, name] of PEER_NAMES.entries()) {
    const { data: company, error } = await supabase
      .from("companies")
      .insert({
        organization_id: HOUSE_ORGANIZATION_ID,
        name,
        legal_name: `${name} AG`,
        website: `https://peer-${index + 1}-${STAMP}.example`,
        country: "CH",
        industry_code: "23.61",
        employees_count: 900,
        is_peer: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: peerError } = await supabase.from("peer_companies").insert({
      company_id: company.id,
      industry_section: "C",
      size_band: "250+",
      status: "approved",
      display_label: `Peer ${String.fromCharCode(65 + index)}`,
      proposed_by: "ops",
      approved_at: new Date().toISOString(),
      researched_at: RESEARCHED_AT,
    });
    if (peerError) throw peerError;
    const { error: kpiError } = await supabase.from("company_kpis").insert({
      organization_id: HOUSE_ORGANIZATION_ID,
      company_id: company.id,
      kpi_key: "accident_rate_per_1000_fte",
      period_year: 2025,
      value: PEER_RATES[index] as number,
      source: "research",
      confidence: 0.9,
      sources: [
        {
          url: `https://peer-${index + 1}-${STAMP}.example/report`,
          title: `${name} safety report`,
          excerpt: `Accident rate ${PEER_RATES[index]} per 1 000 FTE.`,
          retrievedAt: RESEARCHED_AT,
        },
      ],
    });
    if (kpiError) throw kpiError;
  }
}

async function removePeers() {
  const supabase = serviceClient();
  const { error } = await supabase
    .from("companies")
    .delete()
    .eq("organization_id", HOUSE_ORGANIZATION_ID)
    .in("name", PEER_NAMES);
  if (error) throw error;
}

test("five researched peers give a fresh client a dot strip, a percentile and a named disclosure", async ({
  browser,
  page,
}) => {
  const email = uniqueEmail("peer-benchmark");
  try {
    await seedApprovedPeers();
    const supabase = serviceClient();

    // Ops see the five approved peers with their labels and research dates.
    await signIn(page, "ops@example.com");
    await page.goto("/en/admin/peers?section=C&sizeBand=250%2B&status=approved");
    for (const name of PEER_NAMES) {
      await expect(page.locator("[data-peer-id]", { hasText: name })).toHaveAttribute(
        "data-peer-status",
        "approved",
      );
    }
    await expectNoAxeViolations(page);

    // A fresh client in the same section and band researches and gets a version 2 snapshot.
    await createConfirmedClient(email, PASSWORD, "Peer Benchmark Fixture AG");
    const context = await browser.newContext();
    const client = await context.newPage();
    await client.goto("/en/sign-in");
    await client.waitForLoadState("networkidle");
    await client.getByLabel("Email").fill(email);
    await client.getByLabel("Password").fill(PASSWORD);
    await client.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(client).toHaveURL(/\/en\/app$/);
    await client.getByRole("button", { name: "Start research" }).click();
    await expect
      .poll(
        () => client.locator("[data-run-status]").first().getAttribute("data-run-status"),
        RUN_TIMEOUT,
      )
      .toBe("succeeded");
    const segment = client.locator("[data-benchmark-state]");
    await expect
      .poll(() => segment.getAttribute("data-benchmark-state"), RUN_TIMEOUT)
      .toBe("ready");

    const { data: snapshot } = await supabase
      .from("benchmark_snapshots")
      .select("model_version, results")
      .eq(
        "organization_id",
        (
          await supabase
            .from("companies")
            .select("organization_id")
            .eq("name", "Peer Benchmark Fixture AG")
            .single()
        ).data?.organization_id ?? "",
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(snapshot?.model_version).toBe("benchmark-model@2");

    // The accident rate row: five peers, the client's 68 beats the two above it, so 40 %.
    const accident = client.locator("[data-position-kpi='accident_rate_per_1000_fte']");
    await expect(accident).toHaveAttribute("data-peer-set", "5");
    await expect(accident.locator("[data-peer-percentile]")).toHaveAttribute(
      "data-peer-percentile",
      PERCENTILE,
    );
    await expect(accident.locator("[data-slot='peer-dot-strip']")).toHaveAttribute(
      "data-peers",
      "5",
    );
    await expect(accident.getByRole("table")).toContainText("Peer E");
    // The yes or no KPI never gets a set.
    await expect(client.locator("[data-position-kpi='iso_45001_certified']")).toHaveAttribute(
      "data-peer-set",
      "",
    );
    await expectNoAxeViolations(client);

    // The disclosure names the five peers the snapshot used, with their research dates.
    await client.getByRole("button", { name: "How this is calculated" }).click();
    const compared = client.locator("[data-peers-compared]");
    await expect(compared).toHaveAttribute("data-peers-compared", "5");
    for (const name of PEER_NAMES) {
      await expect(compared.getByText(`${name} AG`)).toBeVisible();
    }
    await expect(compared.getByText(/researched on 02\.03\.2026/).first()).toBeVisible();
    await expectNoAxeViolations(client);
    await context.close();
  } finally {
    await removePeers();
    await deleteAccount(email);
  }
});
