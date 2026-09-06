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
 * Chromium reports the computed value of the oklch tokens in a colour space of its own choosing
 * (`lab()` locally, `oklab()` on a newer build), so nothing here matches a colour string. The
 * alpha is parsed out of whatever notation came back, and the ground is judged on that alone.
 */
function alphaOf(colour: string) {
  if (colour === "transparent") return 0;
  const slash = colour.match(/\/\s*([\d.]+%?)\s*\)/);
  if (slash?.[1]) {
    const raw = slash[1];
    return raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
  }
  // Four components means the last one is the alpha; a three component `rgb(...)`, and any
  // `lab()`/`oklab()` without a slash, carries no alpha at all and is fully opaque.
  const rgba = colour.match(/^rgba?\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\s*\)$/);
  return rgba?.[1] ? Number.parseFloat(rgba[1]) : 1;
}

/** The lightness of a `lab()`/`oklab()` value, used only to tell jet from white. */
function isBlack(colour: string) {
  const lab = colour.match(/^(?:ok)?lab\(\s*(-?[\d.]+)/);
  if (lab?.[1]) return Number.parseFloat(lab[1]) < 0.01;
  return /^rgba?\(0,\s*0,\s*0/.test(colour);
}

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    window.localStorage.setItem("theme", value);
  }, theme);
}

/** The header's own computed ground and border, read as they stand right now. */
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

/**
 * Scrolls past the 8px threshold and waits for the bar to finish taking its frosted ground. The
 * class lands first and `transition-colors` then animates the alpha up, so waiting on the class
 * alone hands back a mid-transition colour (measured on CI: `oklab(... / 0.782878)`); this polls
 * the settled alpha instead.
 */
async function scrollPast(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect
    .poll(async () => alphaOf((await readBar(page)).background), { timeout: 10_000 })
    .toBeGreaterThan(0.5);
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
    expect(alphaOf(atTop.background)).toBe(0);
    expect(alphaOf(atTop.borderColor)).toBe(0);

    await scrollPast(page);

    const scrolled = await readBar(page);
    // Still pinned to the viewport top after the page has moved under it.
    expect(scrolled.top).toBe(0);
    // The frosted ground is the theme background at 85%: translucent, so the page still shows
    // through, but no longer absent. The exact alpha is the token's business, not the test's.
    const ground = alphaOf(scrolled.background);
    expect(ground).toBeGreaterThan(0.5);
    expect(ground).toBeLessThan(1);
    // The hairline is now painted.
    expect(alphaOf(scrolled.borderColor)).toBeGreaterThan(0);
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
  expect(isBlack(heroTop.background)).toBe(true);

  // The lockup inverts with the bar, so it reads on the jet ground instead of vanishing.
  const logoColor = await page.evaluate(() => {
    const logo = document.querySelector("header [data-slot=logo]") as HTMLElement;
    return getComputedStyle(logo).color;
  });
  expect(isBlack(logoColor)).toBe(false);

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
    expect(alphaOf(bar.background)).toBe(0);
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
