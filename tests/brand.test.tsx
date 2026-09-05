import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { BrandMark } from "@/components/brand/brand-mark";
import { CampaignFrame, CampaignGrid, CampaignPiece } from "@/components/brand/campaign";
import { Logo } from "@/components/brand/logo";
import { Signature } from "@/components/brand/signature";
import { Statement, splitSentences } from "@/components/brand/statement";
import de from "../messages/de-CH.json";
import en from "../messages/en-CH.json";

function withMessages(ui: React.ReactNode, locale: "de-CH" | "en-CH" = "de-CH") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "de-CH" ? de : en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Statement (brand campaign language)", () => {
  it("splits copy into sentences and drops the periods", () => {
    expect(splitSentences("Senior experts. No slides. Just results.")).toEqual([
      { text: "Senior experts", stop: true },
      { text: "No slides", stop: true },
      { text: "Just results", stop: true },
    ]);
    expect(splitSentences("AI")).toEqual([{ text: "AI", stop: false }]);
  });

  it("splits only at a period followed by whitespace or the end, so domains and decimals stay whole", () => {
    expect(splitSentences("Mehr auf sme24.ch. Ab 1.5 Tagen.")).toEqual([
      { text: "Mehr auf sme24.ch", stop: true },
      { text: "Ab 1.5 Tagen", stop: true },
    ]);
    expect(splitSentences("Nur ein Satz")).toEqual([{ text: "Nur ein Satz", stop: false }]);
  });

  it("renders a repeated sentence as its own line without a duplicate key warning", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<Statement text="Nein. Nein." />);
    expect(container.querySelectorAll("[data-slot=statement] > span")).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
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
    withMessages(<Signature />, "de-CH");
    expect(screen.getByText(de.brand.signature)).toBeInTheDocument();
    withMessages(<Signature />, "en-CH");
    expect(screen.getByText(en.brand.signature)).toBeInTheDocument();
  });
});

describe("Campaign blocks", () => {
  it("renders statement, subline and the signature on a white piece", () => {
    const { container } = withMessages(
      <CampaignPiece statement="Geschäftsessen." subline="(Auch vegan).">
        <CampaignFrame placeholder="Objekt" />
      </CampaignPiece>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Geschäftsessen.");
    expect(screen.getByText("(Auch vegan).")).toBeInTheDocument();
    expect(screen.getByText(de.brand.signature)).toBeInTheDocument();
    expect(container.querySelector("[data-slot=campaign-piece]")).toHaveClass("bg-pure-white");
  });

  it("keeps a bare caption without the square stop and hides empty frames from AT", () => {
    const { container } = withMessages(
      <CampaignPiece statement="Results delivered." signature={false}>
        <CampaignGrid>
          <CampaignFrame caption="AI" empty />
          <CampaignFrame caption="Philipp" placeholder="Photo" />
        </CampaignGrid>
      </CampaignPiece>,
    );
    const captions = screen.getAllByRole("heading", { level: 3 });
    expect(captions[0]).toHaveTextContent(/^AI$/);
    expect(
      container.querySelectorAll("[data-slot=campaign-frame] [aria-hidden='true']"),
    ).toHaveLength(2);
    expect(screen.queryByText(de.brand.signature)).not.toBeInTheDocument();
  });
});
