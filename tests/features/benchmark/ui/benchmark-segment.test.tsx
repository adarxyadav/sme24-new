import { screen } from "@testing-library/react";
import axe from "axe-core";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { company, en, parsedSnapshot, renderEnglish } from "./helpers";

/**
 * The benchmark segment as `benchmark-model@7` leaves it (spec 0022, module 5 of the build plan):
 * the waiting states, the `outdated` sentence for a snapshot of a version this code no longer reads
 * (AC-18), the `noData` alert with the figures slot, and the facts card. The four `ready` sections —
 * the peer table, the estimated loss, the expert cards and the package — arrive with module 6 and
 * bring their own assertions. The server translator and formatter, the server action and the router
 * are the boundaries.
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

const b = en.benchmark;

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
