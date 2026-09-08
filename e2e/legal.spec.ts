import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { CURRENT_TERMS_VERSION } from "../src/features/legal/terms";
import { accountByEmail, dbAvailable, serviceClient } from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * The four legal pages (spec 0015, milestone 2): every page in both languages and both themes
 * passes axe with one h1, the German slugs resolve, the privacy tables are rendered from the
 * typed constants rather than prose, the footer's legal group and the consent links point at the
 * real routes in a new tab, and the sitemap lists all four with their alternates.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The four routes in both languages, German slugs included (AC-6). */
const PAGES = {
  en: ["/privacy", "/terms", "/imprint", "/cookies"],
  de: ["/datenschutz", "/agb", "/impressum", "/cookies"],
} as const;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    window.localStorage.setItem("theme", value);
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  for (const locale of ["de", "en"] as const) {
    for (const path of PAGES[locale]) {
      test(`/${locale}${path} in ${theme}: one h1, no WCAG 2.2 AA violations (AC-6)`, async ({
        page,
      }) => {
        await forceTheme(page, theme);
        const response = await page.goto(`/${locale}${path}`);
        expect(response?.status()).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", `${locale}-CH`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }
}

test("the privacy page renders the processor and retention tables from the constants (AC-7, AC-8)", async ({
  page,
}) => {
  await page.goto("/en/privacy");

  // Every processor is a row naming the company, not the product (PROCESSORS).
  for (const name of ["Supabase, Inc.", "Vercel, Inc.", "Stripe Payments Europe, Ltd."]) {
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }

  // The periods come from the purge tasks' own day counts, so these numbers are the ones the
  // scheduled tasks actually apply (AC-8); a task whose period moved would change this text.
  await expect(
    page.getByRole("cell", { name: "90 days, then deleted automatically" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "365 days, then deleted automatically" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "30 days, then deleted automatically" }),
  ).toBeVisible();

  // The third retention bucket is stated honestly rather than dressed as one of the other two.
  await expect(page.getByRole("cell", { name: "Kept indefinitely" }).first()).toBeVisible();

  // The deletion exception is stated in plain words (AC-15): the accounting rows survive, and the
  // page says why. `Statement` splits a heading into per-sentence spans, so the section is
  // addressed by the id its heading carries rather than by an accessible name.
  const deletion = page.locator('section[aria-labelledby="deletion-heading"]');
  await expect(deletion.getByText(/deliberately not touched/)).toBeVisible();
  await expect(deletion.getByText(/ten years/)).toBeVisible();
});

test("the imprint states the operator facts from SITE (AC-6)", async ({ page }) => {
  await page.goto("/en/imprint");
  const operator = page.getByRole("region", { name: /operator/i });
  await expect(operator.getByText("IC Hotz GmbH").first()).toBeVisible();
  await expect(operator.getByText("Obermühle 5")).toBeVisible();
  await expect(operator.getByRole("link", { name: "service@sme24.ch" })).toBeVisible();
});

test("the footer's legal group links the four pages with their German slugs (AC-9)", async ({
  page,
}) => {
  await page.goto("/de");
  const legal = page.getByRole("navigation", { name: "Rechtliches" });
  await expect(legal.getByRole("link", { name: "Datenschutzerklärung" })).toHaveAttribute(
    "href",
    "/de/datenschutz",
  );
  await expect(legal.getByRole("link", { name: "Impressum" })).toHaveAttribute(
    "href",
    "/de/impressum",
  );
  await expect(legal.getByRole("link", { name: "Cookies" })).toHaveAttribute("href", "/de/cookies");
});

test("the sign up consent links the terms and privacy pages in a new tab (AC-9)", async ({
  page,
}) => {
  await page.goto("/en/sign-up");
  for (const [name, href] of [
    ["terms of use", "/en/terms"],
    ["privacy policy", "/en/privacy"],
  ] as const) {
    const link = page.getByRole("link", { name });
    await expect(link).toHaveAttribute("href", href);
    // A new tab so a half filled sign up is not lost, and no `window.opener` handle back.
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noreferrer");
  }
});

test("the enquiry privacy note links the real privacy page (AC-9)", async ({ page }) => {
  await page.goto("/en/contact");
  // The footer's legal group links the same page, so scope to the enquiry form's own note. The
  // form has no accessible name, so it is addressed as an element rather than by role.
  const link = page.locator("form").getByRole("link", { name: "Privacy policy" });
  await expect(link).toHaveAttribute("href", "/en/privacy");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("the cookies page changes a stored choice without clearing the browser (AC-8b)", async ({
  page,
}) => {
  await page.goto("/en/cookies");

  // Nobody has answered yet, so the control says so rather than guessing.
  await expect(page.getByText("You have not answered yet.")).toBeVisible();

  await page.getByRole("button", { name: "Reject analytics" }).click();
  await expect(page.getByText("You rejected analytics.")).toBeVisible();

  // The whole point of AC-8b: someone who rejected can later accept, on this page, at any time.
  await page.getByRole("button", { name: "Accept analytics" }).click();
  await expect(page.getByText("You accepted analytics.")).toBeVisible();

  // And the answer survives a reload, because it is the same cookie the bar writes (AC-3).
  await page.reload();
  await expect(page.getByText("You accepted analytics.")).toBeVisible();
  await expect(page.getByTestId("cookie-bar")).toHaveCount(0);
});

test("the sitemap lists the four legal pages in both languages with alternates (AC-6)", async ({
  request,
}) => {
  const body = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/en/privacy", "/en/terms", "/en/imprint", "/en/cookies"]) {
    expect(body).toContain(path);
  }
  for (const path of ["/de/datenschutz", "/de/agb", "/de/impressum", "/de/cookies"]) {
    expect(body).toContain(path);
  }
  // The alternates are what make the German slug and the English one one page to a crawler.
  expect(body).toContain('hreflang="de-CH"');
});

test("the legal pages are indexable (AC-6)", async ({ page }) => {
  for (const path of ["/en/privacy", "/en/terms", "/en/imprint", "/en/cookies"]) {
    await page.goto(path);
    // No page level noindex: these pages exist to be found.
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  }
});

/**
 * The terms version gate (spec 0015, milestone 3, AC-10). These drive the real dialog rather than
 * asserting on the constant, because the whole feature is "a stale profile cannot use the app":
 * the version is moved in the database with the service client, the page is loaded as that user,
 * and the gate is what must appear.
 *
 * Serial, because they share one seeded account and each one moves its stored version.
 */
test.describe
  .serial("the terms gate", () => {
    test.skip(!dbAvailable || !seedPassword, "needs the local stack and the seeded password");

    /** Puts the seeded client on `version`, the one write path the tests are allowed to shortcut. */
    /** The consent stamp supabase/seed.sql gives the seeded accounts. */
    const SEEDED_CONSENT = "2026-09-01T08:00:00Z";

    async function setStoredVersion(email: string, version: string) {
      const account = await accountByEmail(email);
      const id = account?.profile?.id;
      expect(id, `no seeded profile for ${email}`).toBeTruthy();
      const { error } = await serviceClient()
        .from("profiles")
        .update({ terms_version: version })
        .eq("id", id as string);
      expect(error).toBeNull();
      return id as string;
    }

    /**
     * Puts the seeded client back exactly as supabase/seed.sql left it. Both columns, not just the
     * version: the accept test moves `terms_accepted_at` to now(), and `accept_terms.test.sql`
     * asserts the seeded stamp, so leaving it drifted fails pgTAP on the next run and makes the
     * two suites order dependent.
     */
    test.afterAll(async () => {
      if (!dbAvailable) return;
      const account = await accountByEmail(SEED_USERS.client);
      const id = account?.profile?.id;
      if (!id) return;
      await serviceClient()
        .from("profiles")
        .update({ terms_version: CURRENT_TERMS_VERSION, terms_accepted_at: SEEDED_CONSENT })
        .eq("id", id);
    });

    test("a profile on the current version sees no dialog (AC-10)", async ({ page }) => {
      await setStoredVersion(SEED_USERS.client, CURRENT_TERMS_VERSION);
      await signIn(page, SEED_USERS.client);
      await page.goto("/de/app");
      await expect(page.getByTestId("terms-gate")).toHaveCount(0);
    });

    test("a stale profile is blocked on every signed in page and cannot dismiss it (AC-10)", async ({
      page,
    }) => {
      await setStoredVersion(SEED_USERS.client, "0");
      await signIn(page, SEED_USERS.client);

      const gate = page.getByTestId("terms-gate");
      await expect(gate).toBeVisible();

      // Escape and an outside click are the two ways a dialog normally goes away. Neither may work:
      // a gate that can be waved away is not a gate.
      await page.keyboard.press("Escape");
      await expect(gate).toBeVisible();
      await page.mouse.click(5, 5);
      await expect(gate).toBeVisible();

      // It follows the user to another signed in page rather than guarding only the landing one.
      await page.goto("/de/app/orders");
      await expect(page.getByTestId("terms-gate")).toBeVisible();
    });

    test("a profile that never accepted anything is not blocked (AC-10)", async ({ page }) => {
      // `terms_version` is `not null default '1'`, so a staff account created by the invite path
      // reads as version 1 while `terms_accepted_at` is still null. Blocking them here would put a
      // re consent dialog in front of someone who has not consented once; that is onboarding's job.
      const id = await setStoredVersion(SEED_USERS.ops, CURRENT_TERMS_VERSION);
      const { error } = await serviceClient()
        .from("profiles")
        .update({ terms_accepted_at: null })
        .eq("id", id);
      expect(error).toBeNull();

      await signIn(page, SEED_USERS.ops);
      await page.goto("/de/admin");
      await expect(page.getByTestId("terms-gate")).toHaveCount(0);
    });

    test("a version that sorts below the current one is still stale (AC-10)", async ({ page }) => {
      // The text ordering trap: '10' < '2' as text. Whichever way an ordering comparison ran, one of
      // these two directions would let a profile through; equality refuses both.
      await setStoredVersion(SEED_USERS.client, "10");
      await signIn(page, SEED_USERS.client);
      await expect(page.getByTestId("terms-gate")).toBeVisible();
    });

    test("accepting records the current version and lets the user through (AC-10)", async ({
      page,
    }) => {
      const userId = await setStoredVersion(SEED_USERS.client, "0");
      await signIn(page, SEED_USERS.client);
      await expect(page.getByTestId("terms-gate")).toBeVisible();

      await page
        .getByTestId("terms-gate")
        .getByRole("button", { name: /Zustimmen/ })
        .click();
      await expect(page.getByTestId("terms-gate")).toHaveCount(0);

      // The column moved, which is the only thing that actually reopens the app.
      const { data } = await serviceClient()
        .from("profiles")
        .select("terms_version, terms_accepted_at")
        .eq("id", userId)
        .single();
      expect(data?.terms_version).toBe(CURRENT_TERMS_VERSION);
      expect(data?.terms_accepted_at).toBeTruthy();

      // And it stays gone on the next page, so acceptance is stored rather than only local state.
      await page.goto("/de/app");
      await expect(page.getByTestId("terms-gate")).toHaveCount(0);
    });

    test("the dialog has no WCAG 2.2 AA violations (AC-10)", async ({ page }) => {
      await setStoredVersion(SEED_USERS.client, "0");
      await signIn(page, SEED_USERS.client);
      await expect(page.getByTestId("terms-gate")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations).toEqual([]);
    });
  });
