import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketingHeader } from "@/components/marketing-header";
import { PACKAGES, sortedPackages } from "@/features/marketing/packages";
import { CompanyLookupField } from "@/features/marketing/ui/company-lookup-field";
import { EnquiryConfirmation } from "@/features/marketing/ui/enquiry-confirmation";
import { Faq } from "@/features/marketing/ui/faq";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { MarketingFooter } from "@/features/marketing/ui/marketing-footer";
import { PackageCard } from "@/features/marketing/ui/package-card";
import { PackagesGrid } from "@/features/marketing/ui/packages-grid";
import { StepsSection } from "@/features/marketing/ui/steps-section";
import { formats } from "@/i18n/formats";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

// The App Router is not mounted in jsdom; next-intl's Link and usePathname only need these hooks
// to exist. The pathname is settable so the header test can mark the current page.
const boundary = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => boundary.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

beforeEach(() => {
  boundary.pathname = "/";
});

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
  it("shows the price without decimals in CHF, the VAT note, the card lines, the pills and the sign up call to action", () => {
    renderIn("en-CH", <PackageCard entry={{ ...compliance, priceChf: 4900 }} />);
    const messages = en.marketing.packages.compliance;
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(messages.name);
    expect(screen.getByText(messages.promise)).toBeInTheDocument();
    expect(screen.getByText(messages.bestFor)).toBeInTheDocument();
    // ICU's Swiss grouping character differs between Node versions: match CHF, the digits and any mark.
    expect(screen.getByText(/CHF\s?4.?900$/)).toBeInTheDocument();
    expect(screen.getByText(en.marketing.pricing.vatNote)).toBeInTheDocument();
    expect(screen.getByText(messages.delivery)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      compliance.included.map(
        (point) => messages.included[point as keyof typeof messages.included],
      ),
    );
    expect(screen.getByText(messages.output)).toBeInTheDocument();
    expect(screen.getByText(messages.outcome)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.marketing.pricing.cta })).toHaveAttribute(
      "href",
      "/en/sign-up",
    );
  });

  it("shows on demand and the contact call to action with the retainer topic", () => {
    renderIn("de-CH", <PackageCard entry={retainer} />);
    expect(screen.getByText(de.marketing.pricing.onDemand)).toBeInTheDocument();
    expect(screen.queryByText(de.marketing.pricing.vatNote)).toBeNull();
    expect(screen.getByRole("link", { name: de.marketing.pricing.retainerCta })).toHaveAttribute(
      "href",
      "/de/kontakt?topic=retainer",
    );
  });

  it("links to the pricing page and hides the details in the overview variant", () => {
    renderIn("en-CH", <PackageCard entry={{ ...compliance, priceChf: 4900 }} variant="overview" />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(en.marketing.packages.compliance.delivery)).toBeNull();
    expect(screen.queryByText(en.marketing.packages.compliance.bestFor)).toBeNull();
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

  it("has no language switch of its own, so the header's stays the only one on the page", () => {
    renderIn("de-CH", <MarketingFooter />);
    expect(screen.queryByRole("button", { name: de.common.language })).toBeNull();
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

describe("MarketingHeader (spec 0009, AC-7)", () => {
  const links = [
    { href: "/pricing", label: "Preise" },
    { href: "/about", label: "Über uns" },
    { href: "/contact", label: "Kontakt" },
  ] as const;

  it("marks the current page on the localized slug and links the others without the mark", () => {
    boundary.pathname = "/de/preise";
    renderIn("de-CH", <MarketingHeader links={links} />);
    const nav = screen.getByRole("navigation", { name: de.shell.mainNavigation });
    const pricing = screen.getByRole("link", { name: "Preise" });
    expect(nav).toContainElement(pricing);
    expect(pricing).toHaveAttribute("href", "/de/preise");
    expect(pricing).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Über uns" })).toHaveAttribute("href", "/de/ueber-uns");
    expect(screen.getByRole("link", { name: "Über uns" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Kontakt" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: de.common.signIn })).toHaveAttribute(
      "href",
      "/de/sign-in",
    );
  });

  it("marks nothing on the landing page", () => {
    boundary.pathname = "/de";
    renderIn("de-CH", <MarketingHeader links={links} />);
    for (const link of links) {
      expect(screen.getByRole("link", { name: link.label })).not.toHaveAttribute("aria-current");
    }
  });

  it("opens the small screen menu from a labelled button and repeats the links with the current mark", async () => {
    const user = userEvent.setup();
    boundary.pathname = "/de/kontakt";
    renderIn("de-CH", <MarketingHeader links={links} />);
    await user.click(screen.getByRole("button", { name: de.shell.openMenu }));
    const dialog = await screen.findByRole("dialog", { name: de.common.appName });
    expect(dialog).toHaveTextContent(de.shell.menuDescription);
    // The open sheet is modal: Radix hides the page behind it, so only the sheet's links remain.
    const sheet = within(dialog);
    expect(sheet.getByRole("navigation", { name: de.shell.mainNavigation })).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "Kontakt" })).toHaveAttribute("aria-current", "page");
    expect(sheet.getByRole("link", { name: "Preise" })).not.toHaveAttribute("aria-current");
    expect(sheet.getByRole("link", { name: de.common.signIn })).toHaveAttribute(
      "href",
      "/de/sign-in",
    );
  });
});

describe("Faq (spec 0009, AC-6)", () => {
  const items = [
    { id: "vat", question: "Is VAT included?", answer: "No, the invoice adds it." },
    { id: "date", question: "How is the date set?", answer: "The expert proposes dates." },
  ];

  it("opens the first question by default and shows only one answer at a time", async () => {
    const user = userEvent.setup();
    renderIn("en-CH", <Faq items={items} />);
    const first = screen.getByRole("button", { name: "Is VAT included?" });
    const second = screen.getByRole("button", { name: "How is the date set?" });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("No, the invoice adds it.")).toBeVisible();

    await user.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("The expert proposes dates.")).toBeVisible();
  });

  it("renders nothing to open for an empty list", () => {
    renderIn("en-CH", <Faq items={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("EnquiryConfirmation (spec 0009, AC-8)", () => {
  it("is announced as a status, names the reply time and links back to the landing page", () => {
    renderIn("de-CH", <EnquiryConfirmation />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(de.marketing.contact.success.title);
    expect(status).toHaveTextContent(de.marketing.contact.success.body);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      de.marketing.contact.success.title,
    );
    expect(screen.getByRole("link", { name: de.marketing.contact.success.back })).toHaveAttribute(
      "href",
      "/de",
    );
  });
});

describe("PackagesGrid (spec 0009, AC-5, AC-6)", () => {
  it("renders one card per package in catalog order", () => {
    renderIn("en-CH", <PackagesGrid variant="overview" />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(
      sortedPackages().map(
        (entry) => en.marketing.packages[entry.key as keyof typeof en.marketing.packages].name,
      ),
    );
    expect(headings).toHaveLength(4);
    expect(screen.getAllByRole("link", { name: en.marketing.pricing.overviewLink })).toHaveLength(
      4,
    );
  });
});

describe("JsonLd (spec 0009, AC-3)", () => {
  it("writes the object into a JSON-LD script with every angle bracket escaped", () => {
    const { container } = renderIn(
      "en-CH",
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "SME24 </script><script>alert(1)",
        }}
      />,
    );
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(script?.innerHTML).not.toContain("<");
    expect(script?.innerHTML).toContain("\\u003c/script>");
    expect(JSON.parse(script?.innerHTML ?? "")).toMatchObject({
      "@type": "Organization",
      name: "SME24 </script><script>alert(1)",
    });
  });
});
