import { expect, test } from "@playwright/test";
import { dbAvailable, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * One expert end to end (spec 0013, milestone 2): the onboarding gate and its consent (AC-4), the
 * ops assign and end controls (AC-9), the expert's own client list and the read only client page
 * (AC-11), and the client's "Your expert" card (AC-12).
 *
 * The seeded expert is already `active` and onboarded, so the gate and the onboarding form are
 * exercised by putting that row back to `invited` for the duration of the test and restoring it
 * afterwards; every other step runs against the seeded rows as they are.
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
  return { expertId: expert.id, organizationId: profile.organization_id };
}

/** Removes every assignment the test created, so a rerun starts from the seeded state. */
async function clearAssignments(expertId: string) {
  const supabase = serviceClient();
  await supabase.from("expert_assignments").delete().eq("expert_id", expertId);
}

test.describe("expert accounts and profiles", () => {
  test("ops assign an expert, both sides see it, and ending it removes it (AC-9, AC-11, AC-12)", async ({
    page,
  }) => {
    // The organization is picked through the ops combobox rather than by id, so only the expert
    // is needed here.
    const { expertId } = await seedIds();
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
    await page.getByRole("combobox").click();
    await page.getByRole("option").first().click();
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
});
