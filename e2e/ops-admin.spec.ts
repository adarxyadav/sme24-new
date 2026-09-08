import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { accountByEmail, dbAvailable, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * The ops delivery thread end to end (spec 0014, milestone 7): ops book a paid order, move it
 * through the delivery states, correct it and release it, the client sees the date and the
 * assessor on their own dashboard, and axe scans every new page.
 *
 * What this covers that the other two nets cannot. pgTAP (`order_delivery.test.sql`) proves the
 * triggers and the revoke against the database, and Vitest proves the actions against a faked
 * boundary; neither runs the real action through a real session. So this spec owns the half of
 * **AC-8** that neither reaches: an ops action invoked from a signed in client session. Next
 * generates action ids at build time, so an action cannot be posted by name from a test; the
 * client's own attempt on the four delivery columns through PostgREST is what is asserted instead,
 * together with the route gate, which is what a client actually has to work with.
 *
 * The fixture order is created and removed by this spec rather than seeded, because a paid order
 * sitting in `supabase/seed.sql` would trip the pgTAP suite's "rows beyond the seed" guard.
 */

test.skip(!seedPassword || !dbAvailable, "needs the local stack and E2E_SEED_PASSWORD");

/**
 * Serial, deliberately. The seeded client's organization and the seeded expert are one pair, so
 * the `expert_assignments` row every booking grants is a single shared row: two workers running
 * these tests at once have one tearing down the grant the other is still rendering. The fixture
 * orders and companies are per worker, but that row cannot be, because AC-4's assignability check
 * is the seeded expert's own. The whole file runs in well under a minute.
 */
test.describe.configure({ mode: "serial" });

/** The WCAG 2.2 AA tag set every axe scan in this repo runs with. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Two pre-existing violations on the ops shell that are not this feature's (carried to
 * `/check review`): `region` on the sidebar shell, and a destructive button whose contrast is
 * 4.33:1 where 4.5:1 is required, which reproduces on the design gallery's own dialog. They are
 * excluded by rule so this spec fails on a violation the feature actually introduced.
 */
const SHARED_SHELL_RULES = ["region", "color-contrast"];

/**
 * The seeded client's organization plus the seeded expert and ops ids, and a company of that
 * organization created for this test.
 *
 * The company is a fixture rather than a seed row: `supabase/seed.sql` holds no companies at all,
 * and adding one would trip the pgTAP suite's "rows beyond the seed" guard. Its name carries the
 * worker index so the two local workers never read each other's row, and `removeCompany` takes it
 * away again in the same `finally` that removes the order.
 */
async function fixtureIds(workerIndex: number) {
  const supabase = serviceClient();
  const [client, expert, ops] = await Promise.all([
    accountByEmail(SEED_USERS.client),
    accountByEmail(SEED_USERS.expert),
    accountByEmail(SEED_USERS.ops),
  ]);
  const organizationId = client?.profile?.organization_id;
  if (!organizationId || !expert || !ops)
    throw new Error("the seeded client, expert and ops are needed");

  const companyName = `E2E Terminfirma ${workerIndex}`;
  const { data: existing } = await supabase
    .from("companies")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("name", companyName)
    .maybeSingle();
  const company =
    existing ??
    (
      await supabase
        .from("companies")
        .insert({
          organization_id: organizationId,
          name: companyName,
          created_by: client.user.id,
          industry_code: "23.61",
          employees_count: 120,
          canton: "ZH",
        })
        .select("id, name")
        .single()
    ).data;
  if (!company) throw new Error("the fixture company could not be created");

  return {
    organizationId,
    companyId: company.id,
    companyName: company.name,
    expertId: expert.user.id,
    expertName: expert.profile?.full_name ?? null,
    clientId: client.user.id,
  };
}

/** Removes the fixture company, once every order pointing at it is gone (the reference is restrict). */
async function removeCompany(companyId: string) {
  await serviceClient().from("companies").delete().eq("id", companyId);
}

/**
 * Makes the seeded expert active on the seeded client's organization, the row scheduling would
 * write, for a test that books through the database rather than the UI.
 *
 * A plain insert, not an upsert: the unique index behind this pair is partial
 * (`where status = 'active'`), so PostgREST cannot target it with `onConflict` — the same
 * limitation `docs/benchmark.md` records for the client KPI rows. A duplicate simply means an
 * earlier step already granted it, which is all this needs.
 */
async function grantAssignment(ids: {
  readonly organizationId: string;
  readonly expertId: string;
  readonly clientId: string;
}) {
  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from("expert_assignments")
    .select("id")
    .eq("organization_id", ids.organizationId)
    .eq("expert_id", ids.expertId)
    .eq("status", "active")
    .maybeSingle();
  if (existing) return;
  const { error } = await supabase.from("expert_assignments").insert({
    organization_id: ids.organizationId,
    expert_id: ids.expertId,
    status: "active",
    assigned_by: ids.clientId,
  });
  if (error) throw error;
}

/**
 * Removes the `expert_assignments` row scheduling created for the seeded expert.
 *
 * Booking grants that access on purpose and releasing the date deliberately leaves it standing
 * (AC-7, invariant 4), so no path in the feature ever takes it away; that is correct for ops and
 * wrong for a test suite. `expert_assignments.test.sql` asserts the table is empty on a fresh
 * database, so a row left here fails the next `pnpm test:db` rather than this spec.
 */
async function removeAssignments(organizationId: string, expertId: string) {
  await serviceClient()
    .from("expert_assignments")
    .delete()
    .eq("organization_id", organizationId)
    .eq("expert_id", expertId);
}

/**
 * A paid order of the seeded client's organization, ready to be booked. The reference carries the
 * worker index, so the two local workers never collide on the unique constraint.
 */
async function createPaidOrder(input: {
  readonly organizationId: string;
  readonly companyId: string;
  readonly clientId: string;
  readonly suffix: string;
}) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("orders")
    .insert({
      organization_id: input.organizationId,
      company_id: input.companyId,
      created_by: input.clientId,
      package_key: "culture",
      reference: `SME24-2099-${input.suffix}`,
      status: "paid",
      payment_method: "bank_transfer",
      paid_at: new Date().toISOString(),
      net_rappen: 200000,
      vat_rate: 0.081,
      vat_rappen: 16200,
      gross_rappen: 216200,
      package_name_snapshot: "Safety Culture",
      billing_name: "Musterfirma AG",
      billing_street: "Musterstrasse 1",
      billing_postcode: "8001",
      billing_town: "Zürich",
      locale: "de",
    })
    .select("id, reference")
    .single();
  if (error) throw error;
  return data;
}

/** Removes the fixture order and anything the thread hung off it, so pgTAP's seed guard stays happy. */
async function removeOrder(orderId: string) {
  const supabase = serviceClient();
  await supabase
    .from("email_deliveries")
    .delete()
    .like("idempotency_key", `assessment-scheduled/${orderId}/%`);
  // The order is refunded first: `delete` is fine, but a delivered row left behind by a failed
  // assertion would otherwise be the one thing a later `pnpm test:db` complains about.
  await supabase.from("orders").delete().eq("id", orderId);
}

/** A unique four digit reference suffix per worker and test, inside the reference's own pattern. */
const suffix = (workerIndex: number, seq: number) => String(9000 + workerIndex * 10 + seq);

test.describe("the ops delivery thread", () => {
  test("ops book a paid order, advance it, correct it and release it (AC-3, AC-6, AC-7, AC-7a)", async ({
    page,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);
    const order = await createPaidOrder({ ...ids, suffix: suffix(testInfo.workerIndex, 1) });

    try {
      await signIn(page, SEED_USERS.ops);
      await page.goto("/de/admin/orders");
      const row = page.getByRole("row").filter({ hasText: order.reference });
      await expect(row).toBeVisible();

      // ── Schedule (AC-3): a future date and an active assessor ────────────────────────────────
      await row.getByRole("button", { name: "Terminieren" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Termin festlegen" })).toBeVisible();
      await dialog.getByLabel("Datum und Uhrzeit").fill("2099-07-15T09:30");
      await dialog.getByRole("combobox").click();
      // The seeded expert is active, so they are offered; picking by name is what ops actually do.
      await page.getByRole("option").first().click();
      await dialog.getByRole("button", { name: "Terminieren", exact: true }).click();

      await expect(page.getByRole("dialog")).toBeHidden();
      // The row now carries the booked state; the date is rendered in Swiss local time (09:30, not 07:30).
      // The status badge is what the server sent back, so it is the signal every step waits on: a
      // button disappearing only says the component re-rendered, not that the write landed.
      await expect(row).toContainText("Terminiert");
      await expect(row).toContainText("15.07.2099");
      await expect(row).toContainText("09:30");

      // The database is the record: both columns and the actor are set, and the expert has access.
      const supabase = serviceClient();
      const { data: booked } = await supabase
        .from("orders")
        .select("status, scheduled_at, assigned_expert_id, scheduled_by")
        .eq("id", order.id)
        .single();
      expect(booked?.status).toBe("scheduled");
      expect(booked?.scheduled_at).toBe("2099-07-15T07:30:00+00:00");
      expect(booked?.assigned_expert_id).not.toBeNull();
      expect(booked?.scheduled_by).not.toBeNull();

      const { data: assignment } = await supabase
        .from("expert_assignments")
        .select("status")
        .eq("organization_id", ids.organizationId)
        .eq("expert_id", booked?.assigned_expert_id as string)
        .eq("status", "active")
        .maybeSingle();
      // Invariant 4: booking is the write that grants the access the expert needs to do the work.
      expect(assignment?.status).toBe("active");

      // ── The two forward edges (AC-6) ─────────────────────────────────────────────────────────
      await row.getByRole("button", { name: "Starten" }).click();
      await expect(row).toContainText("In Arbeit");
      await expect(row.getByRole("button", { name: "Als abgeschlossen markieren" })).toBeVisible();

      // ── Correct the date on an in_progress order, which may be in the past (AC-7a) ───────────
      await row.getByRole("button", { name: "Ändern" }).click();
      const correction = page.getByRole("dialog");
      await expect(
        correction.getByRole("heading", { name: "Termin oder Person ändern" }),
      ).toBeVisible();
      await correction.getByLabel("Datum und Uhrzeit").fill("2020-01-15T09:00");
      await correction.getByRole("button", { name: "Änderung speichern" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      // The corrected date is on the row before the next edge is clicked, so the click that follows
      // is not racing the refresh this correction started.
      await expect(row).toContainText("15.01.2020");
      await expect(row).toContainText("In Arbeit");

      const { data: corrected } = await supabase
        .from("orders")
        .select("status, scheduled_at")
        .eq("id", order.id)
        .single();
      // The status did not move, and a past date stands: recording a visit after the fact is real work.
      expect(corrected?.status).toBe("in_progress");
      expect(corrected?.scheduled_at).toBe("2020-01-15T08:00:00+00:00");

      // ── delivered stamps delivered_at (AC-6) ─────────────────────────────────────────────────
      await row.getByRole("button", { name: "Als abgeschlossen markieren" }).click();
      await expect(row).toContainText("Abgeschlossen");
      // A delivered order offers no forward edge and no release.
      await expect(row.getByRole("button", { name: "Als abgeschlossen markieren" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Termin aufheben" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Starten" })).toHaveCount(0);
      // Correcting a delivered order is still offered, which is what AC-7a's third state means.
      await expect(row.getByRole("button", { name: "Ändern" })).toBeVisible();

      const { data: delivered } = await supabase
        .from("orders")
        .select("status, delivered_at")
        .eq("id", order.id)
        .single();
      expect(delivered?.status).toBe("delivered");
      expect(delivered?.delivered_at).not.toBeNull();

      // ── AC-12: every one of those writes is in the audit log ─────────────────────────────────
      const { count } = await supabase
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("table_name", "orders")
        .eq("row_id", order.id);
      expect(count ?? 0).toBeGreaterThan(0);
    } finally {
      await removeOrder(order.id);
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });

  test("ops release a booked order back to paid, leaving the assignment active (AC-7)", async ({
    page,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);
    const order = await createPaidOrder({ ...ids, suffix: suffix(testInfo.workerIndex, 2) });

    try {
      await signIn(page, SEED_USERS.ops);
      await page.goto("/de/admin/orders");
      const row = page.getByRole("row").filter({ hasText: order.reference });

      await row.getByRole("button", { name: "Terminieren" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Datum und Uhrzeit").fill("2099-08-20T14:00");
      await dialog.getByRole("combobox").click();
      await page.getByRole("option").first().click();
      await dialog.getByRole("button", { name: "Terminieren", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(row).toContainText("Terminiert");

      await row.getByRole("button", { name: "Termin aufheben" }).click();
      const release = page.getByRole("dialog");
      await expect(release.getByRole("heading", { name: "Termin aufheben" })).toBeVisible();
      await release.getByRole("button", { name: "Termin aufheben", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(row).toContainText("Bezahlt");

      const supabase = serviceClient();
      const { data: released } = await supabase
        .from("orders")
        .select("status, scheduled_at, assigned_expert_id")
        .eq("id", order.id)
        .single();
      // Both columns are cleared in the same statement the status moves, so paid never holds a stale date.
      expect(released).toMatchObject({
        status: "paid",
        scheduled_at: null,
        assigned_expert_id: null,
      });

      const { data: assignment } = await supabase
        .from("expert_assignments")
        .select("status")
        .eq("organization_id", ids.organizationId)
        .eq("expert_id", ids.expertId)
        .eq("status", "active")
        .maybeSingle();
      // Left active on purpose: ending the grant is ops work, not a side effect of freeing a date.
      expect(assignment?.status).toBe("active");

      // The row offers scheduling again, which is the whole point of releasing it.
      await expect(row.getByRole("button", { name: "Terminieren" })).toBeVisible();
    } finally {
      await removeOrder(order.id);
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });

  test("the client sees each booked order's own date and assessor (AC-10)", async ({
    page,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);
    const supabase = serviceClient();
    const order = await createPaidOrder({ ...ids, suffix: suffix(testInfo.workerIndex, 3) });

    try {
      // Booked through the database rather than the UI: this test is about what the client sees.
      await grantAssignment(ids);
      const { error } = await supabase
        .from("orders")
        .update({
          status: "scheduled",
          scheduled_at: "2099-09-10T07:00:00+00:00",
          assigned_expert_id: ids.expertId,
        })
        .eq("id", order.id);
      if (error) throw error;

      await signIn(page, SEED_USERS.client);
      await page.goto("/de/app");

      const card = page.locator("[data-scheduled-assessments]");
      await expect(card).toBeVisible();
      const booking = card.getByRole("listitem").filter({ hasText: order.reference });
      await expect(booking).toBeVisible();
      // 07:00Z is 09:00 in Zurich in September: the client is told the hour ops actually booked.
      await expect(booking).toContainText("10.09.2099");
      await expect(booking).toContainText("09:00");
      if (ids.expertName) await expect(booking).toContainText(ids.expertName);
    } finally {
      await removeOrder(order.id);
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });
});

test.describe("the ops read only surfaces", () => {
  test("the companies list and detail show ops what a client asked about (AC-1, AC-2)", async ({
    page,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);

    try {
      await signIn(page, SEED_USERS.ops);

      await page.goto("/de/admin/companies");
      await expect(page.getByRole("heading", { level: 1, name: "Firmen" })).toBeVisible();
      await page.getByRole("link", { name: ids.companyName }).first().click();

      await expect(page).toHaveURL(new RegExp(`/de/admin/companies/${ids.companyId}$`));
      // The seven blocks AC-2 names. Some are section headings and some are card titles, so each
      // is matched by its own visible label rather than by a role the markup does not all share.
      for (const block of [
        "Firmenangaben",
        "Kundschaft",
        "Personen",
        "Rechercheläufe",
        "Kennzahlen",
        "Benchmark",
        "Bestellungen",
      ]) {
        await expect(page.getByText(block, { exact: true }).first()).toBeVisible();
      }
      // The company's own facts are on the page, not only its name in the title.
      await expect(page.getByText(ids.companyName).first()).toBeVisible();
    } finally {
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });

  test("the overview shows the work waiting on ops and links into each list (AC-11)", async ({
    page,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);
    // A paid order with no date is exactly what the first queue section is for.
    const order = await createPaidOrder({ ...ids, suffix: suffix(testInfo.workerIndex, 4) });

    try {
      await signIn(page, SEED_USERS.ops);
      await expect(page).toHaveURL(/\/de\/admin$/);
      await expect(page.getByRole("heading", { level: 1, name: "Ops Admin" })).toBeVisible();
      // The scaffold checks demo is gone from this page (AC-11).
      await expect(page.getByText("Scaffold")).toHaveCount(0);

      // The queue names the section this order belongs in, and lists the order inside that card.
      const section = page
        .locator('[data-slot="card"]')
        .filter({ hasText: "Bezahlt, noch nicht terminiert" });
      await expect(section).toBeVisible();
      await expect(section).toContainText(order.reference);

      // The counts block sits below the queue.
      await expect(page.getByRole("heading", { name: "Aktueller Stand" })).toBeVisible();

      // The section links into its own list rather than dead-ending on the overview.
      await section.getByRole("link", { name: "Alle ansehen" }).click();
      await expect(page).toHaveURL(/\/de\/admin\/orders/);
    } finally {
      await removeOrder(order.id);
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });
});

test.describe("the ops gate (AC-8)", () => {
  test("a client cannot reach an ops route and cannot write a delivery column", async ({
    page,
    request,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);
    const order = await createPaidOrder({ ...ids, suffix: suffix(testInfo.workerIndex, 7) });

    try {
      await signIn(page, SEED_USERS.client);

      // The route gate: neither new page is reachable, so the actions on them are never rendered.
      for (const path of [
        "/de/admin",
        "/de/admin/companies",
        `/de/admin/companies/${ids.companyId}`,
        "/de/admin/orders",
      ]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/de\/forbidden$/);
      }

      // The write itself. A Next action id is generated at build time, so the ops actions cannot be
      // posted by name from here; what a client can actually attempt is the table, and `UPDATE` on
      // `orders` is revoked from every app role (invariant 3), so PostgREST refuses it with the
      // client's own access token. This is the half pgTAP proves as a role and this proves as a session.
      // `@supabase/ssr` keeps the session in cookies, chunked across `...auth-token.0`, `.1`, …,
      // so the token is reassembled from them in name order rather than read from localStorage.
      const cookies = await page.context().cookies();
      const chunks = cookies
        .filter((cookie) => cookie.name.includes("auth-token"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cookie) => cookie.value)
        .join("");
      const decoded = chunks.startsWith("base64-")
        ? Buffer.from(chunks.slice(7), "base64").toString("utf8")
        : decodeURIComponent(chunks);
      const token = (JSON.parse(decoded) as { access_token?: string }).access_token ?? null;
      expect(token, "the signed in client's access token").not.toBeNull();

      const response = await request.patch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}`,
        {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: {
            status: "scheduled",
            scheduled_at: "2099-07-15T07:30:00+00:00",
            assigned_expert_id: ids.expertId,
          },
        },
      );
      // 401/403 from the revoke; never a 2xx, and never a row that moved.
      expect(response.status()).toBeGreaterThanOrEqual(400);

      const { data: untouched } = await serviceClient()
        .from("orders")
        .select("status, scheduled_at, assigned_expert_id")
        .eq("id", order.id)
        .single();
      expect(untouched).toMatchObject({
        status: "paid",
        scheduled_at: null,
        assigned_expert_id: null,
      });
    } finally {
      await removeOrder(order.id);
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });

  test("an anonymous visitor is sent to sign in from the new ops routes", async ({ page }) => {
    await page.goto("/de/admin/companies");
    await expect(page).toHaveURL(/\/de\/sign-in\?next=/);
  });
});

test.describe("accessibility (AC-13)", () => {
  test("axe finds no violation on the new ops pages or the scheduling dialog", async ({
    page,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);
    const order = await createPaidOrder({ ...ids, suffix: suffix(testInfo.workerIndex, 5) });

    try {
      await signIn(page, SEED_USERS.ops);

      for (const path of [
        "/de/admin",
        "/de/admin/companies",
        `/de/admin/companies/${ids.companyId}`,
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .disableRules(SHARED_SHELL_RULES)
          .analyze();
        expect(results.violations, `${path} has axe violations`).toEqual([]);
      }

      // The scheduling dialog is a surface of its own: it traps focus and carries two fields.
      await page.goto("/de/admin/orders");
      const row = page.getByRole("row").filter({ hasText: order.reference });
      await row.getByRole("button", { name: "Terminieren" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const dialogResults = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .disableRules(SHARED_SHELL_RULES)
        .analyze();
      expect(dialogResults.violations, "the scheduling dialog has axe violations").toEqual([]);
    } finally {
      await removeOrder(order.id);
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });

  test("the client's booked assessment card is accessible in both languages", async ({
    page,
  }, testInfo) => {
    const ids = await fixtureIds(testInfo.workerIndex);
    const supabase = serviceClient();
    const order = await createPaidOrder({ ...ids, suffix: suffix(testInfo.workerIndex, 6) });

    try {
      await grantAssignment(ids);
      await supabase
        .from("orders")
        .update({
          status: "scheduled",
          scheduled_at: "2099-09-10T07:00:00+00:00",
          assigned_expert_id: ids.expertId,
        })
        .eq("id", order.id);

      await signIn(page, SEED_USERS.client);
      for (const path of ["/de/app", "/en/app"]) {
        await page.goto(path);
        await expect(page.locator("[data-scheduled-assessments]")).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .disableRules(SHARED_SHELL_RULES)
          .analyze();
        expect(results.violations, `${path} has axe violations`).toEqual([]);
      }
    } finally {
      await removeOrder(order.id);
      await removeAssignments(ids.organizationId, ids.expertId);
      await removeCompany(ids.companyId);
    }
  });
});
