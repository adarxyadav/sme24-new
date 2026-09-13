import { screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { roundChf } from "@/features/benchmark/model";
import type { SnapshotPeerBlock, SnapshotPeerRow } from "@/features/benchmark/snapshot";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { formats, TIME_ZONE } from "@/i18n/formats";
import {
  catalogue,
  company,
  en,
  enFormat,
  parsedSnapshot,
  readyBlocks,
  renderEnglish,
} from "./helpers";

/**
 * The Peer Standing card (spec 0021, AC-10, AC-12): for a KPI with a peer block the positions
 * row becomes the card with the rank line (the word publish always in it), the gap sentence, the
 * strip with its screen reader sentence, the table with one linked source per row, the client's
 * own row at its rank with no money, the no saving text, and the rung sentence; with rank null
 * the heading has no ordinal and no client row; a `@5` snapshot with an empty block says "No
 * published peer yet"; a `@4` snapshot renders as before; axe passes.
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

const chf = (value: number) => enFormat.number(roundChf(value), "chfWhole").replace(/\s/g, " ");

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
    basis: "employees_and_contractors",
    sourceUrl: `https://example.org/${peerKey}/report`,
    reportUrl: `https://example.org/${peerKey}`,
    verifiedAt: "2026-09-13T00:00:00.000Z",
    savingAtPeer: null,
    ...overrides,
  };
}

/** The spec's example: 4th of 6 European peers on LTIFR, best 0.9, the client at 2.4. */
function ltifrBlock(overrides: Partial<SnapshotPeerBlock> = {}): SnapshotPeerBlock {
  return {
    key: "ltifr",
    geoRung: "europe",
    rank: 4,
    best: "helvetia",
    gapToBest: 1.5,
    certifiedShare: null,
    chart: { peerKeys: ["helvetia", "nordstahl"] },
    rows: [
      row("helvetia", 0.9, { country: "CH", savingAtPeer: 41_000 }),
      row("nordstahl", 1.6, { savingAtPeer: 22_000 }),
      row("lyon", 2.1, {
        country: "FR",
        basis: "employees",
        periodYear: 2023,
        savingAtPeer: 8_000,
        unitAsPublished: "per_200k_hours",
        valueAsPublished: 0.42,
      }),
      row("veneto", 3.1, { country: "IT", savingAtPeer: "already_ahead" }),
      row("ruhr", 4.0, { savingAtPeer: "already_ahead" }),
    ],
    ...overrides,
  };
}

async function renderWith(peers: readonly SnapshotPeerBlock[], modelVersion = "benchmark-model@5") {
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

const ltifrRow = () => document.querySelector('[data-position-kpi="ltifr"]') as HTMLElement;

describe("the Peer Standing card (spec 0021, AC-10)", () => {
  it("replaces the LTIFR row with the rank line, the gap, the strip and the rung sentence", async () => {
    await renderWith([ltifrBlock()]);
    const card = ltifrRow().querySelector('[data-peer-standing="ltifr"]') as HTMLElement;
    expect(card).toHaveAttribute("data-geo-rung", "europe");
    expect(card).toHaveAttribute("data-rank", "4");
    const rankLine = card.querySelector("[data-rank-line]") as HTMLElement;
    expect(rankLine).toHaveTextContent("4th");
    expect(rankLine).toHaveTextContent(
      "of 5 companies in Manufacturing in Europe that publish an LTIFR",
    );
    expect(card.querySelector("[data-gap-line]")).toHaveTextContent(
      "1.50 behind HELVETIA AG, the best published peer",
    );
    // The strip is decorative and the sr-only sentence carries the meaning.
    const strip = card.querySelector('[data-slot="peer-strip"]') as HTMLElement;
    expect(strip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(strip.querySelector("svg")).toHaveAttribute("data-peers", "5");
    expect(strip.querySelector(".sr-only")).toHaveTextContent(
      "Your value 2.40 against 5 published peers in Europe, from 0.90 to 4.00.",
    );
    expect(card.querySelector("[data-rung-sentence]")).toHaveTextContent(
      "Fewer than three companies in Switzerland publish an LTIFR, so the comparison widened to Europe. Published peers are larger companies",
    );
    // Never the forbidden words on the card.
    expect((card.textContent ?? "").toLowerCase()).not.toMatch(/quarter|quartile|median/);
  });

  it("lists every peer with a linked source, its country, basis, year and headcount, and the client row at its rank", async () => {
    await renderWith([ltifrBlock()]);
    const table = ltifrRow().querySelector("[data-peer-table]") as HTMLTableElement;
    const peerRows = table.querySelectorAll("[data-peer-row]");
    expect(peerRows).toHaveLength(5);
    for (const peerRow of peerRows) {
      const link = peerRow.querySelector("a") as HTMLAnchorElement;
      expect(link.href).toMatch(/^https:\/\/example\.org\/.+\/report$/);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    const lyon = table.querySelector('[data-peer-row="lyon"]') as HTMLElement;
    expect(lyon).toHaveTextContent("FR");
    expect(lyon).toHaveTextContent("employees only");
    expect(lyon).toHaveTextContent("2023");
    // The en-CH group separator is the apostrophe, so the digits are matched loosely.
    expect(lyon).toHaveTextContent(/9.800 employees, 2024/);
    // A per 200 000 hours figure shows the converted value with the published one in a tooltip (AC-13).
    expect(lyon.querySelector("[data-value]")).toHaveAttribute(
      "title",
      "0.42 per 200 000 hours as published",
    );
    // The client's own row sits fourth, with no money.
    const rows = table.querySelectorAll("tbody tr");
    expect(rows[3]).toHaveAttribute("data-client-row");
    expect(rows[3]).toHaveTextContent("you");
    expect(rows[3]).toHaveTextContent("2.40");
    expect(rows[3]?.textContent).not.toMatch(/CHF/);
    // The saving column: the client's own saving at each peer it is behind, already ahead otherwise.
    expect(
      within(table.querySelector('[data-peer-row="helvetia"]') as HTMLElement).getByText(
        chf(41_000),
      ),
    ).toBeInTheDocument();
    expect(table.querySelector('[data-peer-row="veneto"] [data-saving]')).toHaveTextContent(
      "already ahead",
    );
  });

  it("shows one no saving text for every null saving", async () => {
    const block = ltifrBlock({
      rows: ltifrBlock().rows.map((entry) => ({ ...entry, savingAtPeer: null })),
    });
    await renderWith([block]);
    const savings = ltifrRow().querySelectorAll("[data-saving]");
    expect(savings).toHaveLength(5);
    for (const cell of savings) expect(cell).toHaveTextContent("not priced");
  });

  it("has no ordinal, no gap sentence and no client row when the rank is null", async () => {
    const blocks = readyBlocks({
      inputs: {
        ...readyBlocks().inputs,
        country: "CH",
        kpis: readyBlocks().inputs.kpis.filter((entry) => entry.key !== "ltifr"),
      },
      peers: [ltifrBlock({ rank: null, gapToBest: null })],
    });
    const element = await BenchmarkSegment({
      snapshot: parsedSnapshot({ modelVersion: "benchmark-model@5", blocks }),
      state: "ready",
      catalogue,
      company,
      locale: "en",
    });
    renderEnglish(element);
    const card = ltifrRow().querySelector('[data-peer-standing="ltifr"]') as HTMLElement;
    expect(card).toHaveAttribute("data-rank", "");
    expect(card.querySelector("[data-rank-line]")).toHaveTextContent(
      "5 companies in Manufacturing in Europe publish an LTIFR",
    );
    expect(card.querySelector("[data-rank-line]")?.textContent).not.toMatch(/\dth|\dst|\dnd|\drd/);
    expect(card.querySelector("[data-gap-line]")).toBeNull();
    expect(card.querySelector("[data-client-row]")).toBeNull();
    expect(card.querySelector('[data-slot="peer-strip"] .sr-only')).toHaveTextContent(
      "you have no value yet",
    );
  });

  it("names the country rung with the client's country and the ISO share without a rank", async () => {
    const iso: SnapshotPeerBlock = {
      key: "iso_45001_certified",
      geoRung: "country",
      rank: null,
      best: null,
      gapToBest: null,
      certifiedShare: 3 / 5,
      chart: { peerKeys: [] },
      rows: ltifrBlock().rows.map((entry, index) => ({
        ...entry,
        value: index < 3 ? 1 : 0,
        valueAsPublished: index < 3 ? 1 : 0,
        unitAsPublished: "boolean" as const,
        savingAtPeer: null,
      })),
    };
    await renderWith([ltifrBlock({ geoRung: "country" }), iso]);
    expect(ltifrRow().querySelector("[data-rank-line]")).toHaveTextContent(
      "in Manufacturing in Switzerland that publish",
    );
    expect(ltifrRow().querySelector("[data-rung-sentence]")).toHaveTextContent(
      "All published peers are from Switzerland.",
    );
    const isoCard = document.querySelector(
      '[data-peer-standing="iso_45001_certified"]',
    ) as HTMLElement;
    expect(isoCard.querySelector("[data-iso-share]")).toHaveTextContent(
      "3 of 5 published peers in your industry are certified. You are certified.",
    );
    expect(isoCard.querySelector("[data-rank-line]")).toBeNull();
    expect(isoCard.querySelectorAll("[data-saving]")).toHaveLength(0);
  });

  it("passes axe on the card", async () => {
    const { container } = await renderWith([ltifrBlock()]);
    const results = await axe.run(container, {
      rules: { region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe("fewer than three and older rows (spec 0021, AC-12, AC-9)", () => {
  it("keeps today's row and adds the no published peer text on a @5 snapshot without a block", async () => {
    const blocks = readyBlocks({
      inputs: { ...readyBlocks().inputs, country: "CH" },
      results: readyBlocks().results.map((entry) =>
        entry.key === "ltifr" ? { ...entry, peer: null, position: null } : entry,
      ),
      peers: [],
    });
    renderEnglish(
      await BenchmarkSegment({
        snapshot: parsedSnapshot({ modelVersion: "benchmark-model@5", blocks }),
        state: "ready",
        catalogue,
        company,
        locale: "en",
      }),
    );
    const ltifr = ltifrRow();
    expect(ltifr.querySelector("[data-peer-standing]")).toBeNull();
    expect(ltifr).toHaveTextContent(en.benchmark.positions.noPeer);
    expect(ltifr.querySelector("[data-no-published-peer]")).toHaveTextContent(
      "No published peer yet",
    );
    // A KPI outside the four never gets the text.
    expect(
      document.querySelector('[data-position-kpi="near_miss_rate"] [data-no-published-peer]'),
    ).toBeNull();
  });

  it("renders a @4 snapshot as before, with neither the card nor the no published peer text", async () => {
    await renderWith([], "benchmark-model@4");
    const ltifr = ltifrRow();
    expect(ltifr.querySelector("[data-peer-standing]")).toBeNull();
    expect(document.querySelector("[data-no-published-peer]")).toBeNull();
    expect(screen.getAllByText(en.benchmark.positions.noPeer).length).toBeGreaterThan(0);
  });
});
