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

test.afterAll(async () => {
  const supabase = serviceClient();
  // The contacts cascade from the company; the unlocks and ledger debits of later milestones
  // cascade from the contacts.
  await supabase.from("directory_companies").delete().eq("id", companyId);
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

  test("a client cannot open the directory", async ({ page }) => {
    await signIn(page, SEED_USERS.client);
    await page.goto("/de/expert/kontakte");
    await expect(page).not.toHaveURL(/\/expert\/kontakte/);
  });
});
