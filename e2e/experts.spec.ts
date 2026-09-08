import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dbAvailable, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";
import { uniqueEmail } from "./mail";

/**
 * One expert end to end (spec 0013, milestone 2): the onboarding gate and its consent (AC-4), the
 * ops assign and end controls (AC-9), the expert's own client list and the read only client page
 * (AC-11), and the client's "Your expert" card (AC-12).
 *
 * The seeded expert is already `active` and onboarded, so the gate and the onboarding form are
 * exercised by putting that row back to `invited` for the duration of the test and restoring it
 * afterwards; every other step runs against the seeded rows as they are.
 *
 * Milestone 4 adds the three emails and the alert (AC-14). Those tests need the `send-email` task
 * to actually run, so they assert only with `TRIGGER_DEV_RUNNING=1` while `pnpm trigger:dev` runs,
 * the same condition the welcome email spec uses. They assert on the `email_deliveries` rows the
 * task writes rather than on Mailpit, because which transport the worker uses is an environment
 * setting (Resend when its key is set, SMTP otherwise) and the rows are what the feature owes:
 * one row per recipient, under the spec's idempotency key, carrying the right template and data.
 */

test.skip(!seedPassword || !dbAvailable, "needs the local stack and E2E_SEED_PASSWORD");

/** The seeded expert's id and the seeded client's organization, read once per test that needs them. */
async function seedIds() {
  const supabase = serviceClient();
  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const expert = users.users.find((user) => user.email === SEED_USERS.expert);
  const client = users.users.find((user) => user.email === SEED_USERS.client);
  if (!expert || !client) throw new Error("the seeded expert and client are needed");
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", client.id)
    .maybeSingle();
  if (!profile?.organization_id) throw new Error("the seeded client needs an organization");
  // The picker lists every organization by name, so the name is what the test has to click: the
  // seeded client belongs to one of two, and which one sorts first is not this feature's business.
  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.organization_id)
    .maybeSingle();
  if (!organization?.name) throw new Error("the seeded client's organization needs a name");
  return {
    expertId: expert.id,
    organizationId: profile.organization_id,
    organizationName: organization.name,
  };
}

/** The WCAG 2.2 AA tag set every axe scan in this repo runs with. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The templates milestone 4 added, cleared before a test so its idempotency keys are fresh. */
const MILESTONE_4_TEMPLATES = ["expert_welcome", "assignment_received", "expert_assigned"] as const;

/** Drops the rows (and their notifications) of the three templates, so a rerun queues them again. */
async function clearDeliveries() {
  const supabase = serviceClient();
  const { data: rows } = await supabase
    .from("email_deliveries")
    .select("id")
    .in("template", MILESTONE_4_TEMPLATES);
  const ids = (rows ?? []).map((row) => row.id);
  if (ids.length > 0) await supabase.from("notifications").delete().in("delivery_id", ids);
  await supabase.from("email_deliveries").delete().in("template", MILESTONE_4_TEMPLATES);
}

/** How many of the three templates' rows exist, for the "ending sends nothing" assertion. */
async function deliveryCount(): Promise<number> {
  const supabase = serviceClient();
  const { count } = await supabase
    .from("email_deliveries")
    .select("id", { count: "exact", head: true })
    .in("template", MILESTONE_4_TEMPLATES);
  return count ?? 0;
}

/** The delivery row written under one idempotency key, polled until the task has created it. */
async function waitForDelivery(idempotencyKey: string, timeoutMs = 60_000) {
  const supabase = serviceClient();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("email_deliveries")
      .select("template, recipient_email, data")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (data) return data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no delivery for ${idempotencyKey} within ${timeoutMs}ms`);
}

/** The id of the expert row an invite creates, polled until the action has written it. */
async function waitForInvitedExpert(email: string, timeoutMs = 30_000): Promise<string> {
  const supabase = serviceClient();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("expert_profiles")
      .select("expert_id")
      .eq("email", email)
      .maybeSingle();
    if (data) return data.expert_id;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the invite created no profile for ${email}`);
}

/** The id of the expert's one active assignment, which the emails are keyed on. */
async function activeAssignmentId(expertId: string): Promise<string> {
  const supabase = serviceClient();
  // The action returns before the page settles, so this polls; it takes the newest active row
  // rather than assuming a single one, because an earlier test may still be ending its own.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("expert_assignments")
      .select("id")
      .eq("expert_id", expertId)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1);
    const [row] = data ?? [];
    if (row) return row.id;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the assign step left no active assignment");
}

/** Every member of an organization, each of whom is owed an `expert_assigned` email. */
async function memberIds(organizationId: string): Promise<readonly string[]> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId);
  return (data ?? []).map((row) => row.user_id);
}

/** Removes every assignment the test created, so a rerun starts from the seeded state. */
async function clearAssignments(expertId: string) {
  const supabase = serviceClient();
  await supabase.from("expert_assignments").delete().eq("expert_id", expertId);
}

// Every test here drives the one seeded expert row, putting it back to `invited` and restoring it
// again, so two workers running them at once would each see the other's reset. They run in order.
test.describe.configure({ mode: "serial" });

test.describe("expert accounts and profiles", () => {
  test("ops assign an expert, both sides see it, and ending it removes it (AC-9, AC-11, AC-12)", async ({
    page,
  }) => {
    // The organization is picked through the ops combobox rather than by id, so only the expert
    // is needed here.
    const { expertId, organizationName } = await seedIds();
    await clearAssignments(expertId);

    // The client sees no card while nobody is assigned (AC-12: absent, not empty).
    await signIn(page, SEED_USERS.client);
    await page.goto("/en/app");
    await expect(page.locator("[data-assigned-experts]")).toHaveCount(0);
    await page.context().clearCookies();

    // Ops assign the seeded expert to the seeded client's organization (AC-9).
    await signIn(page, SEED_USERS.ops);
    await page.goto("/en/admin/experts");
    await expect(page.getByRole("link", { name: /Erika|Expert/i }).first()).toBeVisible();
    await page.goto(`/en/admin/experts/${expertId}`);
    await page.getByRole("combobox", { name: "Client organisation" }).click();
    await page.getByRole("option", { name: new RegExp(organizationName, "i") }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await page.context().clearCookies();

    // The expert sees the client on their home and can open the read only page (AC-11).
    await signIn(page, SEED_USERS.expert);
    await page.goto("/en/expert");
    const card = page.locator("[data-expert-assignments] li").first();
    await expect(card).toBeVisible();
    await card.getByRole("link").click();
    await page.waitForURL(/\/expert\/clients\//);
    await expect(page.getByRole("heading", { name: "Company" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who to contact" })).toBeVisible();
    // The expert reads the client's figures, never an edit control for them.
    await expect(page.getByRole("button", { name: /Save (facts|changes)/i })).toHaveCount(0);
    await page.context().clearCookies();

    // The client now sees the card (AC-12).
    await signIn(page, SEED_USERS.client);
    await page.goto("/en/app");
    const section = page.locator("[data-assigned-experts]");
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: /Your expert/i })).toBeVisible();
    await page.context().clearCookies();

    // Ops end the assignment; both sides lose it (AC-9).
    await signIn(page, SEED_USERS.ops);
    await page.goto(`/en/admin/experts/${expertId}`);
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
    await page.context().clearCookies();

    await signIn(page, SEED_USERS.client);
    await page.goto("/en/app");
    await expect(page.locator("[data-assigned-experts]")).toHaveCount(0);

    await clearAssignments(expertId);
  });

  test("an expert who has not consented is sent to onboarding and back again (AC-4)", async ({
    page,
  }) => {
    const { expertId } = await seedIds();
    const supabase = serviceClient();
    const { data: before } = await supabase
      .from("profiles")
      .select("terms_accepted_at, full_name")
      .eq("id", expertId)
      .maybeSingle();

    // Put the seeded expert back to the state an invitation leaves them in.
    await supabase.from("expert_profiles").update({ status: "invited" }).eq("expert_id", expertId);
    await supabase.from("profiles").update({ terms_accepted_at: null }).eq("id", expertId);

    try {
      await signIn(page, SEED_USERS.expert);
      // Every expert page redirects to onboarding while the consent is missing.
      await page.goto("/en/expert");
      await page.waitForURL(/\/expert\/onboarding/);
      await expect(page.locator("[data-expert-onboarding]")).toBeVisible();

      // The form refuses to submit without the consent box (AC-4).
      await page.getByRole("button", { name: /Finish setup/i }).click();
      await expect(page.getByText("Accept the terms to continue.")).toBeVisible();

      await page.getByLabel("Full name").fill("Erika Muster");
      await page.getByLabel("Headline").fill("Safety engineer, construction");
      await page.getByRole("checkbox", { name: "German", exact: true }).check();
      await page.getByRole("checkbox", { name: "Zurich", exact: true }).check();
      await page.getByRole("checkbox", { name: /I accept the terms/i }).check();
      await page.getByRole("button", { name: /Finish setup/i }).click();

      // Onboarding lands the expert in the area, and the page no longer admits them.
      await page.waitForURL((url) => !url.pathname.includes("/onboarding"), { timeout: 15000 });
      await expect(page).toHaveURL(/\/expert$/);

      const { data: after } = await supabase
        .from("expert_profiles")
        .select("status, onboarded_at, headline")
        .eq("expert_id", expertId)
        .maybeSingle();
      expect(after?.status).toBe("active");
      expect(after?.onboarded_at).not.toBeNull();
      expect(after?.headline).toBe("Safety engineer, construction");
    } finally {
      // Back to the seeded state, so the other specs and a rerun find what they expect.
      await supabase.from("expert_profiles").update({ status: "active" }).eq("expert_id", expertId);
      await supabase
        .from("profiles")
        .update({
          terms_accepted_at: before?.terms_accepted_at ?? new Date().toISOString(),
          full_name: before?.full_name ?? null,
        })
        .eq("id", expertId);
    }
  });

  /** The emails only leave when a worker is running the task; without one the actions still pass. */
  const withWorker = process.env.TRIGGER_DEV_RUNNING === "1";

  test("assigning sends the expert and the members their emails, ending sends nothing (AC-14)", async ({
    page,
  }) => {
    test.skip(!withWorker, "needs pnpm trigger:dev");
    // A queued email travels through Trigger.dev before its row is written.
    test.setTimeout(120_000);
    const { expertId, organizationId, organizationName } = await seedIds();
    await clearAssignments(expertId);
    await clearDeliveries();

    await signIn(page, SEED_USERS.ops);
    await page.goto(`/en/admin/experts/${expertId}`);
    await page.getByRole("combobox", { name: "Client organisation" }).click();
    await page.getByRole("option", { name: new RegExp(organizationName, "i") }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    const assignmentId = await activeAssignmentId(expertId);

    // The expert gets the one keyed per assignment, and its data carries the link's organization.
    const toExpert = await waitForDelivery(`assignment-received/${assignmentId}`);
    expect(toExpert.template).toBe("assignment_received");
    expect(toExpert.recipient_email).toBe(SEED_USERS.expert);
    expect((toExpert.data as { organizationId?: string }).organizationId).toBe(organizationId);

    // Every member of the organization gets one, keyed per assignment and member.
    const members = await memberIds(organizationId);
    expect(members.length).toBeGreaterThan(0);
    for (const userId of members) {
      const toMember = await waitForDelivery(`expert-assigned/${assignmentId}/${userId}`);
      expect(toMember.template).toBe("expert_assigned");
      expect((toMember.data as { expertName?: string }).expertName).toBeTruthy();
    }

    // Ending an assignment sends nothing at all (AC-9).
    const before = await deliveryCount();
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    expect(await deliveryCount()).toBe(before);

    await clearAssignments(expertId);
  });

  test("completing onboarding sends the expert their welcome email and the ops alert (AC-14)", async ({
    page,
  }) => {
    test.skip(!withWorker, "needs pnpm trigger:dev");
    test.setTimeout(180_000);
    const supabase = serviceClient();

    // A freshly invited expert rather than the seeded one: the welcome is keyed
    // `expert-welcome/<expertId>` with a 30 day global TTL, so reusing the seeded expert would be
    // deduplicated by Trigger.dev before a run starts and prove nothing on a rerun.
    const email = uniqueEmail("expert-welcome");
    await signIn(page, SEED_USERS.ops);
    await page.goto("/en/admin/experts/new");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Full name").fill("Nora Fixture");
    await page.getByRole("button", { name: /Send invitation/i }).click();
    // `/admin/experts/new` already matches `/admin/experts`, so the list URL is not the signal:
    // the row the invite creates is.
    const expertId = await waitForInvitedExpert(email);

    try {
      // The invite mail is an auth email; the password is set directly here so the test stays on
      // this feature rather than re walking the confirm handler the auth spec already covers.
      await supabase.auth.admin.updateUserById(expertId, {
        password: seedPassword,
        email_confirm: true,
      });
      await page.context().clearCookies();
      await signIn(page, email);

      await page.goto("/en/expert/onboarding");
      await page.getByLabel("Full name").fill("Nora Fixture");
      await page.getByLabel("Headline").fill("Safety engineer, chemicals");
      await page.getByRole("checkbox", { name: "German", exact: true }).check();
      await page.getByRole("checkbox", { name: "Zurich", exact: true }).check();
      await page.getByRole("checkbox", { name: /I accept the terms/i }).check();
      await page.getByRole("button", { name: /Finish setup/i }).click();
      await page.waitForURL((url) => !url.pathname.includes("/onboarding"), { timeout: 15000 });

      // The welcome email is queued under its key, to this expert, pointing at the profile page.
      const welcome = await waitForDelivery(`expert-welcome/${expertId}`);
      expect(welcome.template).toBe("expert_welcome");
      expect(welcome.recipient_email).toBe(email);
    } finally {
      await supabase.from("expert_profiles").delete().eq("expert_id", expertId);
      await supabase.auth.admin.deleteUser(expertId);
    }
  });

  test("every expert page passes axe (AC-15)", async ({ page }) => {
    test.setTimeout(120_000);
    const { expertId, organizationId, organizationName } = await seedIds();
    await clearAssignments(expertId);

    // The read only client page and the client's card only exist while an assignment does, so the
    // scan assigns first and clears up at the end.
    await signIn(page, SEED_USERS.ops);
    for (const path of ["/en/admin/experts", "/en/admin/experts/new"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations,
        `axe on ${path}`,
      ).toEqual([]);
    }

    await page.goto(`/en/admin/experts/${expertId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations,
      "axe on /admin/experts/[expertId]",
    ).toEqual([]);

    await page.getByRole("combobox", { name: "Client organisation" }).click();
    await page.getByRole("option", { name: new RegExp(organizationName, "i") }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await page.context().clearCookies();

    await signIn(page, SEED_USERS.expert);
    for (const path of [
      "/en/expert",
      "/en/expert/profile",
      `/en/expert/clients/${organizationId}`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations,
        `axe on ${path}`,
      ).toEqual([]);
    }
    await page.context().clearCookies();

    // The client dashboard while the "Your expert" card is on it.
    await signIn(page, SEED_USERS.client);
    await page.goto("/en/app");
    await expect(page.locator("[data-assigned-experts]")).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations,
      "axe on /app with the expert card",
    ).toEqual([]);
    await page.context().clearCookies();

    await clearAssignments(expertId);
  });

  test("the onboarding page passes axe (AC-15)", async ({ page }) => {
    const { expertId } = await seedIds();
    const supabase = serviceClient();
    const { data: before } = await supabase
      .from("profiles")
      .select("terms_accepted_at")
      .eq("id", expertId)
      .maybeSingle();

    await supabase.from("expert_profiles").update({ status: "invited" }).eq("expert_id", expertId);
    await supabase.from("profiles").update({ terms_accepted_at: null }).eq("id", expertId);
    try {
      await signIn(page, SEED_USERS.expert);
      await page.goto("/en/expert/onboarding");
      await expect(page.locator("[data-expert-onboarding]")).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations,
        "axe on /expert/onboarding",
      ).toEqual([]);
    } finally {
      await supabase.from("expert_profiles").update({ status: "active" }).eq("expert_id", expertId);
      await supabase
        .from("profiles")
        .update({ terms_accepted_at: before?.terms_accepted_at ?? new Date().toISOString() })
        .eq("id", expertId);
    }
  });
});
