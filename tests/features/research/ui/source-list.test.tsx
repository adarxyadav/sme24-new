import { render, screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { SourceList } from "@/features/research/ui/source-list";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { en } from "./helpers";

/**
 * The run's source list under the table (spec 0007, AC-7): a labelled section, one entry per
 * source with a safe external link, the URL and the retrieval date, and a sentence when the run
 * found none. The server translator and formatter are the boundary.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en-CH", messages: en, namespace: namespace as never, formats }),
  getFormatter: async () => createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE }),
}));

const sources = [
  {
    url: "https://www.example.ch/reports/annual-report",
    title: "Annual report",
    retrievedAt: "2026-09-06T10:00:00.000Z",
  },
  {
    url: "https://www.zefix.ch/en/search/entity/list",
    title: "",
    retrievedAt: "2026-01-02T00:00:00.000Z",
  },
];

describe("SourceList (AC-7)", () => {
  it("lists each source with a link that opens safely in a new tab, the URL and the date", async () => {
    render(await SourceList({ sources }));
    const section = screen.getByRole("region", { name: en.research.sources.heading });
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = within(items[0] as HTMLElement).getByRole("link", { name: "Annual report" });
    expect(first).toHaveAttribute("href", "https://www.example.ch/reports/annual-report");
    expect(first).toHaveAttribute("target", "_blank");
    expect(first).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(items[0] as HTMLElement).getByText("Retrieved 06.09.2026")).toBeInTheDocument();
    expect(
      within(items[0] as HTMLElement).getByTitle("https://www.example.ch/reports/annual-report"),
    ).toBeInTheDocument();
  });

  it("uses the URL as the link text when the title is empty", async () => {
    render(await SourceList({ sources }));
    expect(
      screen.getByRole("link", { name: "https://www.zefix.ch/en/search/entity/list" }),
    ).toBeInTheDocument();
  });

  it("says when the run found no sources", async () => {
    render(await SourceList({ sources: [] }));
    expect(screen.getByText(en.research.sources.none)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
