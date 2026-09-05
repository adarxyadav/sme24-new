import { expect, test } from "@playwright/test";
import {
  accountByEmail,
  createConfirmedClient,
  dbAvailable,
  deleteAccount,
  serviceClient,
} from "./db";
import { mailAvailable, readMail, uniqueEmail } from "./mail";

/**
 * The welcome email end to end (spec 0006, AC-1, AC-3, AC-5, AC-14): a confirmed client's first
 * sign in creates the organization, the send-email task writes the delivery and notification rows
 * and Mailpit holds the German welcome with the organization name and a button to /de/app. The
 * task runs only while `pnpm trigger:dev` is up, so the assertions need `TRIGGER_DEV_RUNNING=1`
 * next to the local stack; without it the test skips.
 */
const localOnly = !mailAvailable || !dbAvailable;
const PASSWORD = "korrekt-pferd-batterie";

test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");
test.skip(
  process.env.TRIGGER_DEV_RUNNING !== "1",
  "set TRIGGER_DEV_RUNNING=1 while `pnpm trigger:dev` runs to assert on the welcome email",
);

test("the first sign in sends the welcome email in the user's language and writes both rows", async ({
  page,
}) => {
  const email = uniqueEmail("welcome");
  const organizationName = "Willkommen AG";
  try {
    await createConfirmedClient(email, PASSWORD, organizationName);
    await page.goto("/de/sign-in");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-Mail").fill(email);
    await page.getByLabel("Passwort").fill(PASSWORD);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/de\/app$/);

    const account = await accountByEmail(email);
    const organizationId = account?.organization?.id;
    expect(organizationId).toBeTruthy();

    const db = serviceClient();
    await expect
      .poll(
        async () => {
          const { data } = await db
            .from("email_deliveries")
            .select("status")
            .eq("idempotency_key", `welcome/${organizationId}`)
            .maybeSingle();
          return data?.status ?? null;
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe("sent");

    const { data: delivery } = await db
      .from("email_deliveries")
      .select("id, locale, recipient_email, subject, transport, source_event")
      .eq("idempotency_key", `welcome/${organizationId}`)
      .single();
    expect(delivery).toMatchObject({
      locale: "de",
      recipient_email: email,
      subject: `Willkommen bei SME24, ${organizationName}`,
      transport: "smtp",
      source_event: "auth.organization_created",
    });

    const { data: notifications } = await db
      .from("notifications")
      .select("kind, link, recipient_id")
      .eq("delivery_id", delivery?.id ?? "");
    expect(notifications).toEqual([
      { kind: "welcome", link: "/app", recipient_id: account?.user.id },
    ]);

    const mail = await readMail(email, { timeoutMs: 30_000 });
    expect(mail.subject).toBe(`Willkommen bei SME24, ${organizationName}`);
    expect(mail.html).toContain(organizationName);
    expect(mail.html).toContain("Guten Tag Fixture");
    expect(mail.links.some((link) => link.endsWith("/de/app"))).toBe(true);
  } finally {
    // The delivery row outlives the user by design (recipient set to null), so it goes by hand.
    await serviceClient().from("email_deliveries").delete().eq("recipient_email", email);
    await deleteAccount(email);
  }
});
