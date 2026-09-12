import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Progress } from "@/features/assessments/model";
import { SectionNav } from "@/features/assessments/ui/section-nav";
import { ASSESSMENT_ID, de, en, ORG_ID, renderWithIntl, text } from "./helpers";

/**
 * The section navigator (spec 0019, AC-6, AC-8, AC-13): a navigation landmark named Sections, an
 * ordered list of links carrying `?section=`, the open one marked as the current page, per section
 * progress, and a section marked not applicable said in words with an icon rather than a colour.
 * The server translator is the boundary.
 */
const env = vi.hoisted(() => ({ locale: "en-CH" as "en-CH" | "de-CH" }));
vi.mock("next-intl/server", async () => {
  const { serverIntlMock } = await import("./helpers");
  return serverIntlMock(env);
});
vi.mock("next/navigation", async () => {
  const { navigationMock } = await import("./helpers");
  return navigationMock();
});

const PROGRESS: Progress = {
  rated: 3,
  required: 4,
  unrated: 1,
  sections: [
    {
      key: "c4",
      label: "4",
      title: text("Context of the organization"),
      excluded: false,
      rated: 1,
      required: 2,
      unrated: 1,
    },
    {
      key: "c7",
      label: "7",
      title: text("Support"),
      excluded: false,
      rated: 2,
      required: 2,
      unrated: 0,
    },
  ],
};

async function renderNav(progress: Progress = PROGRESS, openKey = "c7") {
  const locale = env.locale === "de-CH" ? "de" : "en";
  return renderWithIntl(
    await SectionNav({
      organizationId: ORG_ID,
      assessmentId: ASSESSMENT_ID,
      progress,
      openKey,
      locale,
    }),
    env.locale,
  );
}

describe("SectionNav (AC-6, AC-13)", () => {
  it("is a navigation named Sections holding an ordered list with one link per section and its progress", async () => {
    env.locale = "en-CH";
    await renderNav();
    const nav = screen.getByRole("navigation", { name: en.assessments.nav.label });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "4Context of the organization1/2",
      "7Support2/2",
    ]);
    expect(within(nav).getByRole("list").tagName).toBe("OL");
  });

  it("links every section to the same page with its key in the section query", async () => {
    env.locale = "en-CH";
    await renderNav();
    const [first, second] = screen.getAllByRole("link");
    expect(first).toHaveAttribute(
      "href",
      `/en/expert/clients/${ORG_ID}/assessments/${ASSESSMENT_ID}?section=c4`,
    );
    expect(second).toHaveAttribute(
      "href",
      `/en/expert/clients/${ORG_ID}/assessments/${ASSESSMENT_ID}?section=c7`,
    );
  });

  it("marks the open section as the current page and no other", async () => {
    env.locale = "en-CH";
    await renderNav(PROGRESS, "c4");
    expect(screen.getByRole("link", { name: /Context of the organization/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /Support/ })).not.toHaveAttribute("aria-current");
  });

  it("says not applicable in words on an excluded section instead of a count (AC-8)", async () => {
    env.locale = "en-CH";
    const excluded: Progress = {
      ...PROGRESS,
      sections: PROGRESS.sections.map((section) =>
        section.key === "c4"
          ? { ...section, excluded: true, rated: 0, required: 0, unrated: 0 }
          : section,
      ),
    };
    await renderNav(excluded);
    const link = screen.getByRole("link", { name: /Context of the organization/ });
    expect(link).toHaveAttribute("data-excluded", "true");
    expect(link).toHaveTextContent(en.assessments.nav.excluded);
    expect(link).not.toHaveTextContent("0/0");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("link", { name: /Support/ })).not.toHaveAttribute("data-excluded");
  });

  it("renders the German titles and words for a German reader", async () => {
    env.locale = "de-CH";
    const excluded: Progress = {
      ...PROGRESS,
      sections: PROGRESS.sections.map((section) =>
        section.key === "c7" ? { ...section, excluded: true } : section,
      ),
    };
    await renderNav(excluded);
    expect(screen.getByRole("navigation", { name: de.assessments.nav.label })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Support \(de\)/ })).toHaveTextContent(
      de.assessments.nav.excluded,
    );
    expect(screen.getAllByRole("link")[0]).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/de\//),
    );
  });
});
