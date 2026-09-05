import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dbAvailable, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * The ops outbox (spec 0006, AC-9, AC-10): both pages render in both languages for the ops user,
 * pass axe, the filters narrow the list, the detail page shows the rerendered preview and the
 * retry button on a failed row, and a client meets the forbidden page. Rows are written with the
 * service key and removed again. Needs the seeded users and the local stack's keys.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.skip(!seedPassword, "E2E_SEED_PASSWORD is not set; seeded users are unavailable");

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const failedKey = `e2e/failed/${RUN}`;
const sentKey = `e2e/sent/${RUN}`;

test.describe("ops outbox", () => {
  test.skip(!dbAvailable, "the local stack's keys are not in the environment");

  let failedId = "";

  test.beforeAll(async () => {
    const db = serviceClient();
    const { data, error } = await db
      .from("email_deliveries")
      .insert([
        {
          idempotency_key: failedKey,
          source_event: "ops.test_email",
          template: "welcome",
          locale: "de",
          recipient_email: `e2e-failed-${RUN}@example.test`,
          subject: "Willkommen bei SME24, E2E AG",
          data: { organizationName: "E2E AG", firstName: "Eva" },
          status: "failed",
          error: "provider said no",
          attempts: 1,
          transport: "smtp",
        },
        {
          idempotency_key: sentKey,
          source_event: "ops.test_email",
          template: "welcome",
          locale: "en",
          recipient_email: `e2e-sent-${RUN}@example.test`,
          subject: "Welcome to SME24, E2E Ltd",
          data: { organizationName: "E2E Ltd" },
          status: "sent",
          attempts: 1,
          transport: "smtp",
        },
      ])
      .select("id, idempotency_key");
    if (error) throw error;
    failedId = data.find((row) => row.idempotency_key === failedKey)?.id ?? "";
  });

  test.afterAll(async () => {
    await serviceClient()
      .from("email_deliveries")
      .delete()
      .in("idempotency_key", [failedKey, sentKey]);
  });

  for (const locale of ["de", "en"] as const) {
    test(`the list and the detail page in ${locale} pass axe and show the rows (AC-9)`, async ({
      page,
    }) => {
      await signIn(page, SEED_USERS.ops);
      await page.goto(`/${locale}/admin/emails`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "de" ? "E-Mails" : "Emails",
      );
      await expect(
        page.getByRole("link", { name: `e2e-failed-${RUN}@example.test` }),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()).violations).toEqual([]);

      await page.getByRole("link", { name: `e2e-failed-${RUN}@example.test` }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/admin/emails/${failedId}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.getByRole("button", { name: locale === "de" ? "Erneut senden" : "Send again" }),
      ).toBeVisible();
      const frame = page.frameLocator("iframe[sandbox]");
      await expect(frame.getByText("Guten Tag Eva")).toBeVisible();
      // The intro paragraph, not the hidden inbox preview text that repeats the sentence.
      await expect(
        frame.locator("p", { hasText: "Ihr Konto für E2E AG ist eingerichtet." }),
      ).toBeVisible();
      await expect(frame.getByRole("link", { name: "Zum Kundenbereich" })).toBeVisible();
      // The preview frame is fully sandboxed, so axe cannot enter it; the email HTML is not app UI.
      const detail = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .exclude("iframe[sandbox]")
        .analyze();
      expect(detail.violations).toEqual([]);
    });
  }

  test("the status filter and the search narrow the list (AC-9)", async ({ page }) => {
    await signIn(page, SEED_USERS.ops);
    await page.goto(`/de/admin/emails?status=failed&q=e2e-failed-${RUN}`);
    await expect(page.getByRole("link", { name: `e2e-failed-${RUN}@example.test` })).toBeVisible();
    await expect(page.getByRole("link", { name: `e2e-sent-${RUN}@example.test` })).toHaveCount(0);

    await page.goto(`/de/admin/emails?status=sent&q=e2e-failed-${RUN}`);
    await expect(page.getByText("Keine Treffer")).toBeVisible();

    await page.goto(`/de/admin/emails?status=bogus&q=e2e-sent-${RUN}`);
    await expect(page.getByRole("link", { name: `e2e-sent-${RUN}@example.test` })).toBeVisible();
  });

  test("the retry button answers with a toast when Trigger.dev is not configured locally (AC-10)", async ({
    page,
  }) => {
    test.skip(
      Boolean(process.env.TRIGGER_SECRET_KEY),
      "Trigger.dev is configured; the retry would run",
    );
    await signIn(page, SEED_USERS.ops);
    await page.goto(`/de/admin/emails/${failedId}`);
    await page.getByRole("button", { name: "Erneut senden" }).click();
    await expect(
      page.getByText("Trigger.dev ist in dieser Umgebung nicht konfiguriert", { exact: false }),
    ).toBeVisible();
  });
});

test("a client meets the forbidden page on the outbox (AC-9)", async ({ page }) => {
  await signIn(page, SEED_USERS.client);
  await page.goto("/de/admin/emails");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
});
