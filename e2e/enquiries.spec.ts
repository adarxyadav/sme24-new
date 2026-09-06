import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dbAvailable, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * The ops enquiries pages (spec 0009, AC-12, AC-15): the list and the detail render in both
 * languages for the ops user and pass axe, the status filter narrows the list, the workflow form
 * moves a row to contacted with the handler recorded once, and a client meets the forbidden
 * page. Rows are written with the service key and removed again.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.skip(!seedPassword, "E2E_SEED_PASSWORD is not set; seeded users are unavailable");

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const company = `E2E Enquiry ${RUN}`;

test.describe("ops enquiries", () => {
  test.skip(!dbAvailable, "the local stack's keys are not in the environment");

  let id = "";

  test.beforeAll(async () => {
    const { data, error } = await serviceClient()
      .from("enquiries")
      .insert({
        topic: "retainer",
        company_name: company,
        contact_name: "Eva E2E",
        email: `e2e-enquiry-${RUN}@example.test`,
        message: "An ongoing EHS partner for our two sites, starting next quarter.",
        locale: "de",
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
  });

  test.afterAll(async () => {
    await serviceClient().from("enquiries").delete().eq("company_name", company);
  });

  for (const locale of ["de", "en"] as const) {
    test(`the list and the detail in ${locale} pass axe and show the row (AC-12, AC-15)`, async ({
      page,
    }) => {
      await signIn(page, SEED_USERS.ops);
      await page.goto(`/${locale}/admin/enquiries`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "de" ? "Anfragen" : "Enquiries",
      );
      await expect(page.getByRole("link", { name: company })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations).toEqual([]);

      await page.getByRole("link", { name: company }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/admin/enquiries/${id}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("An ongoing EHS partner for our two sites")).toBeVisible();
      await expect(page.getByText("German")).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations).toEqual([]);
    });
  }

  test("the status filter narrows the list and all lifts it (AC-12)", async ({ page }) => {
    await signIn(page, SEED_USERS.ops);
    await page.goto("/en/admin/enquiries?status=closed");
    await expect(page.getByRole("link", { name: company })).toHaveCount(0);
    await page.goto("/en/admin/enquiries?status=all");
    await expect(page.getByRole("link", { name: company })).toBeVisible();
  });

  test("the workflow form records the handler once and keeps it when the row is closed (AC-12)", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.ops);
    await page.goto(`/en/admin/enquiries/${id}`);
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Contacted" }).click();
    await page.getByRole("textbox", { name: "Note" }).fill("Called, proposal follows.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Enquiry saved")).toBeVisible();

    const db = serviceClient();
    const { data: contacted } = await db.from("enquiries").select("*").eq("id", id).single();
    expect(contacted).toMatchObject({ status: "contacted", ops_note: "Called, proposal follows." });
    expect(contacted?.handled_by).not.toBeNull();
    expect(contacted?.handled_at).not.toBeNull();

    await page.reload();
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Closed" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Enquiry saved")).toBeVisible();
    const { data: closed } = await db.from("enquiries").select("*").eq("id", id).single();
    expect(closed).toMatchObject({
      status: "closed",
      handled_by: contacted?.handled_by,
      handled_at: contacted?.handled_at,
    });
  });

  test("an unknown id renders the not found page (AC-12)", async ({ page }) => {
    await signIn(page, SEED_USERS.ops);
    // The admin shell streams (it has a loading boundary), so the not found boundary renders
    // inside the 200 response rather than as a 404 status.
    await page.goto("/en/admin/enquiries/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});

test("a client meets the forbidden page on the enquiries list (AC-12)", async ({ page }) => {
  await signIn(page, SEED_USERS.client);
  await page.goto("/de/admin/enquiries");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
});
