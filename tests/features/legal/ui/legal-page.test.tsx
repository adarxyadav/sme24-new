import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LegalPage, LegalProse, LegalSection } from "@/features/legal/ui/legal-page";

/**
 * The shell the four legal pages share (spec 0015, AC-6).
 *
 * One component so the pages cannot drift apart, which makes its heading structure the heading
 * structure of every legal page at once: exactly one `h1`, and every section beneath it an `h2`
 * that is actually named for a screen reader. Getting that wrong on the shell gets it wrong four
 * times over, and a legal page nobody can navigate is a legal page nobody has really been shown.
 *
 * The section id is the other durable promise: a link to `#retention` in an email or a support
 * reply has to keep working while the text under it is rewritten, which is only true if the id
 * comes from the section key rather than from the title.
 */

const page = (meta?: React.ReactNode) => (
  <LegalPage
    eyebrow="Legal"
    title="Privacy policy"
    lead="What we collect, why, and how long we keep it."
    meta={meta}
  >
    <LegalSection id="retention" title="How long we keep things" lead="Per table.">
      <LegalProse>Enquiries are deleted a year after they are closed.</LegalProse>
    </LegalSection>
  </LegalPage>
);

describe("LegalPage (AC-6)", () => {
  it("carries exactly one first level heading, the page title", () => {
    render(page());
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Privacy policy");
  });

  it("shows the eyebrow and the lead above the prose", () => {
    render(page());
    expect(screen.getByText("Legal")).toBeInTheDocument();
    expect(screen.getByText("What we collect, why, and how long we keep it.")).toBeInTheDocument();
  });

  it("shows the dateline when a page has one", () => {
    render(page(<span>Last updated 09.09.2026</span>));
    expect(screen.getByText("Last updated 09.09.2026")).toBeInTheDocument();
  });

  it("renders no empty dateline row on a page without one, such as the imprint", () => {
    const { container } = render(page());
    // An empty `<p>` would still take its gap in the band, which reads as a layout bug rather
    // than as a page that simply has no version to state.
    expect(container.querySelectorAll("p:empty")).toHaveLength(0);
  });

  it("renders the sections it is given", () => {
    render(page());
    expect(screen.getByText("Enquiries are deleted a year after they are closed.")).toBeVisible();
  });
});

describe("LegalSection (AC-6)", () => {
  it("names each section as a landmark a screen reader can jump between", () => {
    render(page());
    expect(screen.getByRole("region", { name: "How long we keep things" })).toBeInTheDocument();
  });

  it("puts every section heading one level under the page title", () => {
    render(page());
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("How long we keep things");
  });

  /**
   * The id is derived from the section key rather than from the title, so a deep link survives a
   * rewrite of the text it points at.
   */
  it("derives the heading id from the key, so a deep link outlives the wording", () => {
    render(page());
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAttribute("id", "retention-heading");
    expect(screen.getByRole("region", { name: "How long we keep things" })).toHaveAttribute(
      "aria-labelledby",
      "retention-heading",
    );
  });

  it("renders a section with no lead and no body without breaking", () => {
    render(<LegalSection id="empty" title="Nothing here" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Nothing here");
  });
});

describe("LegalProse", () => {
  it("renders the paragraph it is given", () => {
    render(<LegalProse>Kept for ten years.</LegalProse>);
    expect(screen.getByText("Kept for ten years.")).toBeVisible();
  });
});
