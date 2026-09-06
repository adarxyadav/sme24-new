import { expect, type Page, test } from "@playwright/test";

/**
 * The sticky marketing header (spec 0009): the bar stays at the top as the page scrolls, is
 * transparent until it passes the 8px threshold and then takes its hairline over the frosted
 * ground, inverts over the landing hero so it meets the jet ground without a seam in light mode
 * as well as dark, and stays plain on the three pages that open on the page background. The
 * scroll margin that keeps a focused field and its error summary clear of the bar is scoped to
 * these pages only.
 */

/**
 * The tokens are authored in oklch, and Chromium reports the computed value in `lab()` rather
 * than `rgb()`, so the ground is matched on being fully opaque and black rather than on a string.
 */
const JET = /^(rgb\(0, 0, 0\)|lab\(0 0 0\))$/;

/** A computed colour with no alpha at all: the transparent bar, in any colour space. */
const TRANSPARENT = /^(rgba\(0, 0, 0, 0\)|transparent)$/;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    window.localStorage.setItem("theme", value);
  }, theme);
}

/** The header's own computed ground and border, read after the scroll listener has settled. */
async function readBar(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header") as HTMLElement;
    const style = getComputedStyle(header);
    const rect = header.getBoundingClientRect();
    return {
      top: rect.top,
      background: style.backgroundColor,
      borderColor: style.borderBottomColor,
      dark: header.classList.contains("dark"),
    };
  });
}

/** Scrolls past the 8px threshold and waits for the class change the listener drives. */
async function scrollPast(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect
    .poll(async () => page.evaluate(() => document.querySelector("header")?.className ?? ""))
    .toContain("bg-background/85");
}

for (const theme of ["light", "dark"] as const) {
  test(`the bar sticks to the top and takes its hairline past the threshold, in ${theme}`, async ({
    page,
  }) => {
    await forceTheme(page, theme);
    await page.goto("/en");

    const atTop = await readBar(page);
    expect(atTop.top).toBe(0);
    // Transparent, so whatever the page opens with shows through: this is the seam fix.
    expect(atTop.background).toMatch(TRANSPARENT);
    expect(atTop.borderColor).toMatch(TRANSPARENT);

    await scrollPast(page);

    const scrolled = await readBar(page);
    // Still pinned to the viewport top after the page has moved under it.
    expect(scrolled.top).toBe(0);
    // The frosted ground is the theme background at 85%, so it is translucent but not absent,
    // and the hairline is now painted.
    expect(scrolled.background).not.toMatch(TRANSPARENT);
    expect(scrolled.background).toMatch(/0\.85|85%/);
    expect(scrolled.borderColor).not.toMatch(TRANSPARENT);
  });
}

test("the unscrolled bar inverts over the landing hero, in light mode too (no seam)", async ({
  page,
}) => {
  await forceTheme(page, "light");
  await page.goto("/en");

  const bar = await readBar(page);
  expect(bar.dark).toBe(true);

  // The hero runs up behind the bar, so the pixels behind the header are the hero's jet ground
  // rather than the white page background: that is what "no seam" means here.
  const heroTop = await page.evaluate(() => {
    const hero = document.querySelector("main section") as HTMLElement;
    return {
      top: hero.getBoundingClientRect().top,
      background: getComputedStyle(hero).backgroundColor,
    };
  });
  expect(heroTop.top).toBeLessThan(8);
  expect(heroTop.background).toMatch(JET);

  // The lockup inverts with the bar, so it reads on the jet ground instead of vanishing.
  const logoColor = await page.evaluate(() => {
    const logo = document.querySelector("header [data-slot=logo]") as HTMLElement;
    return getComputedStyle(logo).color;
  });
  expect(logoColor).not.toMatch(JET);

  // Once scrolled the bar drops the inversion and takes the page theme's frosted ground.
  await scrollPast(page);
  expect((await readBar(page)).dark).toBe(false);
});

for (const path of ["/pricing", "/about", "/contact"] as const) {
  test(`the bar stays plain on ${path}, which opens on the page background`, async ({ page }) => {
    await forceTheme(page, "light");
    await page.goto(`/en${path}`);

    const bar = await readBar(page);
    // No dark hero here, so inverting would put white text on the white page ground.
    expect(bar.dark).toBe(false);
    expect(bar.background).toMatch(TRANSPARENT);
  });
}

test("the scroll margin that clears the bar applies on the marketing pages only", async ({
  page,
}) => {
  await page.goto("/en/contact");
  const marketing = await page.evaluate(
    () => getComputedStyle(document.querySelector("main input") as HTMLElement).scrollMarginTop,
  );
  expect(marketing).toBe("112px");

  // The signed in areas and the auth pages have no sticky bar, so they must not inherit it.
  await page.goto("/en/sign-in");
  const auth = await page.evaluate(() => {
    const input = document.querySelector("input");
    return input ? getComputedStyle(input).scrollMarginTop : null;
  });
  expect(auth).toBe("0px");
});

test("an invalid submit leaves the error summary clear of the sticky bar (WCAG 2.5.8)", async ({
  page,
}) => {
  await page.goto("/en/contact");
  await page.getByRole("button", { name: "Send enquiry" }).click();

  const summary = page.getByRole("alert").first();
  await expect(summary).toBeVisible();

  const geometry = await page.evaluate(() => {
    const header = (document.querySelector("header") as HTMLElement).getBoundingClientRect();
    const alert = (document.querySelector("[role=alert]") as HTMLElement).getBoundingClientRect();
    return { headerBottom: header.bottom, alertTop: alert.top };
  });
  // The summary's links were unclickable under the bar before the scroll margin was added.
  expect(geometry.alertTop).toBeGreaterThanOrEqual(geometry.headerBottom);
});
