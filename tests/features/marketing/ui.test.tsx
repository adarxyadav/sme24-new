import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { PACKAGES } from "@/features/marketing/packages";
import { CompanyLookupField } from "@/features/marketing/ui/company-lookup-field";
import { MarketingFooter } from "@/features/marketing/ui/marketing-footer";
import { PackageCard } from "@/features/marketing/ui/package-card";
import { StepsSection } from "@/features/marketing/ui/steps-section";
import { formats } from "@/i18n/formats";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

// The App Router is not mounted in jsdom; next-intl's Link only needs these hooks to exist.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

function renderIn(locale: "de-CH" | "en-CH", ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "de-CH" ? de : en}
      formats={formats}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const compliance = PACKAGES.find((entry) => entry.key === "compliance");
const retainer = PACKAGES.find((entry) => entry.key === "retainer");
if (!compliance || !retainer)
  throw new Error("the catalog needs the compliance and retainer packages");

describe("PackageCard (spec 0009, AC-5, AC-6)", () => {
  it("shows the price without decimals in CHF, the VAT note, the points and the sign up call to action", () => {
    renderIn("en-CH", <PackageCard entry={{ ...compliance, priceChf: 4900 }} />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      en.marketing.packages.compliance.name,
    );
    // ICU's Swiss grouping character differs between Node versions: match CHF, the digits and any mark.
    expect(screen.getByText(/CHF\s?4.?900$/)).toBeInTheDocument();
    expect(screen.getByText(en.marketing.pricing.vatNote)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(compliance.included.length);
    expect(screen.getByRole("link", { name: en.marketing.pricing.cta })).toHaveAttribute(
      "href",
      "/en/sign-up",
    );
  });

  it("shows price on request and the contact call to action with the retainer topic", () => {
    renderIn("de-CH", <PackageCard entry={retainer} />);
    expect(screen.getByText(de.marketing.pricing.priceOnRequest)).toBeInTheDocument();
    expect(screen.queryByText(de.marketing.pricing.vatNote)).toBeNull();
    expect(screen.getByRole("link", { name: de.marketing.pricing.retainerCta })).toHaveAttribute(
      "href",
      "/de/kontakt?topic=retainer",
    );
  });

  it("links to the pricing page and hides the points in the overview variant", () => {
    renderIn("en-CH", <PackageCard entry={{ ...compliance, priceChf: 4900 }} variant="overview" />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("link", { name: en.marketing.pricing.overviewLink })).toHaveAttribute(
      "href",
      "/en/pricing",
    );
  });
});

describe("CompanyLookupField (spec 0009, AC-5)", () => {
  it("is a GET form to the localized sign up page carrying the company field", () => {
    renderIn(
      "de-CH",
      <CompanyLookupField locale="de-CH" label="Ihr Unternehmen" placeholder="Name" cta="Los" />,
    );
    const field = screen.getByLabelText("Ihr Unternehmen");
    expect(field).toHaveAttribute("name", "company");
    expect(field).toHaveAttribute("maxlength", "200");
    const form = field.closest("form");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/de/sign-up");
    expect(screen.getByRole("button", { name: "Los" })).toHaveAttribute("type", "submit");
  });
});

describe("StepsSection (spec 0009, AC-5)", () => {
  it("renders an ordered list of numbered steps under one h2", () => {
    renderIn(
      "en-CH",
      <StepsSection
        eyebrow="How it works"
        title="Four steps. No kickoff."
        steps={[
          { key: "a", title: "Look up.", body: "A" },
          { key: "b", title: "Benchmark.", body: "B" },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Four steps");
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(screen.getByText("01")).toBeInTheDocument();
  });
});

describe("MarketingFooter (spec 0009, AC-7)", () => {
  it("renders the product and company groups with typed links and the mail address, and no legal group yet", () => {
    renderIn("de-CH", <MarketingFooter />);
    expect(
      screen.getByRole("navigation", { name: de.marketing.footer.product }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: de.marketing.footer.company }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: de.marketing.footer.legal })).toBeNull();
    expect(screen.getByRole("link", { name: de.marketing.nav.pricing })).toHaveAttribute(
      "href",
      "/de/preise",
    );
    expect(screen.getByRole("link", { name: de.marketing.nav.freeBenchmark })).toHaveAttribute(
      "href",
      "/de/sign-up",
    );
    expect(screen.getByRole("link", { name: de.marketing.nav.about })).toHaveAttribute(
      "href",
      "/de/ueber-uns",
    );
    expect(screen.getByRole("link", { name: de.marketing.nav.contact })).toHaveAttribute(
      "href",
      "/de/kontakt",
    );
    expect(screen.getByRole("link", { name: "service@sme24.ch" })).toHaveAttribute(
      "href",
      "mailto:service@sme24.ch",
    );
  });

  it("renders the legal group once links are given", () => {
    renderIn(
      "en-CH",
      <MarketingFooter legal={[{ kind: "external", href: "/en/privacy", label: "Privacy" }]} />,
    );
    expect(screen.getByRole("navigation", { name: en.marketing.footer.legal })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/en/privacy");
  });
});
