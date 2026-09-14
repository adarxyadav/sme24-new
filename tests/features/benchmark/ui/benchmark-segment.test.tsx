import { screen } from "@testing-library/react";
import axe from "axe-core";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { roundMoney } from "@/features/benchmark/loss";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { formats, TIME_ZONE } from "@/i18n/formats";
import {
  company,
  en,
  enFormat,
  parsedSnapshot,
  peerRow,
  readyBlocks,
  renderEnglish,
  suggestion,
} from "./helpers";

/**
 * The benchmark segment of `benchmark-model@7` (spec 0022, AC-18, AC-20 to AC-23): the waiting
 * states, the `outdated` sentence for a snapshot of a version this code no longer reads, the
 * `noData` alert with the figures slot, the facts card, and on a readable snapshot the four
 * sections in order — the one peer table with the client's row in place, the estimated loss with
 * its counts, the suggested experts and the recommended package. The server translator and
 * formatter, the server action and the router are the boundaries.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en-CH", messages: en, namespace: namespace as never, formats }),
  getFormatter: async () => createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE }),
}));
vi.mock("@/features/benchmark/actions", () => ({ updateCompanyFacts: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/app",
  useSearchParams: () => new URLSearchParams(),
  // `Link` and `checkoutPath` reach `createNavigation`, which reads both redirect helpers at
  // module scope (the package card, spec 0022 AC-23).
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

const b = en.benchmark;

/**
 * An amount as the segment prints it, from the real formatter rather than a typed out string, and
 * through the same `roundMoney` the segment applies: money is stored unrounded and rounded once at
 * display (AC-14), so a stored 365 715 reads as 366 000 on the card and in the email alike.
 */
const money = (value: number, currency = "CHF") =>
  enFormat.number(roundMoney(value), { style: "currency", currency, maximumFractionDigits: 0 });

async function renderSegment(overrides: Partial<Parameters<typeof BenchmarkSegment>[0]> = {}) {
  const element = await BenchmarkSegment({
    snapshot: parsedSnapshot(),
    state: "ready",
    company,
    locale: "en",
    ...overrides,
  });
  return renderEnglish(element);
}

const section = () => screen.getByRole("region", { name: b.heading });

describe("the waiting states (spec 0008, AC-9)", () => {
  it("shows the calculating text with a live region and a skeleton, and nothing else", async () => {
    const { container } = await renderSegment({ snapshot: null, state: "calculating" });
    expect(section()).toHaveAttribute("data-benchmark-state", "calculating");
    expect(screen.getByText(b.state.calculating)).toHaveAttribute("aria-live", "polite");
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(container.querySelector("[data-facts-card]")).not.toBeInTheDocument();
  });

  it("says the benchmark is not available yet, without a form", async () => {
    const { container } = await renderSegment({ snapshot: null, state: "unavailable" });
    expect(screen.getByText(b.state.unavailable)).toBeInTheDocument();
    expect(container.querySelector("[data-facts-card]")).not.toBeInTheDocument();
  });

  it("offers the figures slot and the facts card beside the noData alert", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({}, { loss: null, peers: null }),
      state: "noData",
      figuresSlot: <p>Your figures</p>,
    });
    expect(screen.getByText(b.state.noData)).toBeInTheDocument();
    expect(screen.getByText("Your figures")).toBeInTheDocument();
    expect(container.querySelector("[data-facts-card]")).toBeInTheDocument();
  });

  it("hides the figures slot and the facts card from a read only reader (spec 0013, AC-11)", async () => {
    const { container } = await renderSegment({
      state: "noData",
      readOnly: true,
      figuresSlot: <p>Your figures</p>,
    });
    expect(screen.queryByText("Your figures")).not.toBeInTheDocument();
    expect(container.querySelector("[data-facts-card]")).not.toBeInTheDocument();
  });
});

describe("the outdated state (spec 0022, AC-18)", () => {
  it("shows one sentence and nothing from the stored row", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ modelVersion: "benchmark-model@5", blocks: null }),
      state: "outdated",
    });
    expect(section()).toHaveAttribute("data-benchmark-state", "outdated");
    expect(container.querySelector("[data-outdated]")).toBeInTheDocument();
    expect(screen.getByText(b.state.outdated)).toBeInTheDocument();
    // Nothing of the old model is rendered; the facts card stands so the client can correct and rerun.
    expect(container.querySelector("[data-facts-card]")).toBeInTheDocument();
    expect(screen.queryByText(b.state.noData)).not.toBeInTheDocument();
  });
});

describe("the peer table (spec 0022, AC-20)", () => {
  it("renders the four sections in the order the spec fixes", async () => {
    const { container } = await renderSegment();
    const cards = [...container.querySelectorAll("[data-peers-card],[data-loss-card]")];
    const order = [...container.querySelectorAll("[data-slot='card']")].flatMap((card) =>
      card.hasAttribute("data-peers-card")
        ? ["peers"]
        : card.hasAttribute("data-loss-card")
          ? ["loss"]
          : card.hasAttribute("data-experts-card")
            ? ["experts"]
            : card.hasAttribute("data-package-card")
              ? ["package"]
              : card.hasAttribute("data-facts-card")
                ? ["facts"]
                : [],
    );
    expect(cards).toHaveLength(2);
    expect(order).toEqual(["peers", "loss", "experts", "package", "facts"]);
  });

  it("badges the peer count with the rung and lists every peer once", async () => {
    const { container } = await renderSegment();
    expect(container.querySelector("[data-peer-count]")).toHaveAttribute("data-peer-count", "3");
    expect(screen.getByText("3 peers in Switzerland")).toBeInTheDocument();
    for (const name of ["Alpha AG", "Beta SA", "Gamma GmbH"]) {
      expect(container.querySelector(`[data-peer="${name}"]`), name).toBeInTheDocument();
    }
  });

  it("names both ranks in one sentence", async () => {
    const { container } = await renderSegment();
    expect(container.querySelector("[data-rank-sentence]")).toHaveTextContent(
      "You rank 3 of 4 on LTIFR and 3 of 4 on TRIFR among published peers in Manufacturing in Switzerland.",
    );
  });

  it("puts the client's own row in place by its TRIFR, with the figures badge", async () => {
    const { container } = await renderSegment({ companyName: "Musterfirma AG" });
    // Scoped to the peer table: the chart's own `sr-only` table has rows too, and they are not
    // this ordering.
    const rows = [...(container.querySelectorAll("table:not([data-chart-table]) tbody tr") ?? [])];
    // TRIFR 10 sits between Beta SA (9) and Gamma GmbH (13).
    expect(
      rows.map((row) =>
        row.hasAttribute("data-client-row") ? "client" : row.getAttribute("data-peer"),
      ),
    ).toEqual(["Alpha AG", "Beta SA", "client", "Gamma GmbH"]);
    const client = container.querySelector("[data-client-row]");
    expect(client).toHaveTextContent("Musterfirma AG");
    expect(client).toHaveTextContent(b.peers.table.you);
  });

  it("shows a dash for a peer without a headcount and no estimated loss", async () => {
    const { container } = await renderSegment();
    const gamma = container.querySelector('[data-peer="Gamma GmbH"]');
    expect(gamma).toHaveTextContent(b.peers.table.noHeadcount);
    expect(gamma?.textContent).toContain("—");
  });

  it("opens every source link in a new tab and carries the footnote", async () => {
    const { container } = await renderSegment();
    const links = [...container.querySelectorAll("tbody a[href^='https://']")];
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
    expect(container.querySelector("[data-peers-footnote]")).toHaveTextContent(b.peers.footnote);
  });

  it("replaces the rank sentence with the thin sentence when the run found fewer than three", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        {},
        {
          peers: {
            rung: "country",
            thin: true,
            rows: [peerRow("Alpha AG", 2, 5)],
            rates: { ltifr: { count: 1, median: 2, best: 2, rank: 2, of: 2, gapToMedian: 4 } },
          },
        },
      ),
    });
    expect(container.querySelector("[data-rank-sentence]")).toHaveTextContent(
      "We found only 1 published peer for your sector.",
    );
  });

  it("says so when the run kept no peer at all", async () => {
    await renderSegment({ snapshot: parsedSnapshot({}, { peers: null }) });
    expect(screen.getByText(b.peers.empty)).toBeInTheDocument();
  });

  /**
   * The failure case of the spec's critical scenarios (AC-7, AC-10, AC-14): the peer search failed
   * or found nothing, so the run carries no peers, but the client's own figures were never at risk.
   * The page must still price them. This is the invariant the task boundary exists to protect, so
   * it is asserted on the page, where a client would see it break.
   */
  it("still prices the client's own loss when the peer search brought nothing back", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        {},
        {
          peers: null,
          // No peers means no comparison, so every peer derived figure goes null while the
          // client's own loss and its counts stand untouched.
          loss: {
            ltis: 5.4,
            recordables: 3.6,
            trifrMissing: false,
            fatalities: 0,
            loss: 365_715,
            atMedian: null,
            atBest: null,
            savingAtMedian: null,
            savingAtBest: null,
          },
        },
      ),
    });
    expect(screen.getByText(b.peers.empty)).toBeInTheDocument();
    expect(container.querySelector("[data-loss-headline]")?.textContent).toBe(
      `${money(365_715)} a year`,
    );
    // The counts behind the figure survive too: they come from the client's own rates (AC-14).
    expect(screen.getByText("5.4 lost time injuries")).toBeInTheDocument();
    // Nothing offers a saving the page cannot compute.
    const savings = [...container.querySelectorAll("[data-loss-card] li")].map(
      (item) => item.textContent ?? "",
    );
    expect(savings.some((text) => /less at the/.test(text))).toBe(false);
    // A package is still recommended: the standing rule always answers (AC-15).
    expect(container.querySelector("[data-package-card]")).toBeInTheDocument();
  });
});

describe("the estimated loss (spec 0022, AC-21)", () => {
  it("heads the card with the loss in the company's currency and both savings", async () => {
    const { container } = await renderSegment();
    // Built with the real formatter rather than typed out: `en-CH` groups with the Swiss
    // apostrophe (365’715, not 365,715) and separates the currency with a narrow no break space,
    // neither of which a hand written expectation gets right.
    expect(container.querySelector("[data-loss-headline]")?.textContent).toBe(
      `${money(365_715)} a year`,
    );
    const savings = [...(container.querySelectorAll("[data-loss-card] li") ?? [])].map(
      (item) => item.textContent,
    );
    expect(savings).toContain(`${money(90_247.5)} less at the peer median`);
    expect(savings).toContain(`${money(221_197.5)} less at the best peer`);
  });

  it("prices a company outside Switzerland in its own currency, never in francs", async () => {
    const blocks = readyBlocks();
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        { currency: "EUR" },
        { inputs: { ...blocks.inputs, country: "DE", currency: "EUR" } },
      ),
    });
    const headline = container.querySelector("[data-loss-headline]");
    expect(headline).toHaveTextContent(money(365_715, "EUR"));
    expect(headline?.textContent).not.toContain("CHF");
  });

  it("carries the three counts, each with a Calculated badge", async () => {
    await renderSegment();
    expect(screen.getByText("5.4 lost time injuries")).toBeInTheDocument();
    expect(screen.getByText("3.6 further recordable injuries")).toBeInTheDocument();
    expect(screen.getByText("0 fatalities")).toBeInTheDocument();
    expect(screen.getAllByText(b.loss.counts.calculated)).toHaveLength(3);
  });

  it("names no constant of the loss table anywhere on the card", async () => {
    const { container } = await renderSegment();
    const text = container.querySelector("[data-loss-card]")?.textContent ?? "";
    for (const constant of ["769", "201", "1,200,000", "75"]) {
      expect(text, constant).not.toContain(constant);
    }
  });

  it("asks for the LTIFR and links to the figures card when there is no loss", async () => {
    const { container } = await renderSegment({ snapshot: parsedSnapshot({}, { loss: null }) });
    expect(screen.getByText(b.loss.empty.title)).toBeInTheDocument();
    expect(container.querySelector("[data-loss-card] a")).toHaveAttribute(
      "href",
      "#self-assessment-heading",
    );
  });
});

describe("the experts and the package (spec 0022, AC-22, AC-23)", () => {
  it("shows one card per suggested expert with the ops sentence above them", async () => {
    const { container } = await renderSegment({ experts: [suggestion(), suggestion("2")] });
    expect(screen.getByText(b.experts.description)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-experts-card] li")).toHaveLength(2);
    expect(screen.getAllByText("Safety engineer")).toHaveLength(2);
    expect(screen.getAllByText("Availability: Available")).toHaveLength(2);
    expect(screen.getAllByText("Manufacturing")).toHaveLength(2);
  });

  it("shows one sentence when nothing matched", async () => {
    await renderSegment({ experts: [] });
    expect(screen.getByText(b.experts.empty)).toBeInTheDocument();
  });

  it("offers the recommended package with its reason and the checkout button", async () => {
    const { container } = await renderSegment();
    const card = container.querySelector("[data-package-card]");
    expect(card).toHaveAttribute("data-package", "sms");
    expect(card?.querySelector("[data-package-reason]")).toHaveTextContent(
      b.package.reason.one_worse,
    );
    expect(screen.getByRole("link", { name: "Buy System" })).toHaveAttribute(
      "href",
      "/en/app/checkout?package=sms",
    );
    expect(screen.getByRole("link", { name: b.package.others })).toBeInTheDocument();
  });

  it("offers the enquiry link instead of a price for the retainer", async () => {
    await renderSegment({
      snapshot: parsedSnapshot(
        {},
        { recommendation: { packageKey: "retainer", reason: "fatality" } },
      ),
    });
    expect(screen.getByRole("link", { name: "Ask about Partner" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Buy / })).not.toBeInTheDocument();
  });

  it("offers an expert neither colleagues nor a package (spec 0013, AC-11)", async () => {
    const { container } = await renderSegment({ readOnly: true, experts: [suggestion()] });
    expect(container.querySelector("[data-peers-card]")).toBeInTheDocument();
    expect(container.querySelector("[data-loss-card]")).toBeInTheDocument();
    expect(container.querySelector("[data-experts-card]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-package-card]")).not.toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations in every state", async () => {
    for (const state of ["calculating", "unavailable", "noData", "outdated", "ready"] as const) {
      const { container, unmount } = await renderSegment({ state });
      const results = await axe.run(container, {
        rules: { region: { enabled: false } },
      });
      expect(results.violations, state).toEqual([]);
      unmount();
    }
  });
});
