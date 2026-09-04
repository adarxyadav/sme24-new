import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { BrandMark } from "@/components/brand/brand-mark";
import { Logo } from "@/components/brand/logo";
import { Signature } from "@/components/brand/signature";
import { Statement, splitSentences } from "@/components/brand/statement";
import de from "../messages/de.json";
import en from "../messages/en.json";

function withMessages(ui: React.ReactNode, locale: "de" | "en" = "de") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Statement (brand campaign language)", () => {
  it("splits copy into sentences and drops the periods", () => {
    expect(splitSentences("Senior experts. No slides. Just results.")).toEqual([
      "Senior experts",
      "No slides",
      "Just results",
    ]);
    expect(splitSentences("One line")).toEqual(["One line"]);
  });

  it("renders one line per sentence with a hidden period so it still reads as prose", () => {
    const { container } = render(<Statement as="h1" text="No slides. Results." />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("No slides. Results.");
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(2);
    expect(container.querySelectorAll(".sr-only")).toHaveLength(2);
  });
});

describe("BrandMark", () => {
  it("is decorative by default and named when a title is given", () => {
    const { container, rerender } = render(<BrandMark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    rerender(<BrandMark variant="badge" title="SME24" />);
    expect(screen.getByRole("img", { name: "SME24" })).toBeInTheDocument();
  });

  it("knocks the mark out of the badge with a mask instead of a second color", () => {
    const { container } = render(<BrandMark variant="badge" />);
    expect(container.querySelector("mask")).not.toBeNull();
    expect(container.querySelector("circle")).toHaveAttribute("mask");
  });
});

describe("Logo and Signature", () => {
  it("uses the product name as the accessible text and adds the descriptor on request", () => {
    withMessages(<Logo descriptor />);
    expect(screen.getByText("SME24")).toBeInTheDocument();
    expect(screen.getByText(de.brand.descriptor)).toBeInTheDocument();
  });

  it("signs off in the campaign voice for each locale", () => {
    withMessages(<Signature />, "de");
    expect(screen.getByText(de.brand.signature)).toBeInTheDocument();
    withMessages(<Signature />, "en");
    expect(screen.getByText(en.brand.signature)).toBeInTheDocument();
  });
});
