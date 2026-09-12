import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import compliance from "../src/features/assessments/content/compliance.json";
import iso45001 from "../src/features/assessments/content/iso45001.json";
import { accountByEmail, dbAvailable, purgeAuditRows, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * Structured assessment forms end to end (spec 0019, milestone 5, AC-15): the seeded expert
 * starts ISO 45001 for the seeded client's company, rates a clause and an annex, applies the
 * suggestion, finds it all persisted after a reload, submits and reads the locked score; then
 * starts Compliance, marks Hot work not applicable with a reason and submits with the rest rated;
 * the client sees only the state lines on its card and receives zero answer rows through the API
 * (AC-10); axe scans both new pages in both languages and the rating control is driven by arrow
 * keys (AC-13).
 *
 * What this covers that the other nets cannot: pgTAP proves the policies and the two triggers as
 * roles, Vitest proves the model and the actions against a faked boundary; only this spec runs
 * the real actions through a real session, the autosave through the real browser and the read
 * side through the client's own access token.
 *
 * The fixtures (a company, an active assignment and a scheduled compliance order) are created by
 * the spec and removed in `afterAll`, because rows beyond the seed trip the pgTAP guards. The
 * audit rows of every fixture are removed as well, behind the append only trigger, because
 * `assessment_answers.test.sql` counts every audited insert.
 */

test.skip(!seedPassword || !dbAvailable, "needs the local stack and E2E_SEED_PASSWORD");

/**
 * Serial, deliberately: the seeded client's organization and the seeded expert are one pair, and
 * the partial unique index allows one draft per company and questionnaire, so a second worker
 * would collide on the fixture rows and on the assignment. One worker runs the file in a couple
 * of minutes.
 */
test.describe.configure({ mode: "serial" });

/** The WCAG 2.2 AA tag set every axe scan in this repo runs with. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The seeded client organization (supabase/seed.sql). */
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The pinned version every seeded assessment runs against, and the item id rule of AC-2. */
const ISO_VERSION = `${iso45001.key}@${iso45001.version}`;
const COMPLIANCE_VERSION = `${compliance.key}@${compliance.version}`;
const itemId = (version: string, position: number) => `${version}/${position}`;

/**
 * The ISO items this spec drives by hand, by position in `content/iso45001.json`: clause 7.2
 * (Competence), clause 7.3 (Awareness) with its six rateable annex checks C.1 to C.6, and clause
 * 7.4 (Communication) for the keyboard run. A content rebuild that moves them fails the position
 * assertions below, not a selector deep in a test.
 */
const CLAUSE_COMPETENCE = 41;
const CLAUSE_AWARENESS = 42;
const AWARENESS_CHECKS = [43, 44, 45, 46, 47, 48] as const;
const CLAUSE_COMMUNICATION = 49;

/** What this spec reads of a content item; both files satisfy it. */
type ContentItem = {
  readonly position: number;
  readonly sectionKey: string;
  readonly parentPosition: number | null;
  readonly rateable: boolean;
};

/** The rateable top level items of a content file: what the completeness check requires. */
const requiredItems = (items: readonly ContentItem[]) =>
  items.filter((item) => item.rateable && item.parentPosition === null);

/** The percentage `computeScore` produces for these ratings: the mean, rounded to a whole percent. */
const percent = (ratings: readonly ("compliant" | "partial" | "non_compliant")[]) => {
  const values = { compliant: 1, partial: 0.5, non_compliant: 0 } as const;
  const sum = ratings.reduce((total, rating) => total + values[rating], 0);
  return Math.round((sum / ratings.length) * 100);
};

const ids: {
  organizationId: string;
  companyId: string;
  clientId: string;
  expertId: string;
  assignmentId: string;
  orderId: string;
  orderReference: string;
  isoAssessmentId: string;
  complianceAssessmentId: string;
} = {
  organizationId: ORGANIZATION_ID,
  companyId: "",
  clientId: "",
  expertId: "",
  assignmentId: "",
  orderId: "",
  orderReference: "SME24-2099-9900",
  isoAssessmentId: "",
  complianceAssessmentId: "",
};

/** The English and German paths of the expert's client page and of one assessment. */
const clientPath = (locale: "en" | "de") =>
  locale === "en"
    ? `/en/expert/clients/${ORGANIZATION_ID}`
    : `/de/expert/kunden/${ORGANIZATION_ID}`;
const assessmentPath = (locale: "en" | "de", assessmentId: string) =>
  locale === "en"
    ? `/en/expert/clients/${ORGANIZATION_ID}/assessments/${assessmentId}`
    : `/de/expert/kunden/${ORGANIZATION_ID}/beurteilungen/${assessmentId}`;

/** The consent bar covers the bottom of the viewport when PostHog is configured; away with it. */
async function dismissConsent(page: Page) {
  const reject = page.getByRole("button", { name: /^(Reject|Ablehnen)/ });
  if ((await reject.count()) > 0) await reject.first().click();
}

/** Waits until no save on the page is pending or in flight, then that every indicator reads saved. */
async function expectAllSaved(page: Page) {
  await expect(
    page.locator(
      '[data-slot="save-indicator"][data-state="pending"], [data-slot="save-indicator"][data-state="saving"]',
    ),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-slot="save-indicator"][data-state="failed"]')).toHaveCount(0);
}

/**
 * The rating radio of one item on the open section. A clause card nests its annex sub items
 * (each its own `data-item`) above the clause's own fields, so the clause's control is the last
 * rating control in its card; a sub item holds exactly one, so last is first there.
 */
const ratingRadio = (page: Page, item: string, rating: "compliant" | "partial" | "non_compliant") =>
  page
    .locator(`[data-item="${item}"]`)
    .first()
    .locator('[data-slot="rating-control"]')
    .last()
    .locator(`[role="radio"][data-rating="${rating}"]`);

/** Starts the questionnaire from the expert's client page and returns the new assessment's id. */
async function startFromClientPage(page: Page, key: "iso45001" | "compliance") {
  await page.goto(clientPath("en"));
  await dismissConsent(page);
  await page.locator(`[data-start="${key}"]`).click();
  await page.waitForURL(/\/assessments\/[0-9a-f-]{36}/);
  const assessmentId = new URL(page.url()).pathname.split("/").at(-1) as string;
  expect(assessmentId).toMatch(/^[0-9a-f-]{36}$/);
  return assessmentId;
}

/** A signed in page in a fresh context, so the expert's and the client's sessions never share cookies. */
async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

/** The access token of the signed in session, reassembled from the chunked `@supabase/ssr` cookies. */
async function accessToken(page: Page) {
  const cookies = await page.context().cookies();
  const chunks = cookies
    .filter((cookie) => cookie.name.includes("auth-token"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cookie) => cookie.value)
    .join("");
  const decoded = chunks.startsWith("base64-")
    ? Buffer.from(chunks.slice(7), "base64").toString("utf8")
    : decodeURIComponent(chunks);
  return (JSON.parse(decoded) as { access_token?: string }).access_token ?? null;
}

test.beforeAll(async () => {
  const supabase = serviceClient();
  const [client, expert] = await Promise.all([
    accountByEmail(SEED_USERS.client),
    accountByEmail(SEED_USERS.expert),
  ]);
  if (client?.profile?.organization_id !== ORGANIZATION_ID || !expert)
    throw new Error("the seeded client and expert are needed");
  ids.clientId = client.user.id;
  ids.expertId = expert.user.id;

  // The content positions this spec relies on, checked against the committed file (AC-1).
  const at = (position: number) => iso45001.items.find((item) => item.position === position);
  expect(at(CLAUSE_COMPETENCE)?.label).toBe("7.2");
  expect(at(CLAUSE_AWARENESS)?.label).toBe("7.3");
  expect(at(CLAUSE_COMMUNICATION)?.label).toBe("7.4");
  for (const position of AWARENESS_CHECKS) {
    expect(at(position)?.parentPosition).toBe(CLAUSE_AWARENESS);
    expect(at(position)?.rateable).toBe(true);
  }
  expect(requiredItems(iso45001.items)).toHaveLength(27);
  expect(requiredItems(compliance.items)).toHaveLength(327);

  // A company of the seeded organization (the seed holds none), the row every assessment names.
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({
      organization_id: ORGANIZATION_ID,
      name: "E2E Beurteilungsfirma",
      created_by: ids.clientId,
      industry_code: "23.61",
      employees_count: 160,
      canton: "ZH",
    })
    .select("id")
    .single();
  if (companyError) throw companyError;
  ids.companyId = company.id;

  // The active assignment that lets the expert read the client and start an assessment (AC-3).
  const { data: assignment, error: assignmentError } = await supabase
    .from("expert_assignments")
    .insert({
      organization_id: ORGANIZATION_ID,
      expert_id: ids.expertId,
      status: "active",
      assigned_by: ids.clientId,
    })
    .select("id")
    .single();
  if (assignmentError) throw assignmentError;
  ids.assignmentId = assignment.id;

  // A compliance order, paid then booked (the transition trigger runs on update only), whose
  // package runs both questionnaires, so `startAssessment` links both to it (AC-5).
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      organization_id: ORGANIZATION_ID,
      company_id: ids.companyId,
      created_by: ids.clientId,
      package_key: "compliance",
      reference: ids.orderReference,
      status: "paid",
      payment_method: "bank_transfer",
      paid_at: new Date().toISOString(),
      net_rappen: 450000,
      vat_rate: 0.081,
      vat_rappen: 36450,
      gross_rappen: 486450,
      package_name_snapshot: "Compliance assessment",
      billing_name: "Musterfirma AG",
      billing_street: "Musterstrasse 1",
      billing_postcode: "8001",
      billing_town: "Zürich",
      locale: "de",
    })
    .select("id")
    .single();
  if (orderError) throw orderError;
  ids.orderId = order.id;
  const { error: bookingError } = await supabase
    .from("orders")
    .update({
      status: "scheduled",
      scheduled_at: "2099-10-05T07:00:00+00:00",
      assigned_expert_id: ids.expertId,
      scheduled_by: ids.clientId,
    })
    .eq("id", ids.orderId);
  if (bookingError) throw bookingError;
});

test.afterAll(async () => {
  const supabase = serviceClient();
  if (!ids.companyId) return;
  // Every assessment of the fixture company, whatever the tests reached; the answers cascade
  // (the lock trigger yields to the cascade because the parent row is already gone).
  const { data: assessments } = await supabase
    .from("assessments")
    .select("id")
    .eq("company_id", ids.companyId);
  const assessmentIds = (assessments ?? []).map((row) => row.id);
  if (assessmentIds.length > 0) {
    const { error } = await supabase.from("assessments").delete().in("id", assessmentIds);
    if (error) throw error;
  }
  if (ids.orderId) {
    const { error } = await supabase.from("orders").delete().eq("id", ids.orderId);
    if (error) throw error;
  }
  if (ids.assignmentId) {
    const { error } = await supabase.from("expert_assignments").delete().eq("id", ids.assignmentId);
    if (error) throw error;
  }
  const { error } = await supabase.from("companies").delete().eq("id", ids.companyId);
  if (error) throw error;

  // The audit trail of all of the above, so `pnpm test:db` still counts only the seed's rows.
  purgeAuditRows({
    tables: ["assessments", "assessment_answers", "orders", "expert_assignments", "companies"],
    rowIds: [...assessmentIds, ids.orderId, ids.assignmentId, ids.companyId].filter(Boolean),
    assessmentIds,
  });
});

test.describe("ISO 45001, run one", () => {
  test("the expert starts, rates, applies a suggestion, reloads, submits and reads the locked score (AC-5, AC-6, AC-7, AC-9)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, SEED_USERS.expert);
    ids.isoAssessmentId = await startFromClientPage(page, "iso45001");
    const supabase = serviceClient();

    // The row is pinned to the newest version and linked to the booking (AC-5).
    const { data: started } = await supabase
      .from("assessments")
      .select(
        "status, questionnaire_key, questionnaire_version_key, order_id, company_id, expert_id, conducted_on",
      )
      .eq("id", ids.isoAssessmentId)
      .single();
    expect(started).toMatchObject({
      status: "draft",
      questionnaire_key: "iso45001",
      questionnaire_version_key: ISO_VERSION,
      order_id: ids.orderId,
      company_id: ids.companyId,
      expert_id: ids.expertId,
      conducted_on: "2099-10-05",
    });

    // The header names the questionnaire, the company and the draft state (AC-6).
    await expect(page.locator('[data-assessment-status="draft"]')).toBeVisible();
    await expect(page.locator("[data-assessment-progress]")).toContainText("0 of 27");
    await expect(page.getByText("E2E Beurteilungsfirma").first()).toBeVisible();

    // Clause 7.2: a rating saves at once, a note saves on blur (AC-6).
    await page.goto(`${assessmentPath("en", ids.isoAssessmentId)}?section=c7`);
    await dismissConsent(page);
    const competence = itemId(ISO_VERSION, CLAUSE_COMPETENCE);
    await ratingRadio(page, competence, "partial").click();
    await expect(ratingRadio(page, competence, "partial")).toHaveAttribute("aria-checked", "true");
    const note = page.locator(`[data-item="${competence}"]`).first().getByLabel("Note");
    await note.fill("Training records exist for the forklift drivers, none yet for the new line.");
    await note.blur();
    await expectAllSaved(page);

    // Clause 7.3: rating its six annex checks compliant suggests compliant for the clause (AC-7).
    const awareness = itemId(ISO_VERSION, CLAUSE_AWARENESS);
    const clause = page.locator(`[data-item="${awareness}"]`).first();
    for (const position of AWARENESS_CHECKS) {
      await ratingRadio(page, itemId(ISO_VERSION, position), "compliant").click();
    }
    await expectAllSaved(page);
    const suggestion = clause.locator('[data-suggestion="compliant"]');
    await expect(suggestion).toBeVisible();
    await expect(suggestion).toContainText("6 of 6");
    await suggestion.getByRole("button", { name: "Apply" }).click();
    await expect(ratingRadio(page, awareness, "compliant")).toHaveAttribute("aria-checked", "true");
    await expectAllSaved(page);
    // Applied means equal, so the button is gone; the suggestion line stays as context.
    await expect(suggestion.getByRole("button", { name: "Apply" })).toHaveCount(0);
    await expect(page.locator("[data-assessment-progress]")).toContainText("2 of 27");

    // A reload renders what the database holds, not what the browser remembered (AC-6).
    await page.reload();
    await expect(ratingRadio(page, competence, "partial")).toHaveAttribute("aria-checked", "true");
    await expect(ratingRadio(page, awareness, "compliant")).toHaveAttribute("aria-checked", "true");
    for (const position of AWARENESS_CHECKS) {
      await expect(ratingRadio(page, itemId(ISO_VERSION, position), "compliant")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    }
    await expect(
      page.locator(`[data-item="${competence}"]`).first().getByLabel("Note"),
    ).toHaveValue("Training records exist for the forklift drivers, none yet for the new line.");
    const { data: answers } = await supabase
      .from("assessment_answers")
      .select("item_id, rating, note")
      .eq("assessment_id", ids.isoAssessmentId);
    expect(answers).toHaveLength(8);
    expect(answers?.find((row) => row.item_id === competence)).toMatchObject({
      rating: "partial",
      note: "Training records exist for the forklift drivers, none yet for the new line.",
    });

    // Submit refuses while clauses are unrated: the dialog counts them and keeps the button off (AC-9).
    await page.getByRole("button", { name: "Submit assessment" }).click();
    const blocked = page.getByRole("dialog");
    await expect(blocked).toContainText("25 items are still unrated");
    await expect(blocked.getByRole("button", { name: "Submit and lock" })).toBeDisabled();
    await blocked.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // The other 25 clauses, written as the service role while the draft is open: the lock
    // trigger is in force and lets them through because the parent is still a draft.
    const remaining = requiredItems(iso45001.items).filter(
      (item) => item.position !== CLAUSE_COMPETENCE && item.position !== CLAUSE_AWARENESS,
    );
    expect(remaining).toHaveLength(25);
    const { error: bulkError } = await supabase.from("assessment_answers").insert(
      remaining.map((item) => ({
        organization_id: ORGANIZATION_ID,
        assessment_id: ids.isoAssessmentId,
        item_id: itemId(ISO_VERSION, item.position),
        rating: "compliant",
      })),
    );
    if (bulkError) throw bulkError;

    // Submit and lock (AC-9): the page turns read only with the score summary on top.
    await page.reload();
    await expect(page.locator("[data-assessment-progress]")).toContainText("27 of 27");
    await page.getByRole("button", { name: "Submit assessment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Every required item is rated.");
    await dialog.getByRole("button", { name: "Submit and lock" }).click();
    await expect(page.locator("[data-score-summary]")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-assessment-status="submitted"]')).toBeVisible();
    // 26 compliant and one partial over 27 clauses: 98 %, the annex checks never counted.
    const expected = percent([...Array<"compliant">(26).fill("compliant"), "partial"]);
    expect(expected).toBe(98);
    await expect(page.locator("[data-assessment-score]")).toContainText(String(expected));
    await expect(page.locator("[data-gap-list] > li")).toHaveCount(1);
    await expect(page.locator("[data-gap-list] > li").first()).toContainText("7.2");
    await expect(page.getByRole("button", { name: "Submit assessment" })).toHaveCount(0);
    await expect(page.locator('[data-section-items] [role="radio"]:not([disabled])')).toHaveCount(
      0,
    );

    // The database: submitted once with its stamp, and frozen for the service role too (AC-4).
    const { data: submitted } = await supabase
      .from("assessments")
      .select("status, submitted_at")
      .eq("id", ids.isoAssessmentId)
      .single();
    expect(submitted?.status).toBe("submitted");
    expect(submitted?.submitted_at).not.toBeNull();
    const { error: locked } = await supabase
      .from("assessment_answers")
      .update({ rating: "non_compliant" })
      .eq("assessment_id", ids.isoAssessmentId)
      .eq("item_id", competence);
    expect(locked?.message).toContain("assessment_locked");
    const { error: reopened } = await supabase
      .from("assessments")
      .update({ status: "draft" })
      .eq("id", ids.isoAssessmentId);
    expect(reopened?.message).toContain("invalid assessments transition");
  });
});

test.describe("Compliance, run two", () => {
  test("the expert excludes Hot work with a reason and submits with the rest rated (AC-8, AC-9)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, SEED_USERS.expert);
    // Once the ISO draft is submitted the client page offers Continue for it and Start for Compliance.
    await page.goto(clientPath("en"));
    await expect(page.locator('[data-start="iso45001"]')).toBeVisible();
    await expect(page.locator('[data-continue="iso45001"]')).toHaveCount(0);
    ids.complianceAssessmentId = await startFromClientPage(page, "compliance");
    const supabase = serviceClient();

    // Hot work: the switch, then the reason, both stored on one exclusion row (AC-8).
    await page.goto(`${assessmentPath("en", ids.complianceAssessmentId)}?section=hot_work`);
    await dismissConsent(page);
    const exclusion = page.locator('[data-section-exclusion="hot_work"]');
    await expect(exclusion).toHaveAttribute("data-excluded", "false");
    await exclusion.getByRole("switch").click();
    await expect(exclusion).toHaveAttribute("data-excluded", "true");
    const reason = "No hot work at this site; welding is contracted out and done off site.";
    await exclusion.getByLabel("Reason").fill(reason);
    await exclusion.getByLabel("Reason").blur();
    await expectAllSaved(page);
    await expect(page.locator('[data-section-items][data-excluded="true"]')).toBeVisible();
    await expect(page.locator('[data-section-nav] a[data-excluded="true"]')).toHaveCount(1);
    // Every item of the excluded standard is disabled.
    await expect(page.locator('[data-section-items] [role="radio"]:not([disabled])')).toHaveCount(
      0,
    );
    const { data: exclusionRows } = await supabase
      .from("assessment_answers")
      .select("item_id, section_key, rating, note")
      .eq("assessment_id", ids.complianceAssessmentId);
    expect(exclusionRows).toEqual([
      { item_id: null, section_key: "hot_work", rating: null, note: reason },
    ]);

    // The remaining 313 requirements, written as the service role while the draft is open,
    // with ten non compliant and six partial so the gap list has something to order.
    const rest = requiredItems(compliance.items).filter((item) => item.sectionKey !== "hot_work");
    expect(rest).toHaveLength(313);
    const ratingAt = (index: number) =>
      index < 10 ? "non_compliant" : index < 16 ? "partial" : "compliant";
    const { error: bulkError } = await supabase.from("assessment_answers").insert(
      rest.map((item, index) => ({
        organization_id: ORGANIZATION_ID,
        assessment_id: ids.complianceAssessmentId,
        item_id: itemId(COMPLIANCE_VERSION, item.position),
        rating: ratingAt(index),
      })),
    );
    if (bulkError) throw bulkError;

    // Submit: the excluded standard is skipped by the completeness check (AC-8, AC-9).
    await page.goto(assessmentPath("en", ids.complianceAssessmentId));
    await expect(page.locator("[data-assessment-progress]")).toContainText("313 of 313");
    await page.getByRole("button", { name: "Submit assessment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Every required item is rated.");
    await dialog.getByRole("button", { name: "Submit and lock" }).click();
    const summary = page.locator("[data-score-summary]");
    await expect(summary).toBeVisible({ timeout: 20_000 });

    // The summary: the score over 313, the excluded entry with its reason, the gaps in order.
    const expected = percent(rest.map((_, index) => ratingAt(index)));
    expect(expected).toBe(96);
    await expect(page.locator("[data-assessment-score]")).toContainText(String(expected));
    await expect(summary).toContainText("313 of 313 items rated");
    const excludedRow = summary.getByRole("row").filter({ hasText: "Hot work" });
    await expect(excludedRow).toContainText("Not applicable");
    const excludedEntry = summary.locator('[data-excluded-section="hot_work"]');
    await expect(excludedEntry).toBeVisible();
    await expect(excludedEntry).toContainText(reason);
    const gaps = page.locator("[data-gap-list] > li:not([data-excluded-section])");
    await expect(gaps).toHaveCount(16);
    // Non compliant first, then partial: the first ten carry the non compliant badge.
    for (const index of [0, 9]) {
      await expect(gaps.nth(index)).toContainText("Non compliant");
    }
    for (const index of [10, 15]) {
      await expect(gaps.nth(index)).toContainText("Partially compliant");
    }

    // The locked page keeps the exclusion visible and its control off.
    await page.goto(`${assessmentPath("en", ids.complianceAssessmentId)}?section=hot_work`);
    await expect(page.locator('[data-section-items][data-excluded="true"]')).toBeVisible();
    await expect(
      page.locator('[data-section-exclusion="hot_work"]').getByRole("switch"),
    ).toBeDisabled();

    // Frozen for every role: the exclusion can no longer be lifted, even by the service role (AC-4).
    const { error: locked } = await supabase
      .from("assessment_answers")
      .delete()
      .eq("assessment_id", ids.complianceAssessmentId)
      .eq("section_key", "hot_work");
    expect(locked?.message).toContain("assessment_locked");
  });

  test("ISO 45001 refuses a section exclusion (AC-8)", async ({ page }) => {
    await signIn(page, SEED_USERS.expert);
    await page.goto(`${assessmentPath("en", ids.isoAssessmentId)}?section=c7`);
    await expect(page.locator("[data-section-heading]")).toBeVisible();
    await expect(page.locator("[data-section-exclusion]")).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
  });
});

test.describe("the client side (AC-10)", () => {
  test("the client sees the state lines on its card and receives zero answer rows", async ({
    page,
    request,
  }) => {
    await signIn(page, SEED_USERS.client);
    for (const locale of ["en", "de"] as const) {
      await page.goto(`/${locale}/app`);
      await dismissConsent(page);
      const card = page.locator("[data-scheduled-assessments]");
      await expect(card).toBeVisible();
      const booking = card.getByRole("listitem").filter({ hasText: ids.orderReference });
      await expect(booking).toBeVisible();
      const lines = booking.locator("[data-assessment-states] li");
      // The compliance package runs both questionnaires, and both are submitted now.
      await expect(lines).toHaveCount(2);
      await expect(lines.nth(0)).toHaveAttribute("data-assessment-state", "submitted");
      await expect(lines.nth(1)).toHaveAttribute("data-assessment-state", "submitted");
      await expect(booking).toContainText(locale === "en" ? "Submitted on" : "Eingereicht am");
      // The state and nothing else: no rating, no score, no note reaches the client's page.
      await expect(booking).not.toContainText("%");
      await expect(booking).not.toContainText("Non compliant");
      await expect(booking).not.toContainText("welding");
    }

    // The probe: the client's own access token against PostgREST. The assessments rows are
    // readable (the state), the answers are not: zero rows, not an error, exactly what the
    // policy set promises (AC-3, AC-10).
    const token = await accessToken(page);
    expect(token, "the signed in client's access token").not.toBeNull();
    const headers = {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      Authorization: `Bearer ${token}`,
    };
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
    const assessments = await request.get(
      `${base}/assessments?select=id,status&organization_id=eq.${ORGANIZATION_ID}`,
      { headers },
    );
    expect(assessments.status()).toBe(200);
    const visible = (await assessments.json()) as { id: string; status: string }[];
    expect(visible.map((row) => row.id).sort()).toEqual(
      [ids.isoAssessmentId, ids.complianceAssessmentId].sort(),
    );

    for (const query of [
      "assessment_answers?select=id",
      `assessment_answers?select=id,rating,note&assessment_id=in.(${ids.isoAssessmentId},${ids.complianceAssessmentId})`,
    ]) {
      const response = await request.get(`${base}/${query}`, { headers });
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual([]);
    }
    // And the same through the count header, in case an empty body ever hid a leak.
    const counted = await request.get(`${base}/assessment_answers?select=id`, {
      headers: { ...headers, Prefer: "count=exact" },
    });
    expect(counted.headers()["content-range"]).toMatch(/\/0$/);

    // The ops table carries the same state per order.
    const ops = await signedInPage(page.context().browser() as Browser, SEED_USERS.ops);
    await ops.goto("/en/admin/orders");
    const row = ops.getByRole("row").filter({ hasText: ids.orderReference });
    await expect(row.locator("[data-assessment-states] li")).toHaveCount(2);
    await expect(row).toContainText("Submitted on");
    await ops.context().close();
  });
});

test.describe("accessibility (AC-13)", () => {
  test("axe passes on the expert client page and the assessment page in both languages, and arrow keys rate an item", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, SEED_USERS.expert);
    const supabase = serviceClient();
    // Both earlier assessments are submitted, so a fresh ISO draft is allowed; `afterAll` removes it.
    const draftId = await startFromClientPage(page, "iso45001");

    for (const locale of ["en", "de"] as const) {
      await page.goto(clientPath(locale));
      await dismissConsent(page);
      await expect(page.locator("[data-assessment-list]")).toBeVisible();
      const client = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(client.violations, `${clientPath(locale)} has axe violations`).toEqual([]);

      await page.goto(`${assessmentPath(locale, draftId)}?section=c7`);
      await expect(page.locator("[data-section-items] [data-item]").first()).toBeVisible();
      const draft = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(draft.violations, `${assessmentPath(locale, draftId)} has axe violations`).toEqual([]);

      await page.goto(assessmentPath(locale, ids.complianceAssessmentId));
      await expect(page.locator("[data-score-summary]")).toBeVisible();
      const locked = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        locked.violations,
        `${assessmentPath(locale, ids.complianceAssessmentId)} has axe violations`,
      ).toEqual([]);
    }

    // The section navigator is a list of links, and the open one is marked current.
    await page.goto(`${assessmentPath("en", draftId)}?section=c7`);
    await dismissConsent(page);
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav.getByRole("listitem")).toHaveCount(7);
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);

    // The rating control is a labelled radio group driven by arrow keys (AC-13): focus the first
    // segment of clause 7.4, ArrowRight moves to and checks the second, the save follows.
    const communication = itemId(ISO_VERSION, CLAUSE_COMMUNICATION);
    const item = page.locator(`[data-item="${communication}"]`).first();
    const group = item.locator('[data-slot="rating-control"]');
    await expect(group).toHaveAttribute("role", "radiogroup");
    await expect(group).toHaveAccessibleName(/Communication/);
    // Held down rather than pressed: Radix moves the focus in a zero delay timeout and checks
    // the newly focused radio only while an arrow key is still down, which a real keypress
    // always is and a synthetic press (down and up back to back) is not.
    await ratingRadio(page, communication, "compliant").focus();
    await page.keyboard.down("ArrowRight");
    const partial = ratingRadio(page, communication, "partial");
    await expect(partial).toBeFocused();
    await page.keyboard.up("ArrowRight");
    await expect(partial).toHaveAttribute("aria-checked", "true");
    await expect(partial).toHaveAttribute("data-state", "checked");
    await page.keyboard.down("ArrowRight");
    const nonCompliant = ratingRadio(page, communication, "non_compliant");
    await expect(nonCompliant).toBeFocused();
    await page.keyboard.up("ArrowRight");
    await expect(nonCompliant).toHaveAttribute("aria-checked", "true");
    await expectAllSaved(page);

    // The chosen state is visible without colour: the weight rises against its siblings.
    const weights = await item.locator('[role="radio"]').evaluateAll((radios) =>
      radios.map((radio) => ({
        checked: radio.getAttribute("aria-checked"),
        weight: Number.parseInt(getComputedStyle(radio).fontWeight, 10),
      })),
    );
    const chosen = weights.find((entry) => entry.checked === "true");
    const others = weights.filter((entry) => entry.checked !== "true");
    expect(chosen?.weight ?? 0).toBeGreaterThan(Math.max(...others.map((entry) => entry.weight)));
    expect(chosen?.weight ?? 0).toBeLessThanOrEqual(600);

    const { data: saved } = await supabase
      .from("assessment_answers")
      .select("rating")
      .eq("assessment_id", draftId)
      .eq("item_id", communication)
      .single();
    expect(saved?.rating).toBe("non_compliant");
  });
});
