import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketingHeader } from "@/components/marketing-header";
import { PROCESSORS } from "@/features/legal/processors";
import { PACKAGES, sortedPackages } from "@/features/marketing/packages";
import { CompanyLookupField } from "@/features/marketing/ui/company-lookup-field";
import { EnquiryConfirmation } from "@/features/marketing/ui/enquiry-confirmation";
import { Faq } from "@/features/marketing/ui/faq";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { MarketingFooter } from "@/features/marketing/ui/marketing-footer";
import { PackageCard } from "@/features/marketing/ui/package-card";
import { PackagesGrid } from "@/features/marketing/ui/packages-grid";
import { StepsSection } from "@/features/marketing/ui/steps-section";
import { TrustSection } from "@/features/marketing/ui/trust-section";
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
const culture = PACKAGES.find((entry) => entry.key === "culture");
if (!compliance || !retainer || !culture)
  throw new Error("the catalog needs the culture, compliance and retainer packages");

describe("PackageCard (spec 0009, AC-5, AC-6)", () => {
  it("shows the price without decimals in CHF, the VAT note, the card lines, the pills and the sign up call to action", () => {
    renderIn("en-CH", <PackageCard entry={{ ...compliance, priceChf: 4900 }} />);
    const messages = en.marketing.packages.compliance;
    // The heading is the trade name; the full catalogue name is the subtitle under it, and the
    // ladder line names the rung below (all three from the owner decision of 2026-09-10).
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(messages.shortName);
    expect(screen.getByText(messages.name)).toBeInTheDocument();
    expect(screen.getByText(messages.buildsOn)).toBeInTheDocument();
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
    // Spec 0011 (AC-16): the button carries the checkout for the package it sits on, so a signed
    // out visitor lands back on it after signing up.
    expect(screen.getByRole("link", { name: en.marketing.pricing.cta })).toHaveAttribute(
      "href",
      `/en/sign-up?next=${encodeURIComponent("/en/app/checkout?package=compliance")}`,
    );
  });

  it("leaves the ladder slot empty on the rungs that have nothing below them", () => {
    // `culture` is the first rung and `retainer` sits outside the ladder, so neither carries a
    // `buildsOn` key. The card reads it through `t.has`, so a missing key must render nothing at
    // all rather than the key's own path.
    for (const entry of [culture, retainer]) {
      const { unmount } = renderIn("en-CH", <PackageCard entry={entry} />);
      expect(screen.queryByText(/buildsOn/)).toBeNull();
      expect(screen.queryByText(/^Everything in/)).toBeNull();
      unmount();
    }
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
    // The visible label stays short; the accessible name names the package, so a link list does
    // not read "See all prices" four times.
    const overview = screen.getByRole("link", {
      name: en.marketing.pricing.overviewLinkFor.replace(
        "{name}",
        en.marketing.packages.compliance.name,
      ),
    });
    expect(overview).toHaveAttribute("href", "/en/pricing");
    expect(overview).toHaveTextContent(en.marketing.pricing.overviewLink);
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
  const steps = [
    { key: "a", title: "Look up.", body: "A", label: "Look up" },
    { key: "b", title: "Benchmark.", body: "B", label: "Benchmark" },
  ];

  it("renders an ordered list of numbered steps under one h2", () => {
    renderIn(
      "en-CH",
      <StepsSection
        eyebrow="How it works"
        title="Four steps. No kickoff."
        navLabel="The steps"
        steps={steps}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Four steps");
    // The panels are the only list a screen reader sees: the rail is `aria-hidden`, so its own
    // `ol` never reaches the accessibility tree and this stays the single list in the section.
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    // Twice on purpose: the panel's own marker and the rail's copy of it. The panel's is the one
    // that has to be there, so it is asserted through the panel rather than by text alone.
    expect(document.querySelector('[data-step="a"]')).toHaveTextContent("01");
  });

  it("names the rail landmark and hides its duplicate labels from assistive tech", () => {
    renderIn(
      "en-CH",
      <StepsSection
        eyebrow="How it works"
        title="Four steps. No kickoff."
        navLabel="The steps"
        steps={steps}
      />,
    );
    const rail = screen.getByRole("navigation", { name: "The steps" });
    expect(rail).toBeInTheDocument();
    expect(rail.querySelector("ol")).toHaveAttribute("aria-hidden", "true");
    // Every panel carries the key the rail observes, so the highlight can never point at a step
    // that is not on the page.
    for (const step of steps) {
      expect(document.querySelector(`[data-step="${step.key}"]`)).toBeInTheDocument();
    }
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
    expect(screen.getByRole("link", { name: de.marketing.nav.riskCost })).toHaveAttribute(
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
  const cta = { href: "/sign-up", label: de.marketing.nav.riskCost } as const;

  it("marks the current page on the localized slug and links the others without the mark", () => {
    boundary.pathname = "/de/preise";
    renderIn("de-CH", <MarketingHeader links={links} cta={cta} />);
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
    // The one filled button in the chrome carries the conversion, under the same label the footer
    // and every page's closing call to action use; sign in sits beside it as a quiet link.
    expect(screen.getByRole("link", { name: de.marketing.nav.riskCost })).toHaveAttribute(
      "href",
      "/de/sign-up",
    );
  });

  it("marks nothing on the landing page", () => {
    boundary.pathname = "/de";
    renderIn("de-CH", <MarketingHeader links={links} cta={cta} />);
    for (const link of links) {
      expect(screen.getByRole("link", { name: link.label })).not.toHaveAttribute("aria-current");
    }
  });

  /** The bar reads `window.scrollY` on scroll; jsdom needs the value set and the event fired. */
  function scrollTo(y: number) {
    window.scrollY = y;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
  }

  it("sticks to the top, transparent until the bar's own height and frosted with a hairline past it", () => {
    boundary.pathname = "/de/preise";
    const { container } = renderIn("de-CH", <MarketingHeader links={links} cta={cta} />);
    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");

    // At rest and at the threshold itself the bar stays transparent, so the page shows through.
    expect(header.className).toContain("bg-transparent");
    expect(header.className).toContain("border-transparent");
    scrollTo(64);
    expect(header.className).toContain("bg-transparent");

    scrollTo(65);
    expect(header.className).toContain("bg-background/85");
    expect(header.className).toContain("border-border");
    expect(header.className).not.toContain("bg-transparent");

    // Back at the top it lets go of the hairline again.
    scrollTo(0);
    expect(header.className).toContain("bg-transparent");
  });

  it("never inverts the bar: every page, the landing included, opens on the page ground", () => {
    // The landing hero sits on the page ground since 2026-09-07 (white in light, jet in dark),
    // so the bar must not carry `dark` over it: inverting would hide the lockup in light mode.
    boundary.pathname = "/de";
    const { container, unmount } = renderIn("de-CH", <MarketingHeader links={links} cta={cta} />);
    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).not.toContain("dark");

    // The frosted swap still follows the hero's own bottom edge (`data-hero`), not a scroll
    // offset; jsdom gives every element a zero rect, so a stand in carries stubbed geometry.
    const main = document.createElement("main");
    const hero = document.createElement("section");
    hero.setAttribute("data-hero", "true");
    main.append(hero);
    document.body.append(main);
    const heroBottom = vi.spyOn(hero, "getBoundingClientRect");

    // Scrolled with the hero still behind the bar: frosted on the page ground, not inverted.
    heroBottom.mockReturnValue({ bottom: 900 } as DOMRect);
    scrollTo(200);
    expect(header.className).not.toContain("dark");
    expect(header.className).not.toContain("bg-transparent");

    heroBottom.mockReturnValue({ bottom: -10 } as DOMRect);
    scrollTo(1200);
    expect(header.className).not.toContain("dark");
    expect(header.className).not.toContain("bg-transparent");
    main.remove();
    unmount();

    scrollTo(0);
    boundary.pathname = "/de/kontakt";
    const plain = renderIn("de-CH", <MarketingHeader links={links} cta={cta} />);
    expect((plain.container.querySelector("header") as HTMLElement).className).not.toContain(
      "dark",
    );
  });

  it("opens the small screen menu from a labelled button and repeats the links with the current mark", async () => {
    const user = userEvent.setup();
    boundary.pathname = "/de/kontakt";
    renderIn("de-CH", <MarketingHeader links={links} cta={cta} />);
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
    expect(sheet.getByRole("link", { name: de.marketing.nav.riskCost })).toHaveAttribute(
      "href",
      "/de/sign-up",
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
    // The heading is the one word trade name since 2026-09-10; the full catalogue name sits
    // under it as a subtitle, and it is still the name the card's link announces.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(
      sortedPackages().map(
        (entry) => en.marketing.packages[entry.key as keyof typeof en.marketing.packages].shortName,
      ),
    );
    expect(headings).toHaveLength(4);
    for (const entry of sortedPackages()) {
      const messages = en.marketing.packages[entry.key as keyof typeof en.marketing.packages];
      expect(screen.getByText(messages.name), `${entry.key} full name`).toBeInTheDocument();
    }
    // Each card's link carries its own accessible name, so the four are told apart.
    expect(
      sortedPackages().map(
        (entry) =>
          screen.getByRole("link", {
            name: en.marketing.pricing.overviewLinkFor.replace(
              "{name}",
              en.marketing.packages[entry.key as keyof typeof en.marketing.packages].name,
            ),
          }).textContent,
      ),
    ).toEqual(Array(4).fill(en.marketing.pricing.overviewLink));
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

describe("TrustSection (docs/design.md, tier map: major)", () => {
  it("opens as a major with the heading the section is labelled by", () => {
    const { container } = renderIn("en-CH", <TrustSection />);
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("trust-heading");
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.id).toBe("trust-heading");
    expect(heading).toHaveTextContent(en.marketing.landing.trust.title.replace(/\.$/, ""));
    expect(screen.getByText(en.marketing.landing.trust.lead)).toBeInTheDocument();
  });

  it("renders the three panels as one labelled list, each with its own subheading", () => {
    renderIn("en-CH", <TrustSection />);
    const panels = screen.getByRole("list", {
      name: en.marketing.landing.trust.panelsLabel,
    });
    // The panels are the list's own children.
    expect([...panels.children].filter((node) => node.tagName === "LI")).toHaveLength(3);
    for (const key of ["residency", "isolation", "record"] as const) {
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: en.marketing.landing.trust.panels[key].title,
        }),
      ).toBeInTheDocument();
    }
  });

  it("counts the processors per region from PROCESSORS, so the panel cannot drift from the stack", () => {
    renderIn("en-CH", <TrustSection />);
    for (const region of ["ch", "eu", "us"] as const) {
      const count = PROCESSORS.filter((processor) => processor.region === region).length;
      expect(
        screen.getByText(en.marketing.landing.trust.panels.record.regions[region]),
      ).toBeInTheDocument();
      expect(
        screen.getByText(en.marketing.landing.trust.panels.record.purposes[region]),
      ).toBeInTheDocument();
      expect(
        screen.getByText(`${count} ${count === 1 ? "provider" : "providers"}`),
      ).toBeInTheDocument();
    }
  });

  it("names no processor on the landing page, leaving the vendor list to the privacy page", () => {
    const { container } = renderIn("en-CH", <TrustSection />);
    // A buyer wants the jurisdiction here; the supplier list belongs where due diligence looks.
    for (const processor of PROCESSORS) {
      expect(container.textContent).not.toContain(processor.name);
    }
  });

  it("states each isolation outcome in words, never by colour or icon alone", () => {
    renderIn("en-CH", <TrustSection />);
    const { allowed, denied } = en.marketing.landing.trust.panels.isolation;
    expect(screen.getAllByText(allowed)).toHaveLength(2);
    expect(screen.getAllByText(denied)).toHaveLength(1);
  });

  it("links to the privacy page and renders the German catalogue too", () => {
    const { unmount } = renderIn("en-CH", <TrustSection />);
    expect(screen.getByRole("link", { name: en.marketing.landing.trust.cta })).toHaveAttribute(
      "href",
      "/en/privacy",
    );
    unmount();

    renderIn("de-CH", <TrustSection />);
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: de.marketing.landing.trust.panels.isolation.title,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: de.marketing.landing.trust.cta })).toHaveAttribute(
      "href",
      "/de/datenschutz",
    );
  });
});
