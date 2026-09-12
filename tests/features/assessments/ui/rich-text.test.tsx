import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichText } from "@/features/assessments/ui/rich-text";

/**
 * A content text as paragraphs and lists (spec 0019, AC-11): the export's bullets become a real
 * `<ul>`, a second level line nests under its item, a colon run of semicolon lines becomes a list
 * closed by the full stop, and plain lines stay paragraphs, so a screen reader hears a list and
 * nothing renders as one run on paragraph.
 */
describe("RichText (AC-11)", () => {
  it("renders bullet lines as a list with a nested second level and keeps a plain line a paragraph", () => {
    render(
      <RichText
        text={
          "Records to check:\n- Training plan\n- Induction\no  For new hires\nKeep the originals."
        }
      />,
    );
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    const outer = lists[0] as HTMLElement;
    const top = within(outer)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === outer);
    expect(top.map((item) => item.firstChild?.textContent)).toEqual(["Training plan", "Induction"]);
    const nested = within(top[1] as HTMLElement).getByRole("list");
    expect(within(nested).getByRole("listitem")).toHaveTextContent("For new hires");
    expect(screen.getByText("Records to check:").tagName).toBe("P");
    expect(screen.getByText("Keep the originals.").tagName).toBe("P");
  });

  it("reads an unmarked run of semicolon lines after a colon as a list closed by the full stop", () => {
    render(
      <RichText text={"Considering:\nthe hazards;\nthe legal duties;\nthe workers consulted."} />,
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "the hazards;",
      "the legal duties;",
      "the workers consulted.",
    ]);
    expect(screen.getByText("Considering:").tagName).toBe("P");
  });

  it("renders a plain sentence as one paragraph with no list, and nothing for an empty text", () => {
    const { container, unmount } = render(<RichText text="Is the policy signed and displayed?" />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(1);
    unmount();
    const empty = render(<RichText text="" />);
    expect(empty.container.firstElementChild?.childElementCount).toBe(0);
  });

  it("takes a class for the caller's typography", () => {
    const { container } = render(<RichText text="One line" className="max-w-prose" />);
    expect(container.firstElementChild).toHaveClass("max-w-prose");
  });
});
