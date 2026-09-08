import { screen } from "@testing-library/react";
import { Children, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ExpertAvatar, initials } from "@/features/experts/ui/expert-avatar";
import { renderWithIntl } from "../../emails/ui/helpers";

/**
 * The expert's photo or initials (spec 0013, AC-6, AC-12). The photo URL is a short lived signed
 * one minted per render, so the component must render exactly what it is handed and never build a
 * path of its own; the initials are what stands in before an invitee has typed a name at all.
 */

/** The `AvatarImage` element the component builds, or undefined when it built none. */
function imageChild(
  rendered: ReactElement,
): ReactElement<{ src: string; alt: string }> | undefined {
  const children = Children.toArray(
    (rendered.props as { children?: ReactNode }).children,
  ) as ReactElement[];
  return children.find((child) => child?.props && "src" in (child.props as object)) as
    | ReactElement<{ src: string; alt: string }>
    | undefined;
}

describe("initials", () => {
  it("takes the first letter of the first and last words", () => {
    expect(initials("Rita Meier")).toBe("RM");
    expect(initials("Jean-Paul Dubois Rochat")).toBe("JR");
  });

  it("gives one letter for a single word", () => {
    expect(initials("Rita")).toBe("R");
  });

  it("uppercases and ignores stray whitespace", () => {
    expect(initials("  rita   meier  ")).toBe("RM");
  });

  it("falls back to a dash rather than an empty circle", () => {
    // A profile row exists from the moment ops invite, which is before the invitee has typed a
    // name; an empty avatar there reads as a broken image, a dash reads as "not yet".
    expect(initials(null)).toBe("–");
    expect(initials("")).toBe("–");
    expect(initials("   ")).toBe("–");
  });

  it("handles a non latin name without dropping it", () => {
    expect(initials("Þóra Ólafsdóttir")).toBe("ÞÓ");
  });
});

describe("the avatar", () => {
  it("shows the initials when there is no photo", () => {
    renderWithIntl(<ExpertAvatar fullName="Rita Meier" photoUrl={null} />);
    expect(screen.getByText("RM")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the signed URL exactly as it was handed one, never an object path", () => {
    // Radix mounts the `img` only once the browser has actually loaded it, which jsdom never
    // does, so the assertion is on the element Radix is given rather than on a rendered `img`.
    const signed = "https://stack.test/storage/v1/object/sign/expert-photos/x/photo.png?token=abc";
    const rendered = ExpertAvatar({ fullName: "Rita Meier", photoUrl: signed });
    const image = imageChild(rendered);
    expect(image?.props.src).toBe(signed);
    // An empty alt: every place this is used shows the name as text beside it, so an alt text
    // would make a screen reader say the name twice.
    expect(image?.props.alt).toBe("");
  });

  it("mounts no image element at all when there is no photo", () => {
    expect(imageChild(ExpertAvatar({ fullName: "Rita Meier", photoUrl: null }))).toBeUndefined();
  });
});
