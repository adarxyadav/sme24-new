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
  en: ["", "/pricing", "/about", "/contact", "/expert-network/directory"],
  de: ["", "/preise", "/ueber-uns", "/kontakt", "/expertennetzwerk/verzeichnis"],
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
  await expect(nav.getByRole("link", { name: "Pakete" })).toHaveAttribute("href", "/de/preise");
  await expect(nav.getByRole("link", { name: "Pakete" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "So funktioniert’s" })).toHaveAttribute(
    "href",
    "/de/so-funktionierts",
  );
  await expect(nav.getByRole("link", { name: "So funktioniert’s" })).not.toHaveAttribute(
    "aria-current",
  );
  await expect(nav.getByRole("link", { name: "Expertennetzwerk" })).toHaveAttribute(
    "href",
    "/de/expertennetzwerk",
  );
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("navigation", { name: "Produkt" })).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Unternehmen" })).toBeVisible();
  // The legal group was empty until feature 14 shipped the pages (spec 0015, AC-9); e2e/legal.spec.ts
  // asserts its four links and their German slugs.
  await expect(footer.getByRole("navigation", { name: "Rechtliches" })).toBeVisible();
  // About and contact left the header with the nav of 2026-09-07; the footer is now the only
  // place they are linked, so their German slugs are asserted there.
  const company = footer.getByRole("navigation", { name: "Unternehmen" });
  await expect(company.getByRole("link", { name: "Über uns" })).toHaveAttribute(
    "href",
    "/de/ueber-uns",
  );
  await expect(company.getByRole("link", { name: "Kontakt" })).toHaveAttribute(
    "href",
    "/de/kontakt",
  );
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
  await page.getByRole("button", { name: "See what your risk costs" }).first().click();
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

test("the expert directory filters the register in the browser without a request (directory)", async ({
  page,
}) => {
  await page.goto("/en/expert-network/directory");
  const table = page.getByRole("table");
  // The prerendered HTML already carries the first fifty rows, so they are readable before any
  // JavaScript runs.
  await expect(table.locator("tbody tr")).toHaveCount(50);

  // The controls only answer once the component has hydrated; the count paragraph is in the markup
  // from the start but stays empty until mount, so its text is the signal that the page is live.
  // Without this wait a `selectOption` lands on the server rendered markup and React discards it
  // on hydration.
  await expect(page.getByText(/entries$/)).toBeVisible();

  // Filtering is pure client work: no navigation, no fetch, and the row count follows the filter.
  // Only a request for this page counts. A real deployment also prefetches the header links and
  // flushes Sentry envelopes to its own ingest host once the page has loaded; both are background
  // traffic that has nothing to do with the filter, and neither happens on the local dev server,
  // so a blanket request count passes locally and fails against a deployment. A prefetch of a
  // dynamic route is marked `?_rsc=`, but the header's brand link points at the static home page,
  // whose prefetch is a plain document request for `/` or `/en` with no marker on it -- so the
  // path, not the marker, is what separates the filter's own traffic from the noise.
  const ownPath = new URL(page.url()).pathname;
  const fetched: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const own = url.origin === new URL(page.url()).origin && url.pathname === ownPath;
    const kind = request.resourceType();
    if (own && !url.searchParams.has("_rsc") && ["document", "fetch", "xhr"].includes(kind)) {
      fetched.push(request.url());
    }
  });
  await page.getByLabel("Canton").selectOption("UR");
  // `useDeferredValue` re-renders the rows in a later pass, so the count is awaited rather than
  // read straight after the select. Uri is the smallest canton in the register.
  await expect(table.locator("tbody tr")).toHaveCount(3);
  expect(fetched).toHaveLength(0);

  // No contact detail reaches the page: the register's address, phone and email columns are dropped.
  await expect(table.getByRole("link")).toHaveCount(0);
  expect(await table.textContent()).not.toMatch(/@|\+41/);
});

test("the expert network page links into the directory in both languages (directory)", async ({
  page,
}) => {
  await page.goto("/de/expertennetzwerk");
  await page.getByRole("link", { name: "Das ganze SGAS-Register ansehen" }).click();
  await expect(page).toHaveURL(/\/de\/expertennetzwerk\/verzeichnis$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

/*
 * The package cards, in the browser rather than in jsdom, because both of these failed a real page
 * while every unit test stayed green (2026-09-10).
 *
 * The contrast case: `text-button-14` shares the `text-*` namespace with the colour utilities the
 * button variant sets, so adding it to a filled button won the cascade and painted the label in the
 * foreground colour, black on black. jsdom computes no cascade, so only a rendered page catches it.
 *
 * The measure case: the longest package name runs to 47 characters in both languages and only sets
 * in two lines at the size the card uses. A regression to a larger step silently returns it to
 * three lines and breaks the row's rhythm.
 */
test("every package card's action contrasts, meets the target size, and no name runs past two lines", async ({
  page,
}) => {
  for (const path of ["/en/pricing", "/de/preise", "/en", "/de"]) {
    await page.goto(path);
    // Scoped to the packages section, not the whole page: the landing page's steps section
    // pictures the three fixed price packages inside its third step (`PackagesCard`), and it
    // renders that still twice -- once stacked for a phone, once in the pinned panel -- so an
    // unscoped locator counts ten cards on a page that offers four. The still's cards are the
    // same component and are checked on their own below.
    const cards = page
      .locator('section[aria-labelledby="packages-heading"]')
      .locator('[data-slot="package-card"]');
    await expect(cards).toHaveCount(4);

    for (const card of await cards.all()) {
      const action = card.locator('a[data-slot="button"]').first();
      const [color, background] = await action.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.color, style.backgroundColor];
      });
      // A filled button paints its own ground; a ghost link leaves it transparent. Either way the
      // label must not be painted in the colour it sits on.
      expect(color).not.toBe(background);

      // Counted from the text's own client rects rather than the element's height: the name
      // carries bottom padding (the space under it lives inside its grid track), so dividing the
      // padded box by the line height counts a line that is not there.
      const lines = await card.locator("h3").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 1);
        return new Set(rects.map((rect) => Math.round(rect.top))).size;
      });
      expect(lines).toBeLessThanOrEqual(2);

      // WCAG 2.2 AA target size (2.5.8). The action is the only control on the landing card, and
      // `py-2.5` on the `lg` button lands at 42px, so this is a real floor rather than a formality.
      const { height } = (await action.boundingBox()) ?? { height: 0 };
      expect(height).toBeGreaterThanOrEqual(44);
    }

    // The rows the shared grid exists to align. A package name runs to one line in some cards and
    // two in others, so without a row of its own the promise under it starts at a different height
    // in every card; the same holds for the price and the action below it.
    //
    // Each row is measured on the edge its own tracks align. A `self-start` row shares its top and
    // a `self-end` row its bottom, which is the same assertion while every card sets that row at
    // one size and a different one once they do not: "On demand" has sat two sizes below a franc
    // figure since 2026-09-10, so the price row's tops differ by the size gap (168px against
    // 180px) while its baselines still land together (208px in both). Measuring the top there
    // would fail a row that is correctly aligned.
    for (const { selector, edge } of [
      { selector: "h3 + p", edge: "top" },
      { selector: "p.self-end", edge: "bottom" },
      { selector: 'a[data-slot="button"]', edge: "top" },
    ] as const) {
      const offsets = await cards.evaluateAll(
        (nodes, { sel, side }) =>
          nodes.map((node) => {
            const child = node.querySelector(sel);
            if (!child) return -1;
            const box = child.getBoundingClientRect();
            const own = node.getBoundingClientRect();
            return Math.round((side === "top" ? box.top : box.bottom) - own.top);
          }),
        { sel: selector, side: edge },
      );
      expect(new Set(offsets).size, `${selector} (${edge} edge)`).toBe(1);
    }

    // The same cards inside the landing page's third step, where `PackagesCard` shows the three
    // fixed price packages as that step's still. It declares the `overview` row tracks itself,
    // because `PackageCard` is a `grid-rows-subgrid` child and takes its rows from the list above
    // it -- get those tracks wrong and the name, the price and the button collapse to whatever
    // their content wants. The step renders twice (stacked, and inside the pinned panel), so the
    // count is per copy rather than absolute.
    const stillCards = page.locator("[data-steps]").locator('[data-slot="package-card"]');
    const stillCount = await stillCards.count();
    if (stillCount > 0) {
      expect(stillCount % 3, "packages still renders whole copies of three cards").toBe(0);
      // The still is `inert`, so nothing in it may take focus or answer a click: it pictures the
      // packages, and a visitor must never mistake it for the live cards further down the page.
      const reachable = await stillCards
        .first()
        .evaluate((node) => node.closest("[inert]") !== null);
      expect(reachable, "the packages still sits inside an inert subtree").toBe(true);
    }
  }
});
