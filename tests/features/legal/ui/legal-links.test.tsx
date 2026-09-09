import { screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { navigationMock, renderWithIntl } from "./helpers";

/**
 * The rich text tags every consent label uses (spec 0015, AC-9).
 *
 * These two tags are what turn "I accept the terms and privacy policy" from a sentence into a
 * sentence someone can actually read before agreeing to it, which is the difference between
 * informed consent and a checkbox. They open in a new tab so a half filled sign up form is never
 * lost to reading a policy, and that carries an obligation with it: `target="_blank"` without
 * `rel="noreferrer"` hands the new tab a `window.opener` handle back to the page holding the form.
 */
vi.mock("next/navigation", () => navigationMock());

const { LEGAL_LINK_TAGS } = await import("@/features/legal/ui/legal-links");

/** Renders the sign up consent label the way the auth forms do, through the real catalogue. */
function ConsentLabel() {
  const t = useTranslations("auth.signUp");
  return <p>{t.rich("consent", LEGAL_LINK_TAGS)}</p>;
}

describe("LEGAL_LINK_TAGS (AC-9)", () => {
  it("offers exactly the two tags the consent labels use", () => {
    expect(Object.keys(LEGAL_LINK_TAGS).sort()).toEqual(["privacy", "terms"]);
  });

  it("turns both tags into links to the real pages", () => {
    renderWithIntl(<ConsentLabel />, "en-CH");
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href")).sort()).toEqual([
      "/en/privacy",
      "/en/terms",
    ]);
  });

  it("opens both in a new tab, without handing it a handle back to the form", () => {
    renderWithIntl(<ConsentLabel />, "en-CH");
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("uses the German slugs in German, since both routes are translated", () => {
    renderWithIntl(<ConsentLabel />, "de-CH");
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    // The typed `Link` maps `/terms` and `/privacy` through `PATHNAMES`, so a German visitor is
    // never sent to the English URL of a document they are agreeing to.
    expect(hrefs.sort()).toEqual(["/de/agb", "/de/datenschutz"]);
  });
});
