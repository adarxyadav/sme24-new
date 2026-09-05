import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * Design system gallery (spec 0003): fonts, theme, axe in both themes and locales, overflow,
 * truncation tooltip, keyboard and mobile shell. Needs the seeded ops user, so it skips without
 * E2E_SEED_PASSWORD exactly like the roles suite.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.skip(!seedPassword, "E2E_SEED_PASSWORD is not set; seeded users are unavailable");

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    window.localStorage.setItem("theme", value);
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  for (const locale of ["de", "en"] as const) {
    test(`gallery in ${theme} / ${locale}: Geist body font, theme class, no WCAG 2.2 AA violations (AC-2, AC-3, AC-10)`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await signIn(page, SEED_USERS.ops);
      await page.goto(`/${locale}/admin/design`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const html = page.locator("html");
      await expect(html).toHaveAttribute("lang", `${locale}-CH`);
      await expect(html).toHaveClass(new RegExp(`\\b${theme}\\b`));
      expect(await html.evaluate((el) => getComputedStyle(el).colorScheme)).toBe(theme);

      const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      expect(fontFamily.replace(/^["']/, "")).toMatch(/^Geist(?! Mono)/);

      // Recharts draws SVG text axe cannot judge; the spec checks charts by eye in the gallery.
      const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .exclude("[data-slot=chart]")
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

test("the theme choice survives a reload and the toggle switches it (AC-3)", async ({ page }) => {
  await signIn(page, SEED_USERS.ops);
  await page.goto("/de/admin/design");
  const toggle = page.getByRole("main").getByRole("button", { name: "Darstellung wechseln" });
  await toggle.click();
  await page.getByRole("menuitemradio", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => window.localStorage.getItem("theme"))).toBe("dark");
});

test("navigation items and buttons in the gallery do not overflow, and a truncated cell shows its tooltip on hover and focus (AC-10)", async ({
  page,
}) => {
  await signIn(page, SEED_USERS.ops);
  await page.goto("/de/admin/design");

  const samples = [
    ...(await page.getByRole("navigation", { name: "Navigation" }).getByRole("link").all()),
    ...(await page.getByRole("region", { name: "Buttons und Badges" }).getByRole("button").all()),
  ];
  expect(samples.length).toBeGreaterThan(3);
  for (const sample of samples) {
    const overflow = await sample.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }

  const cell = page.getByTestId("truncated-cell").first();
  const longText = (await cell.textContent()) ?? "";
  await cell.hover();
  await expect(page.getByRole("tooltip")).toContainText(longText.slice(0, 20));
  await page.mouse.move(0, 0);
  await cell.focus();
  await expect(page.getByRole("tooltip")).toContainText(longText.slice(0, 20));
});

test("the sidebar shell is operable by keyboard: skip link, nav, user menu, theme submenu (AC-4)", async ({
  page,
}) => {
  await signIn(page, SEED_USERS.ops);
  await expect(page).toHaveURL(/\/de\/admin$/);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Zum Inhalt springen" });
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  await page.getByRole("link", { name: "Übersicht" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "E-Mails" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Design Galerie" })).toBeFocused();

  const userMenu = page.getByRole("button", { name: "Benutzermenü" });
  await userMenu.focus();
  await page.keyboard.press("Enter");
  const themeTrigger = page.getByRole("menuitem", { name: /Darstellung/ });
  await expect(themeTrigger).toBeVisible();
  await themeTrigger.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitemradio", { name: "Dunkel" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitemradio", { name: "Dunkel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("at 375px the sidebar becomes a sheet that traps and returns focus (AC-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, SEED_USERS.ops);
  await expect(page).toHaveURL(/\/de\/admin$/);

  await expect(page.getByRole("link", { name: "Design Galerie" })).toBeHidden();
  const trigger = page.getByRole("button", { name: "Navigation ein- oder ausblenden" });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Navigation" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Design Galerie" })).toBeVisible();

  const focusedInside = await page.evaluate(() =>
    Boolean(document.activeElement?.closest("[role=dialog]")),
  );
  expect(focusedInside).toBe(true);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("a client user gets the forbidden page for the gallery (AC-6)", async ({ page }) => {
  await signIn(page, SEED_USERS.client);
  await page.goto("/de/admin/design");
  await expect(page).toHaveURL(/\/de\/forbidden$/);
});
