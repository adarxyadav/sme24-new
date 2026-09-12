import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dbAvailable, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * The contact directory end to end (spec 0018, milestone 2: AC-4, AC-5). Invented rows are
 * inserted through the service client for the duration of the file and removed afterwards, so
 * no personal data from the purchased list ever enters a test (invariant 11). The seeded expert
 * is `active`, which is what the definer functions require.
 */

test.skip(!seedPassword || !dbAvailable, "needs the local stack and E2E_SEED_PASSWORD");
// One fixture company for the whole file, so the tests run in one worker rather than each
// inserting it again.
test.describe.configure({ mode: "serial" });

/** The WCAG 2.2 AA tag set every axe scan in this repo runs with. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A company name no real list carries, so the search finds only the fixture. */
const COMPANY = "Zebrafixture Sicherheitstechnik AG";
const CONTACT_EMAIL = "erika.fixture@zebrafixture.test";

let companyId: string;

test.beforeAll(async () => {
  const supabase = serviceClient();
  // An interrupted earlier run may have left the fixture behind; the company cascades its contacts.
  await supabase.from("directory_companies").delete().eq("name_normalised", COMPANY.toLowerCase());
  const { data: company, error } = await supabase
    .from("directory_companies")
    .insert({
      name: COMPANY,
      name_normalised: COMPANY.toLowerCase(),
      country: "CH",
      city: "Baar",
    })
    .select("id")
    .single();
  if (error) throw error;
  companyId = company.id;
  const { error: contactError } = await supabase.from("directory_contacts").insert([
    {
      company_id: companyId,
      first_name: "Erika",
      last_name: "Fixture",
      title: "Head of EHS",
      email: CONTACT_EMAIL,
      phone: "+41 41 000 00 99",
      country: "CH",
      city: "Baar",
      source_batch: "e2e fixture",
      imported_at: new Date().toISOString(),
    },
    {
      company_id: companyId,
      first_name: "Fritz",
      last_name: "Fixture",
      title: "Operations Director",
      email: "fritz.fixture@zebrafixture.test",
      mobile: "079 000 00 11",
      country: "CH",
      city: "Baar",
      source_batch: "e2e fixture",
      imported_at: new Date().toISOString(),
    },
  ]);
  if (contactError) throw contactError;
});

/** The ids of the fixture contacts, for the unlock clean up. */
async function fixtureContactIds(): Promise<string[]> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from("directory_contacts")
    .select("id")
    .eq("company_id", companyId);
  return (data ?? []).map((row) => row.id);
}

test.afterAll(async () => {
  const supabase = serviceClient();
  // The contacts cascade from the company; the unlocks and ledger debits of later milestones
  // cascade from the contacts. The suppression the ops test wrote is removed so the fixture can
  // load again on the next run.
  await supabase.from("directory_companies").delete().eq("id", companyId);
  await supabase
    .from("directory_suppressions")
    .delete()
    .eq("email_hash", createHash("sha256").update("fritz.fixture@zebrafixture.test").digest("hex"));
});

test.describe("the directory browse (AC-5)", () => {
  test("an active expert searches by company and sees masked values, then the page passes axe", async ({
    page,
  }, testInfo) => {
    await signIn(page, SEED_USERS.expert);
    await page.goto("/de/expert/kontakte?q=zebrafixture");
    await expect(page.getByRole("heading", { level: 1, name: "Kontaktverzeichnis" })).toBeVisible();

    // The balance and the two ways onward sit in the header.
    await expect(page.getByTestId("directory-balance")).toContainText("Credits");
    await expect(page.getByRole("link", { name: "Credits kaufen" })).toBeVisible();

    // Two fixture rows, both masked: the first character, bullets, the domain; never the address.
    const table = page.getByRole("table");
    await expect(table.getByText(COMPANY)).toHaveCount(2);
    await expect(table.getByText("e••••••••••••@zebrafixture.test")).toBeVisible();
    await expect(table.getByText("+41 •• ••• •• 99")).toBeVisible();
    await expect(page.getByText(CONTACT_EMAIL)).toHaveCount(0);
    await expect(table.getByText("1 Credit, CHF 1.99")).toHaveCount(2);

    await page.screenshot({
      path: testInfo.outputPath("directory-browse.png"),
      fullPage: true,
    });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("a one character query is refused inline, and a broken cursor is a 404", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.expert);
    await page.goto("/de/expert/kontakte?q=z");
    await expect(page.getByText("Geben Sie mindestens zwei Zeichen ein.")).toBeVisible();
    await expect(page.getByLabel("Firma")).toHaveAttribute("aria-invalid", "true");

    // The page calls notFound(); the area streams inside its loading boundary, so the status is
    // already sent and the not found page is what the reader sees.
    await page.goto("/de/expert/kontakte?after=not-a-cursor");
    await expect(page.getByText(/could not be found|nicht gefunden/i)).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("the country filter narrows the list and the title filter matches within it", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.expert);
    await page.goto("/de/expert/kontakte?q=zebrafixture&title=operations&country=CH");
    const table = page.getByRole("table");
    await expect(table.getByText("Fritz Fixture")).toBeVisible();
    await expect(table.getByText("Erika Fixture")).toHaveCount(0);
  });

  test("an expert with one credit unlocks a row, keeps it after a reload, and exports it (AC-11 to AC-13)", async ({
    page,
  }) => {
    const supabase = serviceClient();
    const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const expert = users.users.find((user) => user.email === SEED_USERS.expert);
    if (!expert) throw new Error("the seeded expert is needed");
    // A clean slate for the fixture contacts, then exactly one credit, granted by hand (the
    // purchase path is proved by pgTAP and the checkout spec).
    await supabase.from("directory_credit_entries").delete().eq("expert_id", expert.id);
    await supabase
      .from("directory_unlocks")
      .delete()
      .eq("expert_id", expert.id)
      .in("contact_id", await fixtureContactIds());
    await supabase
      .from("directory_credit_entries")
      .insert({ expert_id: expert.id, delta: 1, reason: "grant", note: "e2e" });

    await signIn(page, SEED_USERS.expert);
    await page.goto("/de/expert/kontakte?q=zebrafixture&title=head");
    await expect(page.getByTestId("directory-balance")).toHaveText(/1 Credit/);
    await page.getByRole("button", { name: /Freischalten/ }).click();

    // The raw values and the new balance land in the click handler that awaited the action.
    await expect(page.getByRole("table").getByText(CONTACT_EMAIL)).toBeVisible();
    await expect(page.getByRole("table").getByText("+41 41 000 00 99")).toBeVisible();
    await expect(page.getByTestId("directory-balance")).toHaveText(/0 Credits/);

    // A second row at zero is refused inline with the way to buy more.
    await page.goto("/de/expert/kontakte?q=zebrafixture");
    await expect(page.getByRole("table").getByText(CONTACT_EMAIL)).toBeVisible();
    await page.getByRole("button", { name: /Freischalten/ }).click();
    await expect(page.getByRole("table").getByRole("alert")).toContainText("Keine Credits mehr.");
    await expect(
      page.getByRole("table").getByRole("alert").getByRole("link", { name: "Credits kaufen" }),
    ).toBeVisible();

    // The unlocks page lists it, and the export carries it with the German header row.
    await page.goto("/de/expert/kontakte/freigeschaltet");
    await expect(page.getByRole("table").getByText(CONTACT_EMAIL)).toBeVisible();
    const response = await page.request.get("/api/directory/unlocks/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toMatch(
      /attachment; filename="sme24-directory-unlocks-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const csv = await response.text();
    expect(
      csv.startsWith(
        "\uFEFFFirma,Land,Ort,Vorname,Nachname,Funktion,E-Mail,Telefon,Mobil,Freigeschaltet am (UTC)\r\n",
      ),
    ).toBe(true);
    expect(csv).toContain(
      `${COMPANY},CH,Baar,Erika,Fixture,Head of EHS,${CONTACT_EMAIL},'+41 41 000 00 99,,`,
    );
    // The phone starts with a plus, so the cell is guarded against formula execution.
    expect(csv).toContain(",'+41 41 000 00 99,");
  });

  test("an expert buys a credit pack by invoice: the order carries the expert buyer shape (AC-9)", async ({
    page,
  }, testInfo) => {
    const supabase = serviceClient();
    const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const expert = users.users.find((user) => user.email === SEED_USERS.expert);
    if (!expert) throw new Error("the seeded expert is needed");

    await signIn(page, SEED_USERS.expert);
    await page.goto("/de/expert/kontakte/guthaben");
    await expect(page.getByRole("heading", { level: 1, name: "Credits kaufen" })).toBeVisible();
    // The cookie bar is fixed to the bottom of the viewport and would sit on the submit button.
    await page.getByTestId("cookie-bar").getByRole("button", { name: "Ablehnen" }).click();
    await expect(page.getByTestId("cookie-bar")).toHaveCount(0);
    await expect(page.getByText("50 Verzeichnis-Credits")).toBeVisible();
    await expect(page.getByText("CHF 99.50")).toBeVisible();
    await expect(page.getByText("CHF 107.56")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("directory-credits.png"), fullPage: true });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);

    await page.getByLabel("Strasse und Nummer").fill("Bahnhofstrasse 1");
    await page.getByLabel("PLZ").fill("6340");
    await page.getByLabel("Ort").fill("Baar");
    await page.getByRole("radio", { name: /Rechnung/ }).click();
    await page.getByRole("button", { name: "Rechnung anfordern" }).click();
    await page.waitForURL(/\/expert\/kontakte\/guthaben\?order=/);
    await expect(page.getByText("Rechnung angefordert")).toBeVisible();

    const orderId = new URL(page.url()).searchParams.get("order") as string;
    const { data: order } = await supabase
      .from("orders")
      .select(
        "buyer_expert_id, organization_id, company_id, credits, package_key, payment_method, billing_country, net_rappen, gross_rappen, status",
      )
      .eq("id", orderId)
      .single();
    expect(order).toMatchObject({
      buyer_expert_id: expert.id,
      organization_id: null,
      company_id: null,
      credits: 50,
      package_key: "directory_50",
      payment_method: "bank_transfer",
      billing_country: "CH",
      net_rappen: 9950,
      gross_rappen: 10756,
      status: "pending",
    });
    // No credits until ops mark the transfer paid.
    const { count } = await supabase
      .from("directory_credit_entries")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
    expect(count).toBe(0);

    // Clean up: the pgTAP seed guard refuses a database holding orders.
    await supabase.from("invoices").delete().eq("order_id", orderId);
    await supabase.from("orders").delete().eq("id", orderId);
  });

  test("ops see the directory and remove a person, who never returns (AC-15)", async ({
    page,
  }, testInfo) => {
    await signIn(page, SEED_USERS.ops);
    await page.goto("/de/admin/directory");
    await expect(page.getByRole("heading", { level: 1, name: "Kontaktverzeichnis" })).toBeVisible();
    await expect(page.getByText("Im Verzeichnis")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("directory-admin.png"), fullPage: true });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);

    await page.getByTestId("cookie-bar").getByRole("button", { name: "Ablehnen" }).click();
    await page.getByLabel("E-Mail-Adresse").fill("Fritz.Fixture@zebrafixture.test");
    await page.getByRole("button", { name: "Entfernen" }).click();
    await expect(page.getByRole("alert").first()).toContainText("Entfernt.");

    const supabase = serviceClient();
    const { count } = await supabase
      .from("directory_contacts")
      .select("id", { count: "exact", head: true })
      .eq("email", "fritz.fixture@zebrafixture.test");
    expect(count).toBe(0);
    const { data: suppressions } = await supabase
      .from("directory_suppressions")
      .select("email_hash, reason")
      .eq("reason", "data_subject_request");
    expect(suppressions?.length).toBeGreaterThan(0);
    // The hash outlives the row: a second removal of the same address is still an honest answer.
    await page.getByLabel("E-Mail-Adresse").fill("fritz.fixture@zebrafixture.test");
    await page.getByRole("button", { name: "Entfernen" }).click();
    await expect(page.getByRole("alert").first()).toContainText("Kein Kontakt mit dieser Adresse");
  });

  test("a client cannot open the directory", async ({ page }) => {
    await signIn(page, SEED_USERS.client);
    await page.goto("/de/expert/kontakte");
    await expect(page).not.toHaveURL(/\/expert\/kontakte/);
  });
});
