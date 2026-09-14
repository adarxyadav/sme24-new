import { fireEvent, screen } from "@testing-library/react";
import axe from "axe-core";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { roundMoney } from "@/features/benchmark/loss";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { BUBBLE_RADIUS_MIN } from "@/features/benchmark/ui/chart-scale";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { company, en, enFormat, parsedSnapshot, peerRow, renderEnglish } from "./helpers";

/**
 * The peer chart, the owner's sketch of 14 Sep 2026 (spec 0022, the D-chart follow-up): the rank
 * across, TRIFR up, each company's own estimated yearly loss as the bubble's area, and the client
 * as an unfilled outline among the filled peers. A peer that published no TRIFR has no place on a
 * TRIFR ranking and gets no point; the chart hides itself below two points; every string is
 * formatted by the server parent; axe passes with a bubble focused.
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
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

const b = en.benchmark;

const money = (value: number, currency = "CHF") =>
  enFormat.number(roundMoney(value), { style: "currency", currency, maximumFractionDigits: 0 });

async function renderSegment(overrides: Partial<Parameters<typeof BenchmarkSegment>[0]> = {}) {
  const element = await BenchmarkSegment({
    snapshot: parsedSnapshot(),
    state: "ready",
    company,
    locale: "en",
    companyName: "Musterfirma AG",
    ...overrides,
  });
  return renderEnglish(element);
}

/**
 * Which companies the chart drew, by key. The drawing paints largest first so a small bubble is
 * never buried, so this is deliberately a set rather than an order; the rank order is asserted on
 * the `sr-only` table, which is the one place the chart states a ranking in words.
 */
const drawnKeys = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-bubble]")].map((bubble) =>
    bubble.getAttribute("data-bubble"),
  );

describe("the peer chart (spec 0022, the D-chart)", () => {
  it("ranks by TRIFR with the client among the peers, best on the left", async () => {
    const { container } = await renderSegment();
    // The fixture: Alpha 5, Beta 9, the client 10, Gamma 13. The rank is the position among the
    // companies that published a TRIFR, so it runs 1..n with no gap.
    expect(
      [...container.querySelectorAll("[data-chart-row]")].map((row) => [
        row.querySelector("td")?.textContent,
        row.querySelector("th")?.textContent,
      ]),
    ).toEqual([
      ["1", "Alpha AG"],
      ["2", "Beta SA"],
      ["3", "Musterfirma AG"],
      ["4", "Gamma GmbH"],
    ]);
  });

  it("sizes each bubble by that company's own estimated loss and draws the client as an outline", async () => {
    const { container } = await renderSegment();
    // The circles are the drawing (`[data-bubble-mark]`); `[data-bubble]` is the button over it.
    const radius = (key: string) =>
      Number(
        container
          .querySelector(`[data-bubble-mark="${key}"] circle:last-of-type`)
          ?.getAttribute("r"),
      );
    // Beta's 1 100 000 is four times Alpha's 275 000, so its bubble is twice as wide: the money is
    // the area, not the radius.
    expect(radius("peer-Beta SA")).toBeCloseTo(radius("peer-Alpha AG") * 2, 5);
    // Gamma published no headcount, so it has no loss to price and falls to the floor.
    expect(radius("peer-Gamma GmbH")).toBe(BUBBLE_RADIUS_MIN);
    // The client has no published loss to size a bubble by, so it is an unfilled outline.
    const client = container.querySelector('[data-bubble-mark="client"] circle:last-of-type');
    expect(client).toHaveAttribute("fill", "none");
    expect(client).toHaveAttribute("stroke", "var(--chart-1)");
    expect(radius("client")).toBe(BUBBLE_RADIUS_MIN);
  });

  it("leaves a peer without a TRIFR off the ranking but keeps its table row", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        {},
        {
          peers: {
            rung: "country",
            thin: false,
            rows: [
              peerRow("Alpha AG", 2, 5, { estimatedLoss: 275_000 }),
              peerRow("Beta SA", 4, 9, { headcount: 2_400, estimatedLoss: 1_100_000 }),
              peerRow("Delta AG", 3, null, { estimatedLoss: 400_000 }),
            ],
            rates: {
              ltifr: { count: 3, median: 3, best: 2, rank: 4, of: 4, gapToMedian: 3 },
              trifr: { count: 2, median: 7, best: 5, rank: 3, of: 3, gapToMedian: 3 },
            },
          },
        },
      ),
    });
    // No point for Delta, and no phantom rank: the three that remain are 1, 2, 3.
    expect(drawnKeys(container).sort()).toEqual(["client", "peer-Alpha AG", "peer-Beta SA"]);
    expect(
      [...container.querySelectorAll("[data-chart-row] td:first-child")].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(["1", "2", "3"]);
    // It keeps its row in the peer table below, sorted last among the peers.
    expect(container.querySelector('[data-peer="Delta AG"]')).toBeInTheDocument();
  });

  it("hides the chart when fewer than two companies published a TRIFR", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        {},
        {
          peers: {
            rung: "country",
            thin: true,
            rows: [peerRow("Delta AG", 3, null, { estimatedLoss: 400_000 })],
            rates: { ltifr: { count: 1, median: 3, best: 3, rank: 2, of: 2, gapToMedian: 3 } },
          },
        },
      ),
    });
    // One point (the client alone) is not a comparison, so the table stands on its own.
    expect(container.querySelector("[data-peer-chart]")).not.toBeInTheDocument();
    expect(container.querySelector('[data-peer="Delta AG"]')).toBeInTheDocument();
  });

  it("carries the same figures in the screen reader table as the drawing", async () => {
    const { container } = await renderSegment();
    const beta = container.querySelector('[data-chart-row="peer-Beta SA"]');
    expect(beta).toHaveTextContent("Switzerland");
    expect(beta).toHaveTextContent("9.00");
    // `textContent` and not `toHaveTextContent`: the matcher normalises whitespace, which rewrites
    // the group separators inside a formatted Swiss amount.
    expect(beta?.textContent).toContain(money(1_100_000));
    // Gamma has no loss to show, so the dash stands in for it rather than a zero.
    expect(container.querySelector('[data-chart-row="peer-Gamma GmbH"]')).toHaveTextContent(
      b.peers.table.none,
    );
  });

  it("makes every bubble a real button, so the Tab key reaches it", async () => {
    const { container } = await renderSegment();
    // Not a decorative detail: an SVG `<g tabIndex={0} role="button">` takes focus
    // programmatically and reads correctly, but Chromium leaves SVG children out of the
    // sequential tab order, so those bubbles could not be tabbed to at all. jsdom focuses
    // anything, so this assertion is the only unit level guard against that regression.
    for (const bubble of container.querySelectorAll("[data-bubble]")) {
      expect(bubble.tagName).toBe("BUTTON");
      expect(bubble).toHaveAttribute("type", "button");
    }
  });

  it("shows the figures on focus and closes them on Escape", async () => {
    const { container } = await renderSegment();
    const beta = container.querySelector('[data-bubble="peer-Beta SA"]') as HTMLButtonElement;
    expect(container.querySelector("[data-chart-tooltip]")).not.toBeInTheDocument();
    fireEvent.focus(beta);
    const tooltip = container.querySelector('[data-chart-tooltip="peer-Beta SA"]');
    expect(tooltip).toHaveTextContent("Beta SA");
    expect(tooltip).toHaveTextContent("Rank 2");
    expect(tooltip?.textContent).toContain(money(1_100_000));
    // The bubble already carries the same lines as its own name, so the box is not read twice.
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
    expect(beta).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Beta SA") as unknown as string,
    );
    fireEvent.keyDown(beta, { key: "Escape" });
    expect(container.querySelector("[data-chart-tooltip]")).not.toBeInTheDocument();
  });

  it("names the axes and legend, and passes axe with a bubble focused", async () => {
    const { container } = await renderSegment();
    expect(screen.getByText(b.chart.yAxis)).toBeInTheDocument();
    expect(screen.getByText(b.chart.xAxis)).toBeInTheDocument();
    // Scoped to the chart's own legend: "Your figures" is also the peer table's badge word.
    const legend = container.querySelector('[data-legend="client"]')?.parentElement;
    expect(legend).toHaveTextContent(b.chart.legend.client);
    expect(container.querySelector('[data-legend="peer"]')?.parentElement).toHaveTextContent(
      b.chart.legend.peer,
    );
    expect(container.querySelector("[data-chart-caption]")).toHaveTextContent(b.chart.caption);
    fireEvent.focus(container.querySelector('[data-bubble="client"]') as SVGGElement);
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
