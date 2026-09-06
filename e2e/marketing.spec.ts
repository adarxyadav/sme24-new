import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { dbAvailable, serviceClient } from "./db";
import { mailAvailable, mailIds, readMail, uniqueEmail } from "./mail";

/**
 * The public site (spec 0009): every marketing page in both languages and both themes passes
 * axe, the header carries the localized slugs and marks the current page, a slug of the other
 * language is a 404, the landing field prefills the sign up, the contact form's error state
 * passes axe, the contact thread stores the row and (with the worker running) reaches Mailpit,
 * the sixth submission from one address is rate limited, and the discoverability layer answers.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PAGES = {
  en: ["", "/pricing", "/about", "/contact"],
  de: ["", "/preise", "/ueber-uns", "/kontakt"],
} as const;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    window.localStorage.setItem("theme", value);
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  for (const locale of ["de", "en"] as const) {
    for (const path of PAGES[locale]) {
      test(`/${locale}${path} in ${theme}: one h1, no WCAG 2.2 AA violations (AC-1, AC-15)`, async ({
        page,
      }) => {
        await forceTheme(page, theme);
        await page.goto(`/${locale}${path}`);
        await expect(page.locator("html")).toHaveAttribute("lang", `${locale}-CH`);
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }
}

test("the header links carry the German slugs and mark the current page (AC-7)", async ({
  page,
}) => {
  await page.goto("/de/preise");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" }).first();
  await expect(nav.getByRole("link", { name: "Preise" })).toHaveAttribute("href", "/de/preise");
  await expect(nav.getByRole("link", { name: "Preise" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Über uns" })).toHaveAttribute(
    "href",
    "/de/ueber-uns",
  );
  await expect(nav.getByRole("link", { name: "Kontakt" })).toHaveAttribute("href", "/de/kontakt");
  await expect(nav.getByRole("link", { name: "Kontakt" })).not.toHaveAttribute("aria-current");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("navigation", { name: "Produkt" })).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Unternehmen" })).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Rechtliches" })).toHaveCount(0);
});

test("a slug of the other language redirects to the language's own slug, so no second copy exists (AC-1)", async ({
  request,
}) => {
  // next-intl redirects an unlocalized or foreign slug to the requested language's slug (a 307),
  // so neither `/de/pricing` nor `/en/preise` ever renders a page of its own. The chain is
  // followed rather than read hop by hop: on a Vercel deployment the protection bypass answers
  // the first request with a 307 to the same path to set its cookie, before next-intl runs.
  for (const [path, target] of [
    ["/de/pricing", "/de/preise"],
    ["/de/about", "/de/ueber-uns"],
    ["/en/preise", "/en/pricing"],
    ["/en/kontakt", "/en/contact"],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(new URL(response.url()).pathname, path).toBe(target);
  }
});

test("the landing field carries the company name into the sign up form, an empty field opens it bare (AC-5)", async ({
  page,
}) => {
  await page.goto("/en");
  const field = page.getByLabel("Your company").first();
  await field.fill("Geberit AG");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/en\/sign-up\?company=Geberit(\+|%20)AG$/);
  await expect(page.getByLabel("Company")).toHaveValue("Geberit AG");

  await page.goto("/en");
  await page.getByRole("button", { name: "Benchmark your company for free" }).first().click();
  await expect(page).toHaveURL(/\/en\/sign-up$/);
  await expect(page.getByLabel("Company")).toHaveValue("");
});

test("the contact form's error state announces a summary and passes axe (AC-8, AC-15)", async ({
  page,
}) => {
  await page.goto("/en/contact");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Please check these fields" }),
  ).toBeVisible();
  await expect(page.locator("#enquiry-companyName")).toHaveAttribute("aria-invalid", "true");
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test("the sitemap, robots and the social cards answer (AC-2, AC-4)", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/de/kontakt", "/de/preise", "/de/ueber-uns", "/en/contact", "/en/pricing"]) {
    expect(sitemap).toContain(`${path}</loc>`);
  }
  expect(sitemap).not.toContain("/de/contact</loc>");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \//);

  const html = await (await request.get("/de/kontakt")).text();
  const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const alt = html.match(/<meta property="og:image:alt" content="([^"]+)"/)?.[1];
  expect(alt).toBe("Reden Sie mit einem Menschen.");
  expect(image).toBeTruthy();
  const card = await request.get(image as string);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
  const png = await card.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});

test.describe("the contact thread", () => {
  test.skip(!dbAvailable, "the local stack's keys are not in the environment");
  const email = uniqueEmail("enquiry");
  let id = "";

  test.afterAll(async () => {
    const db = serviceClient();
    await db.from("enquiries").delete().eq("email", email);
    if (id) await db.from("email_deliveries").delete().like("idempotency_key", `enquiry/${id}/%`);
  });

  test("stores a German retainer enquiry, shows the confirmation and acknowledges it (AC-8, AC-9, AC-14)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seen = mailAvailable ? await mailIds(email) : [];
    await page.goto("/de/kontakt?topic=retainer");
    await expect(page.getByRole("radio", { name: "Retainer" })).toBeChecked();
    await page.getByRole("textbox", { name: "Unternehmen", exact: true }).fill("Playwright AG");
    await page.getByLabel("Ihr Name").fill("Pia Playwright");
    await page.getByLabel("Geschäftliche E-Mail").fill(email);
    await page
      .getByRole("textbox", { name: "Nachricht" })
      .fill("Wir suchen einen dauerhaften EHS-Partner für zwei Standorte.");
    await expect(page.getByText(/von 2000 Zeichen/)).toBeVisible();
    // The timing guard refuses a submission under three seconds after the form mounted.
    await page.waitForTimeout(3_200);
    await page.getByRole("button", { name: "Anfrage senden" }).click();
    await expect(page.getByRole("status")).toContainText("Danke. Ihre Anfrage ist bei uns.");

    const { data: rows } = await serviceClient().from("enquiries").select("*").eq("email", email);
    expect(rows).toHaveLength(1);
    const row = rows?.[0];
    id = row?.id ?? "";
    expect(row).toMatchObject({
      topic: "retainer",
      locale: "de",
      status: "new",
      company_name: "Playwright AG",
      organization_id: null,
      submitted_by: null,
    });

    if (process.env.TRIGGER_DEV_RUNNING === "1" && mailAvailable) {
      const mail = await readMail(email, { seen, timeoutMs: 60_000 });
      expect(mail.subject).toBe("Ihre Anfrage ist bei SME24 eingegangen");
      expect(mail.html).toContain("Retainer-Anfrage");
    }
  });
});

test.describe("the address rate limit", () => {
  test.skip(!dbAvailable, "the local stack's keys are not in the environment");
  const address = "203.0.113.77";
  const hash = createHash("sha256").update(address).digest("hex");
  test.use({ extraHTTPHeaders: { "x-forwarded-for": address } });

  test.beforeAll(async () => {
    const { error } = await serviceClient()
      .from("enquiries")
      .insert(
        [1, 2, 3, 4, 5].map((n) => ({
          topic: "general",
          company_name: "Flood AG",
          contact_name: "Flo",
          email: `flood-${n}@example.test`,
          message: `Seeded submission number ${n} from one address.`,
          locale: "en",
          ip_hash: hash,
        })),
      );
    if (error) throw error;
  });

  test.afterAll(async () => {
    await serviceClient().from("enquiries").delete().eq("ip_hash", hash);
  });

  test("the sixth submission from one address in an hour is refused with the contact address (AC-10)", async ({
    page,
  }) => {
    await page.goto("/en/contact");
    await page.getByRole("textbox", { name: "Company", exact: true }).fill("Flood AG");
    await page.getByLabel("Your name").fill("Flo");
    await page.getByLabel("Work email").fill("flood-6@example.test");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("The sixth submission from the same address today.");
    await page.waitForTimeout(3_200);
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "write to service@sme24.ch" }),
    ).toBeVisible();
    const { count } = await serviceClient()
      .from("enquiries")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", hash);
    expect(count).toBe(5);
  });
});
