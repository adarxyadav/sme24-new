import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { FIXTURE_VALUES, fixturePeerYear } from "../src/lib/research/fixture";
import {
  accountByEmail,
  createConfirmedClient,
  dbAvailable,
  deleteAccount,
  serviceClient,
} from "./db";
import { mailAvailable, uniqueEmail } from "./mail";

/**
 * The peer benchmark thread on the fixture research run (spec 0022, AC-28): a fresh client picks a
 * country, starts the research, and the local worker (`pnpm trigger:dev` in fixture mode,
 * `TRIGGER_DEV_RUNNING=1`) walks the whole chain — the client run, the peer search, the code
 * conversion and the rung, then `benchmark-company` writing a `benchmark-model@7` snapshot. The
 * page is then asserted section by section in the order AC-20 to AC-23 fixes: the one peer table
 * with the five country rung peers and the client's own row in place, the sentence carrying both
 * ranks, the loss card in CHF, the three seeded experts and the recommended package. Axe runs on
 * every state.
 *
 * Without the worker only the queued state is asserted (the first test); the file skips on a
 * deployment, since the fixture provider and the seeded experts are local facts.
 */
const localOnly = !mailAvailable || !dbAvailable;
const workerRunning = process.env.TRIGGER_DEV_RUNNING === "1";
const PASSWORD = "korrekt-pferd-batterie";
// Two provider runs (the client search and the peer search) plus two Claude calls, then the
// benchmark task: the whole chain runs well past the default test timeout.
const RUN_TIMEOUT = { timeout: 240_000, intervals: [1_000, 2_000] };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * What the fixture makes true, so the assertions below read as arithmetic rather than as magic
 * numbers. The client is 420 employees in NOGA 23.61 (section C) in CH, LTIFR 2.4 and TRIFR 6.1
 * for the latest fixture year. The peer search answers eight companies, five of them in CH, so the
 * rung is `country` and those five are the whole peer set (AC-7, AC-11). Their printed rates are
 * converted in code (AC-8): per 200 000 hours and per 100 workers both times five.
 */
const FTE = 420;
const COUNTRY_PEER_LTIFR = [3.1, 0.9 * 5, 5.6, 1.4 * 5, 4.2];
const COUNTRY_PEER_TRIFR = [7.4, 2.2 * 5, 11.8, 2.6 * 5];
const PEER_COUNT = COUNTRY_PEER_LTIFR.length;

/** The owner's loss table (AC-14), repeated here so a constant change fails this spec too. */
const HOURS_PER_FTE = 1800;
const HOURS_PER_LTI = 769;
const HOURS_PER_RECORDABLE = 201;
const HOURLY_COST = 75;

function lossOf(ltifr: number, trifr: number, fte: number): number {
  const exposure = (rate: number) => (rate * fte * HOURS_PER_FTE) / 1_000_000;
  const ltis = exposure(ltifr);
  const recordables = exposure(Math.max(0, trifr - ltifr));
  return (ltis * HOURS_PER_LTI + recordables * HOURS_PER_RECORDABLE) * HOURLY_COST;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Rounds as `roundMoney` does (AC-14): nearest 100 below 10 000, else nearest 1 000. */
function roundMoney(value: number): number {
  const step = Math.abs(value) < 10_000 ? 100 : 1_000;
  return Math.round(value / step) * step;
}

/** The client's own loss, the headline of the loss card. */
const CLIENT_LOSS = lossOf(FIXTURE_VALUES.ltifr, FIXTURE_VALUES.trifr, FTE);
/** The same formula at each rate's peer median, fatalities held at zero (AC-14). */
const AT_MEDIAN = lossOf(medianOf(COUNTRY_PEER_LTIFR), medianOf(COUNTRY_PEER_TRIFR), FTE);
const AT_BEST = lossOf(Math.min(...COUNTRY_PEER_LTIFR), Math.min(...COUNTRY_PEER_TRIFR), FTE);

/**
 * A rounded amount as the page prints it in de-CH's sibling `en-CH`, whose group separator is the
 * apostrophe the ICU data carries. The test matches on the digits with any separator between them,
 * because a formatted 4+ digit number is exactly where Node and the browser have disagreed before
 * (the hydration trap in `docs/design.md`), and a spec that pins one spelling would fail on the
 * other for a reason that has nothing to do with the benchmark.
 */
function amountPattern(value: number): RegExp {
  const digits = String(Math.round(Math.abs(value)));
  return new RegExp([...digits].join("\\D?"));
}

test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");
test.describe.configure({ timeout: 600_000 });

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

/**
 * Starts the research from the lookup form. The country is required since spec 0022 (AC-1) and has
 * no default, so it is picked here on every run: a company is never created as Swiss by omission.
 */
async function startResearch(page: Page, country: string) {
  // The lookup form's own select by id: the rerun form carries a second one with the same label,
  // so a label lookup is ambiguous on any page that offers both.
  await page.locator("#company-country").click();
  await page.getByRole("option", { name: country, exact: true }).click();
  await page.getByRole("button", { name: "Start research" }).click();
}

test("the lookup form requires a country and the run is queued", async ({ page }) => {
  const email = uniqueEmail("benchmark-queued");
  try {
    await signInFresh(page, email, "Benchmark Queued AG");
    await expect(page.getByRole("heading", { level: 1, name: "Your company" })).toBeVisible();

    // The country carries no default (AC-1), so submitting without one is refused and nothing is
    // queued; this is the guard that keeps a non Swiss company from being researched as Swiss.
    await page.getByRole("button", { name: "Start research" }).click();
    await expect(page.locator("#company-country-error")).toBeVisible();
    await expectNoAxeViolations(page);

    await startResearch(page, "Switzerland");
    await expect(page.getByRole("heading", { level: 1, name: "Benchmark Queued AG" })).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(() => page.locator("[data-run-status]").first().getAttribute("data-run-status"), {
        timeout: 20_000,
        intervals: [500],
      })
      .toMatch(/queued|running|succeeded/);
    await expectNoAxeViolations(page);
  } finally {
    await deleteAccount(email);
  }
});

test.describe("through the local worker", () => {
  test.skip(
    !workerRunning,
    "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs in fixture mode",
  );

  test("the fixture run lands on the country rung and the page shows the table, the loss, the experts and the package", async ({
    page,
  }) => {
    const email = uniqueEmail("benchmark");
    try {
      await signInFresh(page, email, "Benchmark Fixture AG");
      await startResearch(page, "Switzerland");
      await expect(
        page.getByRole("heading", { level: 1, name: "Benchmark Fixture AG" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          () => page.locator("[data-run-status]").first().getAttribute("data-run-status"),
          RUN_TIMEOUT,
        )
        .toBe("succeeded");

      // The snapshot lands after the peer task and the benchmark task; the Realtime channel or the
      // poll refreshes the page. `ready` is the only state whose blocks render at all (AC-18).
      const segment = page.locator("[data-benchmark-state]");
      await expect(segment).toBeVisible();
      await expect
        .poll(() => segment.getAttribute("data-benchmark-state"), RUN_TIMEOUT)
        .toBe("ready");

      // ── The peer table, first (AC-20) ────────────────────────────────────────────────────────
      const peersCard = page.locator("[data-peers-card]");
      await expect(peersCard).toBeVisible();
      // Five peers, all Swiss, so the badge names the country rung by its own name.
      await expect(peersCard.locator("[data-peer-count]")).toHaveAttribute(
        "data-peer-count",
        String(PEER_COUNT),
      );
      await expect(peersCard.locator("[data-peer-count]")).toContainText(
        `${PEER_COUNT} peers in Switzerland`,
      );

      // The rank sentence carries both ranks (AC-20). The client's 2.4 is beaten by one peer's 2.4
      // ... no: of the five converted LTIFRs (3.1, 4.5, 5.6, 7.0, 4.2) none is below 2.4, so the
      // client leads on LTIFR; on TRIFR (7.4, 11.0, 11.8, 13.0) its 6.1 leads as well. Both ranks
      // are computed from `peers.rates`, so they are read off the page rather than restated here,
      // and only the shape of the sentence is pinned.
      const rankSentence = peersCard.locator("[data-rank-sentence]");
      await expect(rankSentence).toContainText(
        /You rank \d+ of \d+ on LTIFR and \d+ of \d+ on TRIFR among published peers in .+ in Switzerland\./,
      );
      // The client is one of the compared set, so `of` is the rate's peer count plus one (AC-13).
      await expect(rankSentence).toContainText(`of ${PEER_COUNT + 1} on LTIFR`);
      await expect(rankSentence).toContainText(`of ${COUNTRY_PEER_TRIFR.length + 1} on TRIFR`);

      // One table: the five peers plus the client's own row, highlighted in place by its LTIFR.
      await expect(peersCard.locator("[data-peer]")).toHaveCount(PEER_COUNT);
      const clientRow = peersCard.locator("[data-client-row]");
      await expect(clientRow).toHaveCount(1);
      await expect(clientRow).toContainText("Benchmark Fixture AG");
      await expect(clientRow).toContainText("Your figures");
      await expect(clientRow).toContainText(`${FTE} employees`);
      // Its LTIFR of 2.4 is below every peer's, so the client sorts to the top of the table: the
      // row is placed among the peers by its own rate rather than appended to them (AC-20).
      await expect(peersCard.locator("tbody tr").first()).toHaveAttribute("data-client-row");

      // Every peer row carries a headcount, a year, a converted rate and a source link that opens
      // the page in a new tab. The fixture's per 200 000 hours 0.9 is the conversion of AC-8: it
      // must print as 4.50 and never as 0.90.
      const firstPeer = peersCard.locator("[data-peer]").first();
      await expect(firstPeer).toContainText("Switzerland");
      await expect(firstPeer).toContainText(String(fixturePeerYear()));
      const sourceLink = firstPeer.locator("a");
      await expect(sourceLink).toHaveAttribute("href", /^https:\/\//);
      await expect(sourceLink).toHaveAttribute("target", "_blank");
      await expect(sourceLink).toHaveAttribute("rel", "noopener noreferrer");
      const tableText = (await peersCard.locator("table").textContent()) ?? "";
      expect(tableText).toContain("4.50");
      expect(tableText).toContain("7.00");

      // The footnote, and never the word verified anywhere on the card (AC-20, AC-27).
      await expect(peersCard.locator("[data-peers-footnote]")).toContainText("public reports");
      expect(((await peersCard.textContent()) ?? "").toLowerCase()).not.toContain("verified");

      // ── The estimated loss, second (AC-21) ───────────────────────────────────────────────────
      const lossCard = page.locator("[data-loss-card]");
      await expect(lossCard.locator("[data-loss-headline]")).toContainText(
        amountPattern(roundMoney(CLIENT_LOSS)),
      );
      await expect(lossCard.locator("[data-loss-headline]")).toContainText("CHF");
      // The client is ahead of the peer median on both rates, so there is nothing to save and the
      // card says so rather than printing a zero.
      expect(CLIENT_LOSS).toBeLessThan(AT_MEDIAN);
      expect(CLIENT_LOSS).toBeLessThan(AT_BEST);
      await expect(lossCard).toContainText("You are already at or below the peer figures.");
      // The counts behind it, each with its badge; the hourly cost and the fatality price are
      // never rendered (AC-14, AC-21).
      const ltis = (FIXTURE_VALUES.ltifr * FTE * HOURS_PER_FTE) / 1_000_000;
      await expect(lossCard).toContainText(`${ltis.toFixed(1)} lost time injuries`);
      await expect(lossCard).toContainText("0 fatalities");
      await expect(lossCard.getByText("Calculated").first()).toBeVisible();
      const lossText = (await lossCard.textContent()) ?? "";
      expect(lossText).not.toContain("769");
      expect(lossText).not.toContain("201");
      expect(lossText).not.toMatch(/1.200.000/);

      // ── The experts, third (AC-22) ───────────────────────────────────────────────────────────
      // The three seeded section C experts with `countries = {CH}`, in the order the function
      // orders by: availability, then the longer career first.
      const expertsCard = page.locator("[data-experts-card]");
      const expertCards = expertsCard.locator("ul > li");
      await expect(expertCards).toHaveCount(3);
      await expect(expertsCard).toContainText("Nadja Brunner");
      await expect(expertsCard).toContainText(
        "Our ops team assigns your expert once you have bought a package.",
      );
      // No email, no status and no note reaches the page: the function returns none of them
      // (AC-26), so the card cannot leak one.
      const expertsText = (await expertsCard.textContent()) ?? "";
      expect(expertsText).not.toContain("@example.com");

      // ── The package, fourth (AC-23) ──────────────────────────────────────────────────────────
      // Ahead on both rates with no fatality and a saving of zero: the standing lands on culture.
      const packageCard = page.locator("[data-package-card]");
      await expect(packageCard).toHaveAttribute("data-package", "culture");
      await expect(packageCard.locator("[data-package-reason]")).toContainText(
        "You are ahead of the peer median on both rates.",
      );
      await expect(packageCard.locator("[data-package-price]")).toBeVisible();
      await expect(packageCard.getByRole("link", { name: /^Buy / })).toHaveAttribute(
        "href",
        /checkout/,
      );
      await expect(
        packageCard.getByRole("link", { name: "See all packages and prices" }),
      ).toBeVisible();

      await expectNoAxeViolations(page);

      // ── The stored row (AC-13, AC-16) ────────────────────────────────────────────────────────
      const db = serviceClient();
      const account = await accountByEmail(email);
      const { data: company } = await db
        .from("companies")
        .select("id, country, currency")
        .eq("organization_id", account?.organization?.id ?? "")
        .maybeSingle();
      expect(company?.country).toBe("CH");
      expect(company?.currency).toBe("CHF");

      // The peers of the run are stored once each, per rate, all on the country rung (AC-9, AC-10).
      const { data: peerRows } = await db
        .from("research_peers")
        .select("peer_name, kpi_key, rung, value, source_url")
        .eq("company_id", company?.id ?? "");
      expect(new Set((peerRows ?? []).map((row) => row.peer_name)).size).toBe(PEER_COUNT);
      expect((peerRows ?? []).every((row) => row.rung === "country")).toBe(true);
      expect((peerRows ?? []).every((row) => row.source_url.startsWith("https://"))).toBe(true);

      const { data: snapshot } = await db
        .from("benchmark_snapshots")
        .select(
          "model_version, currency, loss_amount, saving_at_median, kpis_compared, peer_provisional, peers, results, gaps, assumptions",
        )
        .eq("company_id", company?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      expect(snapshot?.model_version).toBe("benchmark-model@7");
      expect(snapshot?.currency).toBe("CHF");
      expect(Number(snapshot?.loss_amount)).toBeCloseTo(CLIENT_LOSS, 0);
      // Ahead of the median on both rates, so the saving is zero rather than null: the peers are
      // present, the formula just has nothing to give back (AC-14).
      expect(Number(snapshot?.saving_at_median)).toBe(0);
      // `@7` compares the rates of `peers.rates` and nothing else, and carries no provisional row.
      expect(snapshot?.kpis_compared).toBe(2);
      expect(snapshot?.peer_provisional).toBe(false);
      // The blocks the rewrite dropped are null from `@7` on (AC-12, AC-16).
      expect(snapshot?.results).toBeNull();
      expect(snapshot?.gaps).toBeNull();
      expect(snapshot?.assumptions).toBeNull();
      const peers = snapshot?.peers as {
        readonly rung: string;
        readonly thin: boolean;
        readonly rows: readonly { readonly estimatedLoss: number | null }[];
      } | null;
      expect(peers?.rung).toBe("country");
      expect(peers?.thin).toBe(false);
      expect(peers?.rows).toHaveLength(PEER_COUNT);
      // Every fixture peer publishes a headcount, so every row prices its own estimated loss.
      expect((peers?.rows ?? []).every((row) => row.estimatedLoss !== null)).toBe(true);
    } finally {
      if (!process.env.BENCHMARK_KEEP_DELIVERIES) {
        await serviceClient().from("email_deliveries").delete().eq("recipient_email", email);
      }
      await deleteAccount(email);
    }
  });

  test("a thin peer run replaces the rank sentence with the count it found", async ({ page }) => {
    const email = uniqueEmail("benchmark-thin");
    try {
      // `thinpeers` in the name gives the fixture two peers, both outside the region, so the ladder
      // falls to the world rung and the run is thin (AC-11).
      await signInFresh(page, email, "Thinpeers Fixture AG");
      await startResearch(page, "Switzerland");
      await expect(
        page.getByRole("heading", { level: 1, name: "Thinpeers Fixture AG" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          () => page.locator("[data-run-status]").first().getAttribute("data-run-status"),
          RUN_TIMEOUT,
        )
        .toBe("succeeded");
      await expect
        .poll(
          () => page.locator("[data-benchmark-state]").getAttribute("data-benchmark-state"),
          RUN_TIMEOUT,
        )
        .toBe("ready");

      const peersCard = page.locator("[data-peers-card]");
      await expect(peersCard.locator("[data-peer-count]")).toHaveAttribute("data-peer-count", "2");
      await expect(peersCard.locator("[data-peer-count]")).toContainText("worldwide");
      // The thin sentence stands in for the ranks entirely: no rank is quoted off two peers.
      await expect(peersCard.locator("[data-rank-sentence]")).toContainText(
        "We found only 2 published peers for your sector.",
      );
      await expect(peersCard.locator("[data-rank-sentence]")).not.toContainText("You rank");
      await expect(peersCard.locator("[data-peer]")).toHaveCount(2);

      const db = serviceClient();
      const account = await accountByEmail(email);
      const { data: company } = await db
        .from("companies")
        .select("id")
        .eq("organization_id", account?.organization?.id ?? "")
        .maybeSingle();
      const { data: snapshot } = await db
        .from("benchmark_snapshots")
        .select("peers")
        .eq("company_id", company?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const peers = snapshot?.peers as { readonly rung: string; readonly thin: boolean } | null;
      expect(peers?.rung).toBe("world");
      expect(peers?.thin).toBe(true);

      await expectNoAxeViolations(page);
    } finally {
      if (!process.env.BENCHMARK_KEEP_DELIVERIES) {
        await serviceClient().from("email_deliveries").delete().eq("recipient_email", email);
      }
      await deleteAccount(email);
    }
  });
});

/**
 * A snapshot written by a model version this code no longer reads (AC-18): the segment shows one
 * sentence and the rerun form, and nothing of the stored row is rendered. Driven by writing a row
 * under an older version directly, which is exactly what a client who researched before the spec
 * 0022 deploy has; no recompute is run on deploy, so this state is reached by real clients.
 */
test("an older snapshot renders the outdated sentence and nothing of the stored row", async ({
  page,
}) => {
  const email = uniqueEmail("benchmark-outdated");
  try {
    await signInFresh(page, email, "Outdated Snapshot AG");
    const account = await accountByEmail(email);
    const organizationId = account?.organization?.id;
    const userId = account?.user.id;
    if (!organizationId || !userId) throw new Error("the sign in created no organization");

    const db = serviceClient();
    const { data: company } = await db
      .from("companies")
      .insert({
        organization_id: organizationId,
        name: "Outdated Snapshot AG",
        created_by: userId,
        industry_code: "23.61",
        employees_count: FTE,
      })
      .select("id")
      .single()
      .throwOnError();
    const { error } = await db.from("benchmark_snapshots").insert({
      organization_id: organizationId,
      company_id: company?.id ?? "",
      trigger_kind: "client_edit",
      model_version: "benchmark-model@5",
      kpis_compared: 1,
      peer_provisional: false,
      inputs: { fte: FTE, section: "C", band: "250+", industryCode: "23.61", kpis: [] },
      results: [],
      gaps: [],
      assumptions: [],
      cost: null,
    });
    if (error) throw error;

    await page.goto("/en/app");
    const segment = page.locator("[data-benchmark-state]");
    await expect(segment).toHaveAttribute("data-benchmark-state", "outdated");
    await expect(segment.locator("[data-outdated]")).toContainText("earlier model");
    // Nothing of the old row: no peer table, no loss card, no package.
    await expect(page.locator("[data-peers-card]")).toHaveCount(0);
    await expect(page.locator("[data-loss-card]")).toHaveCount(0);
    await expect(page.locator("[data-package-card]")).toHaveCount(0);
    // The rerun form is the way out of this state: running the research again is the only thing
    // that replaces the row, since no recompute runs on deploy (AC-18). It carries its own country
    // select, prefilled from the company, so the rerun confirms the country rather than assuming it.
    await expect(page.locator("#rerun-heading")).toContainText(
      "Correct the details and research again",
    );
    await expect(page.locator("#rerun-country")).toBeVisible();
    await expectNoAxeViolations(page);
  } finally {
    await deleteAccount(email);
  }
});
