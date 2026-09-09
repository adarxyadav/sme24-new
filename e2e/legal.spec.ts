import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { CURRENT_TERMS_VERSION } from "../src/features/legal/terms";
import {
  accountByEmail,
  createConfirmedClient,
  dbAvailable,
  deleteAccount,
  serviceClient,
} from "./db";
import { SEED_USERS, seedPassword, signIn } from "./helpers";
import { uniqueEmail } from "./mail";

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

/**
 * The two defects `/check verify` found on 2026-09-09, both invisible to the green suite (spec
 * 0015, milestone 4). They live here rather than in Vitest because neither is reachable in jsdom:
 * one is the real GoTrue merge semantics, the other is whether a toast region exists in the tree
 * the browser actually renders.
 */
test.describe("the data rights card and the deletion scrub", () => {
  test.skip(!dbAvailable || !seedPassword, "needs the local stack and the seeded password");

  /**
   * AC-11 regression: `Toaster` is mounted in `AreaShell`, and `/cookies` is a marketing route
   * outside that shell, so every toast the card fired was dropped. The success path degraded
   * quietly (the list reloads and shows the row), but `already_open` and the error paths told the
   * user nothing at all. Sonner renders nothing until a toast is fired, so the assertion is on a
   * toast actually appearing, not on the region being in the DOM at load.
   */
  test("the card's toast is announced on /cookies, a route outside the shell (AC-11)", async ({
    page,
  }) => {
    await signIn(page, SEED_USERS.client);
    await page.goto("/en/cookies");

    const card = page.locator('section[aria-labelledby="data-heading"]');
    await card.getByRole("button", { name: "Request a copy" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Request a copy", exact: true })
      .click();

    // The toast itself, in this tree. Before the fix this never appeared on `/cookies` while it
    // appeared on `/en/app`, which is exactly what made the defect invisible to the suite.
    await expect(
      page.getByText("Request received. We will send your copy within 30 days."),
    ).toBeVisible();

    // And the second attempt, whose only feedback is a toast: the list still shows one row, so
    // without a region the user is told nothing whatsoever about why nothing happened.
    await card.getByRole("button", { name: "Request a copy" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Request a copy", exact: true })
      .click();
    await expect(
      page.getByText(
        "You already have an open request of this kind. We will answer it within 30 days.",
      ),
    ).toBeVisible();
  });

  test.afterEach(async () => {
    if (!dbAvailable) return;
    // The card's rows are the seeded client's own, and the partial unique index would refuse the
    // next run's request, so the open ones go back.
    const account = await accountByEmail(SEED_USERS.client);
    const id = account?.profile?.id;
    if (!id) return;
    await serviceClient().from("data_requests").delete().eq("requested_by", id);
  });
});

/**
 * AC-15 regression: `anonymisePerson` sent `user_metadata: {}`, and GoTrue merges rather than
 * replaces, so the call succeeded while the person's real name stayed in
 * `auth.users.raw_user_meta_data`. The routine still reported `authScrubbed: true`, so the audit
 * log asserted a scrub that never happened and the privacy page promised it in writing.
 *
 * Serial, because it drives one throwaway account through the whole path: file, then fulfil as
 * ops, then read the auth row back with the service client.
 */
test.describe
  .serial("fulfilling a deletion actually scrubs the auth user", () => {
    test.skip(!dbAvailable || !seedPassword, "needs the local stack and the seeded password");

    const email = uniqueEmail("deletion");
    const password = "Passw0rd!12345";
    /** The note the fulfilment writes, and the only handle cleanup has on the scrubbed row. */
    const FULFIL_NOTE = "Anonymised on request, e2e (Fulfilled).";

    test.beforeAll(async () => {
      if (!dbAvailable) return;
      // A sign up carrying the full metadata set: this is what has to be gone at the end.
      await createConfirmedClient(email, password, "Deletion Test AG");
    });

    /**
     * Cleanup cannot look the subject up by `email`: the scrub has renamed the address to
     * `deleted+<id>@invalid.sme24.ch` by now, and it cannot use a variable the test set either,
     * because `afterAll` runs in its own fixture scope. So the id comes from the row itself, found
     * by the note the test wrote, and the request row goes first: `requested_by` is
     * `on delete set null` on purpose, so the record outlives the profile (AC-11) and nothing could
     * match it to this run afterwards.
     */
    test.afterAll(async () => {
      if (!dbAvailable) return;
      const supabase = serviceClient();
      const { data: rows } = await supabase
        .from("data_requests")
        .select("id, requested_by")
        .eq("ops_note", FULFIL_NOTE);
      for (const row of rows ?? []) {
        await supabase.from("data_requests").delete().eq("id", row.id);
        if (row.requested_by) {
          await deleteAccount(`deleted+${row.requested_by}@invalid.sme24.ch`);
        }
      }
    });

    test("clears every sign up key from raw_user_meta_data (AC-15)", async ({ page }) => {
      const before = await accountByEmail(email);
      const userId = before?.user.id as string;
      expect(userId, "the throwaway account was not created").toBeTruthy();
      // The precondition the assertion at the end is only meaningful against.
      expect(before?.user.user_metadata?.full_name).toBe("Fixture Person");

      // The person files the deletion themselves, through the card, as a real request would arrive.
      await page.goto("/de/sign-in");
      await page.getByLabel("E-Mail").fill(email);
      await page.getByLabel("Passwort").fill(password);
      await page.getByRole("button", { name: "Anmelden", exact: true }).click();
      await page.waitForURL((url) => !url.pathname.endsWith("/sign-in"));
      await page.goto("/en/cookies");
      const card = page.locator('section[aria-labelledby="data-heading"]');
      await card.getByRole("button", { name: "Request deletion" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Request deletion", exact: true })
        .click();
      // The badge in the list, not the toast: with the region mounted, "Received" now matches both.
      await expect(card.getByText("Received", { exact: true })).toBeVisible();

      const { data: filed } = await serviceClient()
        .from("data_requests")
        .select("id")
        .eq("requested_by", userId)
        .eq("kind", "deletion")
        .single();
      const requestId = filed?.id as string;
      expect(requestId).toBeTruthy();

      // Ops fulfil it through the form, so the scrub runs where it really runs: inside
      // `updateDataRequest`, never as a manual side channel.
      await page.context().clearCookies();
      await signIn(page, SEED_USERS.ops);
      await page.goto(`/en/admin/data-requests/${requestId}`);
      // Two saves, because `DATA_REQUEST_TRANSITIONS` has no `new → fulfilled` edge: a deletion is
      // picked up and only then fulfilled, so this walks the path ops actually walk.
      // By role: the section is also labelled "Status", so `getByLabel` matches two elements.
      // The bar is pinned to the bottom of the viewport until it is answered, and the success
      // toast lands on top of the button; both would intercept the second save's click.
      await page.getByTestId("cookie-bar").getByRole("button", { name: "Reject" }).click();
      for (const next of ["In progress", "Fulfilled"]) {
        await page.getByRole("combobox", { name: "Status" }).click();
        await page.getByRole("option", { name: next, exact: true }).click();
        await page.getByLabel("What was done").fill(`Anonymised on request, e2e (${next}).`);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByText("Request updated.")).toBeVisible();
        // The toaster has no close button, so the reload is what clears it before the next save;
        // it also proves the move was stored rather than only shown.
        await page.reload();
      }

      // The assertion the whole test exists for, read straight from the auth row.
      const supabase = serviceClient();
      const { data: after, error } = await supabase.auth.admin.getUserById(userId);
      expect(error).toBeNull();
      const metadata = (after.user?.user_metadata ?? {}) as Record<string, unknown>;
      for (const key of ["full_name", "organization_name", "locale", "terms_accepted_at"]) {
        expect(metadata[key], `${key} survived the scrub in raw_user_meta_data`).toBeUndefined();
      }
      // The rest of AC-15, so a fix to the metadata cannot quietly cost the other two.
      expect(after.user?.email).toBe(`deleted+${userId}@invalid.sme24.ch`);
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .single();
      expect(profile?.full_name).toBeNull();
    });
  });
