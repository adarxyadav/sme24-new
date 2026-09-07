import { expect, type Page, test } from "@playwright/test";

/**
 * The sticky marketing header (spec 0009): the bar stays at the top as the page scrolls, is
 * transparent until the page has scrolled the bar's own height and then takes its hairline over
 * the frosted ground, and stays plain on every marketing page, all of which now open on the page
 * background. The scroll margin that keeps a focused field and its error summary clear of the bar
 * is scoped to these pages only.
 *
 * The bar can also invert over a dark first section (`DARK_HERO_ROUTES` in `marketing-header.tsx`),
 * which is how the landing page used to meet its jet hero without a seam. That list is empty since
 * the hero moved onto the page ground on 2026-09-07, so no route exercises the inversion and there
 * is nothing here to drive it: a page that gains a dark hero joins the list and brings its own
 * coverage of the held inversion back with it.
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
 * Scrolls clear of the threshold and waits for the bar to take a frosted ground: the page theme's,
 * on every route now that no page opens on a dark hero. Only the alpha is asserted here, so this
 * would still hold over a dark hero's own frosting.
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

test("the landing hero opens on the page ground, so the bar has no seam to cover", async ({
  page,
}) => {
  await forceTheme(page, "light");
  await page.goto("/en");

  // The hero moved onto the page ground on 2026-09-07, which is what emptied `DARK_HERO_ROUTES`:
  // in light mode it is white, so the transparent bar already matches it and there is no seam for
  // an inversion to hide. Inverting here would put a white lockup on a white ground.
  //
  // The hero paints no ground of its own any more, which is the point: it is transparent down to
  // the page background, so that is what the bar actually sits over and what has to be read here.
  // Reading the hero's own `backgroundColor` would return `rgba(0, 0, 0, 0)` and score as jet.
  const hero = await page.evaluate(() => {
    const block = document.querySelector("[data-hero]") ?? document.querySelector("main section");
    const element = block as HTMLElement;
    return {
      top: element.getBoundingClientRect().top,
      ownBackground: getComputedStyle(element).backgroundColor,
      pageGround: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(hero.top).toBeLessThan(8);
  expect(alphaOf(hero.ownBackground)).toBe(0);
  expect(isBlack(hero.pageGround)).toBe(false);

  // The lockup keeps the page theme's ink rather than inverting away from it.
  const logoColor = await page.evaluate(() => {
    const logo = document.querySelector("header [data-slot=logo]") as HTMLElement;
    return getComputedStyle(logo).color;
  });
  expect(isBlack(logoColor)).toBe(true);
});

for (const path of ["/", "/pricing", "/about", "/contact"] as const) {
  test(`the bar stays plain on ${path}, which opens on the page background`, async ({ page }) => {
    await forceTheme(page, "light");
    await page.goto(path === "/" ? "/en" : `/en${path}`);

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
