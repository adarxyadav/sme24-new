import { fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { ChartPoint, SnapshotPeerBlock, SnapshotPeerRow } from "@/features/benchmark/snapshot";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { bubbleRadius, chartDomain } from "@/features/benchmark/ui/chart-scale";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { catalogue, company, en, parsedSnapshot, readyBlocks, renderEnglish } from "./helpers";

/**
 * The peer bubble chart (spec 0021, AC-19 to AC-22): a `@6` block with the client's point and
 * four peer points draws five focusable bubbles, each with a tooltip on focus and on hover, a
 * quotient row's tooltip carries both printed numbers and the note, the `sr-only` table has one
 * row per bubble with the note as a column, the sector line sits at the lost days sector value;
 * the hide sentence shows for each of the three empty cases and for a stored `@5` row; the peer
 * table's quotient tooltip shows both numbers; axe passes.
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
}));

function row(
  peerKey: string,
  value: number,
  overrides: Partial<SnapshotPeerRow> = {},
): SnapshotPeerRow {
  return {
    peerKey,
    name: `${peerKey.toUpperCase()} AG`,
    country: "DE",
    headcount: 9800,
    headcountYear: 2024,
    periodYear: 2024,
    value,
    valueAsPublished: value,
    unitAsPublished: "per_million_hours",
    basis: "employees",
    sourceUrl: `https://example.org/${peerKey}/report`,
    reportUrl: `https://example.org/${peerKey}`,
    verifiedAt: "2026-09-13T00:00:00.000Z",
    denominatorAsPublished: null,
    note: null,
    savingAtPeer: null,
    ...overrides,
  };
}

function point(
  peerKey: string,
  ltifr: number,
  lostDays: number,
  overrides: Partial<ChartPoint> & {
    readonly lostDaysOverrides?: Partial<ChartPoint["lostDays"]>;
  } = {},
): ChartPoint {
  const { lostDaysOverrides, ...rest } = overrides;
  return {
    peerKey,
    name: `${peerKey.toUpperCase()} AG`,
    country: "DE",
    headcount: 9800,
    ltifr,
    lostDays: {
      value: lostDays,
      valueAsPublished: lostDays,
      denominatorAsPublished: null,
      unitAsPublished: "days",
      periodYear: 2024,
      basis: "employees",
      sourceUrl: `https://example.org/${peerKey}/report`,
      note: null,
      ...lostDaysOverrides,
    },
    ...rest,
  };
}

/** The spec's chart fixture: the client at 2.4 and 12.5 with 420 FTE, four peers, Vinci's row a quotient with its note. */
const POINTS: ChartPoint[] = [
  point("helvetia", 0.9, 9.8, { country: "CH", headcount: 1800 }),
  point("nordstahl", 1.6, 20.5, {
    lostDaysOverrides: {
      valueAsPublished: 2275,
      denominatorAsPublished: 111,
      unitAsPublished: "days_over_lost_time_accidents",
    },
  }),
  point("lyon", 2.1, 15.3, { country: "FR", headcount: 2300 }),
  point("vinci", 4.0, 71.2, {
    country: "FR",
    headcount: 284_526,
    lostDaysOverrides: {
      valueAsPublished: 204_991,
      denominatorAsPublished: 2879,
      unitAsPublished: "days_over_lost_time_accidents",
      note: { de: "365 Tage je tödlichen Unfall", en: "365 days charged per fatal accident" },
    },
  }),
];

function ltifrBlock(chart: Partial<SnapshotPeerBlock["chart"]> = {}): SnapshotPeerBlock {
  return {
    key: "ltifr",
    geoRung: "europe",
    rank: 4,
    best: "helvetia",
    gapToBest: 1.5,
    certifiedShare: null,
    chart: {
      client: { ltifr: 2.4, lostDays: 12.5, headcount: 420 },
      points: POINTS,
      ...chart,
    },
    rows: [
      row("helvetia", 0.9, { country: "CH", headcount: 1800 }),
      row("nordstahl", 1.6),
      row("lyon", 2.1, { country: "FR", headcount: 2300 }),
      row("vinci", 4.0, { country: "FR", headcount: 284_526 }),
    ],
  };
}

async function renderWith(peers: readonly SnapshotPeerBlock[], modelVersion = "benchmark-model@6") {
  const blocks = readyBlocks({
    inputs: { ...readyBlocks().inputs, country: "CH" },
    peers,
  });
  const element = await BenchmarkSegment({
    snapshot: parsedSnapshot({ modelVersion, blocks }),
    state: "ready",
    catalogue,
    company,
    locale: "en",
  });
  return renderEnglish(element);
}

const chart = () => document.querySelector('[data-peer-chart="drawn"]') as HTMLElement;
const hidden = () => document.querySelector('[data-peer-chart="hidden"]');

describe("the chart scale (spec 0021, AC-22)", () => {
  it("widens the domain by 8 percent of the span on each side and floors the bubble radius", () => {
    expect(chartDomain([0.9, 4.0])).toEqual([0.9 - 0.31 * 0.8, 4.0 + 0.31 * 0.8]);
    expect(chartDomain([2.4])).toEqual([2.4 - 0.08, 2.4 + 0.08]);
    // Area, not radius: a quarter of the headcount is half the radius, and nothing sits under the floor.
    expect(bubbleRadius(10_000, 10_000)).toBe(26);
    expect(bubbleRadius(2_500, 10_000)).toBe(13);
    expect(bubbleRadius(300, 284_526)).toBe(7);
    expect(bubbleRadius(null, 10_000)).toBe(7);
  });
});

describe("the peer bubble chart (spec 0021, AC-21, AC-22)", () => {
  it("draws the client and every point as a focusable bubble under the positions, with the sector line", async () => {
    await renderWith([ltifrBlock()]);
    expect(hidden()).toBeNull();
    const drawn = chart();
    expect(drawn).toHaveAttribute("data-points", "5");
    const svg = drawn.querySelector("svg") as SVGSVGElement;
    // A group, not an image: an image's children are presentational and axe refuses focusable
    // ones inside it, so the label sits on a group and the bubbles stay reachable.
    expect(svg).toHaveAttribute("role", "group");
    expect(svg).toHaveAttribute(
      "aria-label",
      "Bubble chart of LTIFR against days lost per incident: your company and 4 published peers, bubble size by headcount.",
    );
    const bubbles = drawn.querySelectorAll("[data-bubble]");
    expect(bubbles).toHaveLength(5);
    for (const bubble of bubbles) {
      expect(bubble).toHaveAttribute("tabindex", "0");
      expect(bubble).toHaveAttribute("role", "button");
    }
    expect(drawn.querySelector("[data-bubble][data-client]")).toHaveAttribute(
      "data-bubble",
      "client",
    );
    // The sector line is the lost days sector value of `results[]` (the fixture's 10).
    expect(drawn.querySelector("[data-sector-line]")).toHaveAttribute("data-sector-line", "10");
    expect(drawn.querySelector("[data-sector-line] text")).toHaveTextContent(
      "Sector median 10.00 days",
    );
    // The chart heads its own section under the positions list.
    expect(document.querySelector("#peer-chart-heading")).toHaveTextContent(
      "Where you sit among the published peers",
    );
  });

  it("shows the tooltip on focus and on hover, with both printed numbers and the note on a quotient row (AC-21)", async () => {
    await renderWith([ltifrBlock()]);
    const drawn = chart();
    expect(drawn.querySelector("[data-chart-tooltip]")).toBeNull();
    const vinci = drawn.querySelector('[data-bubble="vinci"]') as SVGGElement;
    fireEvent.focus(vinci);
    const tooltip = drawn.querySelector('[data-chart-tooltip="vinci"]') as HTMLElement;
    expect(tooltip).toHaveAttribute("role", "tooltip");
    expect(tooltip).toHaveTextContent("VINCI AG");
    // The en-CH group separator is the apostrophe, so digits are matched loosely.
    expect(tooltip).toHaveTextContent(/France, 284.526 employees/);
    expect(tooltip).toHaveTextContent("LTIFR 4.00");
    expect(tooltip).toHaveTextContent("71.20 days lost per incident, 2024");
    expect(tooltip).toHaveTextContent(
      /204.991 days lost over 2.879 lost time accidents, as published/,
    );
    expect(tooltip).toHaveTextContent("365 days charged per fatal accident");
    // The focused bubble carries a visible ring, and the same text as its accessible name.
    expect(vinci.querySelector("[data-focus-ring]")).not.toBeNull();
    expect(vinci.getAttribute("aria-label")).toMatch(
      /^VINCI AG\. France, 284.526 employees\. LTIFR 4\.00\./,
    );
    expect(vinci.getAttribute("aria-label")).toContain("365 days charged per fatal accident");
    fireEvent.blur(vinci);
    expect(drawn.querySelector("[data-chart-tooltip]")).toBeNull();
    // Hover works the same way; the quotient row without a note shows the pair and no note line.
    const nordstahl = drawn.querySelector('[data-bubble="nordstahl"]') as SVGGElement;
    fireEvent.pointerEnter(nordstahl);
    const hover = drawn.querySelector('[data-chart-tooltip="nordstahl"]') as HTMLElement;
    expect(hover).toHaveTextContent(/2.275 days lost over 111 lost time accidents, as published/);
    expect(hover).not.toHaveTextContent("fatal");
    fireEvent.pointerLeave(nordstahl);
    expect(drawn.querySelector("[data-chart-tooltip]")).toBeNull();
    // Escape closes a tooltip opened by focus; Enter opens it again.
    fireEvent.focus(nordstahl);
    fireEvent.keyDown(nordstahl, { key: "Escape" });
    expect(drawn.querySelector("[data-chart-tooltip]")).toBeNull();
    fireEvent.keyDown(nordstahl, { key: "Enter" });
    expect(drawn.querySelector('[data-chart-tooltip="nordstahl"]')).not.toBeNull();
    // The client's tooltip names the country and the FTE and shows no year.
    const client = drawn.querySelector('[data-bubble="client"]') as SVGGElement;
    fireEvent.focus(client);
    const yours = drawn.querySelector('[data-chart-tooltip="client"]') as HTMLElement;
    expect(yours).toHaveTextContent("Your company");
    expect(yours).toHaveTextContent("Switzerland, 420 employees");
    expect(yours).toHaveTextContent("12.50 days lost per incident");
    expect(yours).not.toHaveTextContent("2024");
  });

  it("carries a screen reader table with one row per bubble and the note as a column", async () => {
    await renderWith([ltifrBlock()]);
    const table = chart().querySelector("[data-chart-table]") as HTMLTableElement;
    expect(table).toHaveClass("sr-only");
    expect(table.querySelector("caption")).toHaveTextContent(
      "The chart's figures: LTIFR, days lost per incident and headcount per company",
    );
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveAttribute("data-chart-row", "client");
    expect(rows[0]).toHaveTextContent("Your company");
    const vinci = table.querySelector('[data-chart-row="vinci"]') as HTMLElement;
    const cells = [...vinci.querySelectorAll("th, td")].map((cell) => cell.textContent);
    expect(cells[0]).toBe("VINCI AG");
    expect(cells[1]).toBe("FR");
    expect(cells[2]).toMatch(/^284.526$/);
    expect(cells[3]).toBe("4.00");
    expect(cells[4]).toMatch(
      /^71\.20 \(204.991 days lost over 2.879 lost time accidents, as published\)$/,
    );
    expect(cells[5]).toBe("365 days charged per fatal accident");
    const helvetia = table.querySelector('[data-chart-row="helvetia"]') as HTMLElement;
    expect(helvetia.querySelectorAll("td")[3]).toHaveTextContent(/^9\.80$/);
    expect(helvetia.querySelectorAll("td")[4]).toHaveTextContent(/^$/);
  });

  it("draws the client at the floor area without an FTE, and with one or two points", async () => {
    await renderWith([
      ltifrBlock({
        client: { ltifr: 2.4, lostDays: 12.5, headcount: null },
        points: POINTS.slice(0, 1),
      }),
    ]);
    const drawn = chart();
    expect(drawn).toHaveAttribute("data-points", "2");
    const client = drawn.querySelector(
      '[data-bubble="client"] circle:last-of-type',
    ) as SVGCircleElement;
    expect(client).toHaveAttribute("r", "7");
    fireEvent.focus(drawn.querySelector('[data-bubble="client"]') as SVGGElement);
    expect(drawn.querySelector('[data-chart-tooltip="client"]')).toHaveTextContent(
      "Switzerland, headcount not given",
    );
  });

  it("shows the hide sentence without an LTIFR block, without the client's point, without a peer point, and on a stored @5 row", async () => {
    const sentence =
      "The bubble chart needs your LTIFR and your days lost per incident, and at least one published peer that reports both. It appears once those figures are in.";
    await renderWith([]);
    expect(hidden()).toHaveTextContent(sentence);
    expect(document.querySelector('[data-peer-chart="drawn"]')).toBeNull();
    document.body.innerHTML = "";
    await renderWith([ltifrBlock({ client: null })]);
    expect(hidden()).toHaveTextContent(sentence);
    document.body.innerHTML = "";
    await renderWith([ltifrBlock({ points: [] })]);
    expect(hidden()).toHaveTextContent(sentence);
    document.body.innerHTML = "";
    // A stored @5 row: the reader normalises its chart to an empty one, so the card shows and the
    // chart hides until the recompute (AC-20).
    await renderWith([ltifrBlock({ client: null, points: [] })], "benchmark-model@5");
    expect(document.querySelector('[data-peer-standing="ltifr"]')).not.toBeNull();
    expect(hidden()).toHaveTextContent(sentence);
  });

  it("shows both printed numbers and the note in the peer table's tooltip of a quotient row (AC-21)", async () => {
    const lostDaysBlock: SnapshotPeerBlock = {
      key: "lost_days_per_incident",
      geoRung: "europe",
      rank: 1,
      best: "helvetia",
      gapToBest: 2.7,
      certifiedShare: null,
      chart: { client: null, points: [] },
      rows: [
        row("helvetia", 9.8, { unitAsPublished: "days" }),
        row("nordstahl", 20.5, {
          valueAsPublished: 2275,
          denominatorAsPublished: 111,
          unitAsPublished: "days_over_lost_time_accidents",
        }),
        row("vinci", 71.2, {
          valueAsPublished: 204_991,
          denominatorAsPublished: 2879,
          unitAsPublished: "days_over_lost_time_accidents",
          note: { de: "365 Tage je tödlichen Unfall", en: "365 days charged per fatal accident" },
        }),
      ],
    };
    await renderWith([lostDaysBlock]);
    const table = document.querySelector(
      '[data-position-kpi="lost_days_per_incident"] [data-peer-table]',
    ) as HTMLElement;
    expect(table.querySelector('[data-peer-row="helvetia"] [data-value]')).not.toHaveAttribute(
      "title",
    );
    expect(
      table.querySelector('[data-peer-row="nordstahl"] [data-value]')?.getAttribute("title"),
    ).toMatch(/^2.275 days lost over 111 lost time accidents, as published$/);
    expect(
      table.querySelector('[data-peer-row="vinci"] [data-value]')?.getAttribute("title"),
    ).toMatch(
      /^204.991 days lost over 2.879 lost time accidents, as published\n365 days charged per fatal accident$/,
    );
  });

  it("passes axe with a bubble focused", async () => {
    const { container } = await renderWith([ltifrBlock()]);
    fireEvent.focus(chart().querySelector('[data-bubble="vinci"]') as SVGGElement);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
