import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  accountByEmail,
  createConfirmedClient,
  dbAvailable,
  deleteAccount,
  seedCompanyKpi,
  seedResearchedCompany,
  serviceClient,
} from "./db";
import { mailAvailable, mailIds, noMailFor, readMail, uniqueEmail } from "./mail";

/**
 * The benchmark thread on the fixture research run (spec 0008, AC-16): a fresh client starts the
 * research, the worker (`pnpm trigger:dev` in fixture mode, `TRIGGER_DEV_RUNNING=1`) ends the run
 * `succeeded` and computes a snapshot from the committed seed, and the dashboard shows the
 * opportunity card, the priority gaps and the positions with deterministic values; axe runs on
 * the ready state. Without the worker the whole file skips; it also skips on a deployment.
 */
const localOnly = !mailAvailable || !dbAvailable;
const workerRunning = process.env.TRIGGER_DEV_RUNNING === "1";
const PASSWORD = "korrekt-pferd-batterie";
const RUN_TIMEOUT = { timeout: 180_000, intervals: [1_000, 2_000] };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// The fixture company: accident rate 68 per 1 000 FTE, 420 employees, lost days 12.5, NOGA 23.61
// (section C). The committed seed holds the section C accident rate quartiles 34.9, 49.9, 66.4
// and the assumptions 4 811 CHF per case, 1 100 CHF per day and the multipliers 2, 3.7 and 5.
const INCIDENTS = (68 * 420) / 1000;
const COST_PER_CASE = 4811 + 12.5 * 1100;
const ANNUAL = INCIDENTS * COST_PER_CASE * 3.7;
const AT_MEDIAN = ((49.9 * 420) / 1000) * COST_PER_CASE * 3.7;
// The derived counts (spec 0012) take the per million hours arm, on the 1 804 hours assumption:
// LTIFR 2.4 drives the lost time count and TRIFR 6.1 the recordable one.
const HOURS_PER_FTE = 1804;
const LOST_TIME = (2.4 * 420 * HOURS_PER_FTE) / 1_000_000;
const RECORDABLE = (6.1 * 420 * HOURS_PER_FTE) / 1_000_000;

test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");
test.skip(
  !workerRunning,
  "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs in fixture mode",
);
test.describe.configure({ timeout: 400_000 });

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

test("the fixture run ends in a snapshot and the dashboard shows the card, the gaps and the positions", async ({
  page,
}) => {
  const email = uniqueEmail("benchmark");
  try {
    await signInFresh(page, email, "Benchmark Fixture AG");
    const seenBefore = await mailIds(email);
    await page.getByRole("button", { name: "Start research" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Benchmark Fixture AG" })).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect
      .poll(
        () => page.locator("[data-run-status]").first().getAttribute("data-run-status"),
        RUN_TIMEOUT,
      )
      .toBe("succeeded");

    // The snapshot lands a few seconds after the run; the Realtime channel or the poll refreshes the page.
    const segment = page.locator("[data-benchmark-state]");
    await expect(segment).toBeVisible();
    await expect
      .poll(() => segment.getAttribute("data-benchmark-state"), RUN_TIMEOUT)
      .toBe("ready");
    await expect(
      page.getByRole("heading", { level: 2, name: "Benchmark and opportunity" }),
    ).toBeVisible();

    // The opportunity card (AC-9 a): rounded headline, range, both savings, the provisional note.
    const card = page.locator("[data-opportunity-card]");
    expect(Number(await card.getAttribute("data-cost"))).toBeCloseTo(ANNUAL, 0);
    await expect(card.locator("[data-cost-headline]")).toContainText(/1.961.000/);
    await expect(card.locator("[data-saving-median]")).toContainText(/522.000/);
    await expect(card.getByText(/Computed on \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
    await expect(card.locator("[data-compared]")).toHaveAttribute("data-compared", "1");
    await expect(card.getByText("1 of 8 KPIs compared")).toBeVisible();
    await expect(page.locator("[data-provisional-note]")).toBeVisible();

    // The derived counts (spec 0012, AC-1, AC-3, AC-4, AC-6): the fixture company carries both
    // LTIFR and TRIFR, so the lost time count comes from LTIFR (the fallback to the Suva accident
    // rate is never reached) and the recordable count comes from TRIFR. Both name their source.
    const derived = card.locator("[data-derived-block]");
    await expect(derived).toBeVisible();
    const lostTime = derived.locator('[data-derived-count="lost-time"]');
    // 1.818 injuries a year, shown to one decimal (AC-8).
    await expect(lostTime.locator("[data-derived-value]")).toHaveText(LOST_TIME.toFixed(1));
    await expect(lostTime.getByText("Calculated", { exact: true })).toBeVisible();
    await expect(lostTime.locator("[data-derived-from]")).toHaveAttribute(
      "data-derived-from",
      "ltifr",
    );
    await expect(lostTime).toContainText("Calculated from the researched LTIFR for");
    const recordable = derived.locator('[data-derived-count="recordable"]');
    // 4.622 injuries a year, shown to one decimal (AC-8).
    await expect(recordable.locator("[data-derived-value]")).toHaveText(RECORDABLE.toFixed(1));
    await expect(recordable.locator("[data-derived-from]")).toHaveAttribute(
      "data-derived-from",
      "trifr",
    );
    await expect(recordable).toContainText("Calculated from the researched TRIFR for");
    // A calculated number never borrows a confidence score (AC-5).
    await expect(derived.locator("[data-confidence]")).toHaveCount(0);

    // The priority gaps (AC-9 b): the accident rate is the only KPI with a peer row in the seed.
    const gaps = page.locator("[data-gaps]");
    await expect(gaps).toHaveAttribute("data-gaps", "1");
    const gap = page.locator('[data-gap="accident_rate_per_1000_fte"]');
    await expect(gap).toHaveAttribute("data-rank", "1");
    await expect(gap.getByText("68.00 vs. median 49.90")).toBeVisible();
    await expect(gap.locator("[data-gap-saving]")).toContainText(/522.000/);

    // The positions (AC-9 c): one row per catalogue KPI, the band on the compared one.
    await expect(page.locator("[data-position-kpi]")).toHaveCount(8);
    const accident = page.locator('[data-position-kpi="accident_rate_per_1000_fte"]');
    await expect(accident).toHaveAttribute("data-position", "bottom_quarter");
    await expect(accident.locator("svg[data-value]")).toHaveAttribute("data-value", "68");
    await expect(accident.getByText("Bottom quarter", { exact: true })).toBeVisible();
    await expect(accident.locator(".sr-only")).toContainText(
      "your value 68.00 is in the band Bottom quarter",
    );
    await expect(
      accident.getByText(/Manufacturing · all sizes · 2022 \(nearest year\)/),
    ).toBeVisible();
    await expect(
      page.locator('[data-position-kpi="ltifr"]').getByText("No peer data yet"),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    // The benchmark ready email (AC-7): one delivery per member on the first snapshot, in the
    // member's language (the fixture client is German). It lands in Mailpit when the worker runs
    // on SMTP; a worker whose Trigger.dev environment carries a Resend key and an allowlist skips
    // the test address instead, so the inbox is asserted only on the SMTP transport.
    const db = serviceClient();
    const account = await accountByEmail(email);
    const { data: companyRow } = await db
      .from("companies")
      .select("id")
      .eq("name", "Benchmark Fixture AG")
      .maybeSingle();
    const deliveryKey = `benchmark-ready/${companyRow?.id}/${account?.user.id}`;
    const delivery = await expect
      .poll(
        async () => {
          const { data } = await db
            .from("email_deliveries")
            .select("status, locale, source_event, template, transport")
            .eq("idempotency_key", deliveryKey)
            .maybeSingle();
          return data && data.status !== "queued" && data.status !== "sending" ? data : null;
        },
        { timeout: 60_000, intervals: [1_000, 2_000] },
      )
      .not.toBeNull()
      .then(async () => {
        const { data } = await db
          .from("email_deliveries")
          .select("status, locale, source_event, template, transport")
          .eq("idempotency_key", deliveryKey)
          .single();
        return data;
      });
    expect(delivery).toMatchObject({
      locale: "de",
      source_event: "benchmark.snapshot_created",
      template: "benchmark_ready",
    });
    expect(["sent", "skipped"]).toContain(delivery?.status);
    if (delivery?.transport === "smtp") {
      const mail = await readMail(email, { seen: seenBefore, timeoutMs: 60_000 });
      expect(mail.subject).toBe("Ihr Benchmark für Benchmark Fixture AG ist bereit");
      expect(mail.html).toMatch(/1.961.000/);
      expect(mail.html).toMatch(/522.000/);
      expect(mail.links.some((link) => link.endsWith("/de/app"))).toBe(true);
    } else {
      console.log(
        `benchmark email not asserted in Mailpit: transport ${delivery?.transport}, status ${delivery?.status}`,
      );
    }
    const seenAfterFirst = await mailIds(email);

    // The disclosure (AC-10): closed by default, the formula, the six assumptions the snapshot used
    // (the fixture has a lost days row and an accident rate, so no default days; the hours are named
    // because the derived counts used them, spec 0012 AC-11), the inputs.
    const disclosure = page.locator("[data-calculation-disclosure]");
    await expect(disclosure.locator("[data-calculation-content]")).toBeHidden();
    await disclosure.getByRole("button", { name: "How this is calculated" }).click();
    const content = disclosure.locator("[data-calculation-content]");
    await expect(content).toBeVisible();
    await expect(content.locator("[data-fte-line]")).toBeVisible();
    await expect(content.locator("[data-assumption]")).toHaveCount(6);
    await expect(content.locator('[data-assumption="direct_cost_per_case_chf"]')).toHaveAttribute(
      "data-assumption-value",
      "4811",
    );
    // The multiplier is a declared assumption, not an unread value: spec 0016 split the two flags,
    // so it carries the declared assumption badge rather than the provisional one (AC-10).
    await expect(
      content.locator('[data-assumption="indirect_multiplier"] [data-declared-assumption]'),
    ).toBeVisible();
    await expect(content.locator('[data-assumption="hours_per_fte"]')).toHaveAttribute(
      "data-assumption-value",
      String(HOURS_PER_FTE),
    );
    await expect(content.locator("[data-input-headcount]")).toHaveAttribute(
      "data-input-headcount",
      "420",
    );
    await expect(content.locator("[data-input-industry]")).toHaveAttribute(
      "data-input-industry",
      "23.61",
    );
    await expect(content.locator('[data-input-kpi="accident_rate_per_1000_fte"]')).toContainText(
      "68.00 (2025, from the research) · peer: Manufacturing · all sizes · 2022",
    );
    await expect(content.locator('[data-input-kpi="ltifr"]')).toContainText("no peer row");
    await expectNoAxeViolations(page);

    // The facts form (AC-11, AC-12): a new headcount is saved, the benchmark is recomputed and the
    // card shows the new cost once the snapshot lands.
    const form = disclosure.locator("[data-facts-form]");
    await expect(form.getByLabel("Industry (NOGA division)")).toContainText("23");
    await form.getByLabel("Headcount").fill("500");
    await form.getByRole("button", { name: "Save and recalculate" }).click();
    await expect(form.locator("[data-facts-saved]")).toHaveAttribute("data-facts-saved", "true");
    const NEW_ANNUAL = ((68 * 500) / 1000) * COST_PER_CASE * 3.7;
    await expect
      .poll(async () => Number(await card.getAttribute("data-cost")), RUN_TIMEOUT)
      .toBeCloseTo(NEW_ANNUAL, 0);
    await expect(card.locator("[data-cost-headline]")).toContainText(/2.335.000/);
    // The second snapshot is not the first: no second delivery and no second email (AC-5, AC-7).
    expect(await noMailFor(email, seenAfterFirst)).toBe(true);
    const { count: benchmarkDeliveries } = await db
      .from("email_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("template", "benchmark_ready");
    expect(benchmarkDeliveries).toBe(1);
    if (process.env.BENCHMARK_SCREENSHOT) {
      await page.screenshot({ path: process.env.BENCHMARK_SCREENSHOT, fullPage: true });
    }

    // The stored rows (AC-5): two snapshots, the first keyed to the run, one KPI compared, the saving unrounded.
    const { data: company } = await db
      .from("companies")
      .select("id, employees_count, industry_code")
      .eq("name", "Benchmark Fixture AG")
      .maybeSingle();
    expect(company?.industry_code).toBe("23.61");
    const { data: snapshots } = await db
      .from("benchmark_snapshots")
      .select(
        "trigger_kind, research_run_id, kpis_compared, peer_provisional, saving_median_chf, created_at",
      )
      .eq("company_id", company?.id ?? "");
    expect(company?.employees_count).toBe(500);
    expect(snapshots).toHaveLength(2);
    const [first, second] = [...(snapshots ?? [])].sort((a, b) =>
      a.created_at < b.created_at ? -1 : 1,
    );
    expect(first?.trigger_kind).toBe("research");
    expect(first?.research_run_id).not.toBeNull();
    expect(first?.kpis_compared).toBe(1);
    expect(first?.peer_provisional).toBe(true);
    expect(Number(first?.saving_median_chf)).toBeCloseTo(ANNUAL - AT_MEDIAN, 0);
    expect(second?.trigger_kind).toBe("client_edit");
    expect(second?.research_run_id).toBeNull();
  } finally {
    // The delivery row outlives the user by design (recipient set to null), so it goes by hand.
    if (!process.env.BENCHMARK_KEEP_DELIVERIES) {
      await serviceClient().from("email_deliveries").delete().eq("recipient_email", email);
    }
    await deleteAccount(email);
  }
});

/**
 * The point row path (spec 0016, AC-15). Section D holds one Suva class, so its seeded peer row is
 * 44.3 repeated as all three quartiles: a `point` row. The company is seeded straight into that
 * section and a snapshot is driven through the same `benchmark-company` task the product uses, so
 * the assertions run against the real model rather than a fixture of the rendering.
 *
 * What must hold: no quartile band is drawn and no replacement graphic takes its place, the words
 * quarter, quartile and median never appear on the row, one labelled sector figure is shown, and
 * the state passes axe. The distribution path stays covered by the test above, so both shapes are
 * exercised.
 */
test("a point row renders a sector comparison with no band and no quartile wording", async ({
  page,
}) => {
  const email = uniqueEmail("benchmark-point");
  try {
    await signInFresh(page, email, "Point Row AG");
    const account = await accountByEmail(email);
    const organizationId = account?.organization?.id;
    const userId = account?.user.id;
    if (!organizationId || !userId) throw new Error("the sign in created no organization");

    // NOGA 35 is section D, whose peer row is a single figure (44.3/44.3/44.3) in the committed
    // seed. The company sits above it, so the position is `below_average`, never a quartile band.
    const { companyId, runId } = await seedResearchedCompany({
      organizationId,
      userId,
      name: "Point Row AG",
      industryCode: "35",
      employeesCount: 200,
    });
    await seedCompanyKpi({
      organizationId,
      companyId,
      runId,
      kpiKey: "accident_rate_per_1000_fte",
      periodYear: 2024,
      value: 60,
    });

    const db = serviceClient();
    await db.from("companies").update({ updated_at: new Date().toISOString() }).eq("id", companyId);
    await page.goto("/en/app");
    await expect(page.getByRole("heading", { level: 1, name: "Point Row AG" })).toBeVisible();

    // Drive a snapshot through the product's own path: saving a figure queues `benchmark-company`.
    // The form sends only the fields the client changed, so an untouched value is never copied into
    // a client row and an untouched save returns `nothingToSave` without queueing anything. Enter a
    // figure first, then wait for the save to land before polling for the snapshot.
    const assessment = page.locator("[data-self-assessment]");
    // 61 rather than the seeded 60: the form diffs each field against its prefilled research value
    // and drops the ones that match, so re-entering 60 would send nothing at all. Any figure above
    // the 44.3 sector row keeps the position `below_average`.
    await assessment.getByRole("textbox", { name: "Accident rate per 1 000 FTE" }).fill("61");
    await assessment.getByRole("button", { name: "Save and recalculate" }).click();
    await expect(assessment.locator("[data-kpis-saved]")).toHaveAttribute(
      "data-kpis-saved",
      "true",
    );
    await expect
      .poll(async () => {
        const { count } = await db
          .from("benchmark_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        return count ?? 0;
      }, RUN_TIMEOUT)
      .toBeGreaterThan(0);
    await expect
      .poll(
        () => page.locator("[data-benchmark-state]").getAttribute("data-benchmark-state"),
        RUN_TIMEOUT,
      )
      .toBe("ready");

    const row = page.locator('[data-position-kpi="accident_rate_per_1000_fte"]');
    await expect(row).toHaveAttribute("data-peer-shape", "point");
    await expect(row).toHaveAttribute("data-position", "below_average");

    // No band, and nothing drawn in its place.
    await expect(row.locator('[data-slot="quartile-band"]')).toHaveCount(0);
    await expect(row.locator("svg")).toHaveCount(0);

    // One labelled sector figure, and the point row basis sentence.
    await expect(row.locator("[data-sector-figure]")).toHaveAttribute("data-sector-figure", "44.3");
    await expect(row.getByText("One figure for the whole sector, not a range.")).toBeVisible();

    // The words the spec forbids on a point row, in the rendered text of the row itself.
    const text = ((await row.textContent()) ?? "").toLowerCase();
    expect(text).not.toMatch(/quarter|quartile|median|p25|p75/);

    await expectNoAxeViolations(page);
  } finally {
    await serviceClient().from("email_deliveries").delete().eq("recipient_email", email);
    await deleteAccount(email);
  }
});
