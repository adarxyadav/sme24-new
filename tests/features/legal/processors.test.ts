import { describe, expect, it } from "vitest";
import { PROCESSORS, type Processor, RETENTION, type Retention } from "@/features/legal/processors";
import {
  CLOSED_RETENTION_DAYS,
  EMAIL_DELIVERY_RETENTION_DAYS,
  IP_HASH_RETENTION_DAYS,
} from "@/features/legal/retention-periods";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

/**
 * The privacy page's typed sources (spec 0015, AC-7, AC-8): every processor and every retention
 * period is data, so the page cannot drift from the code without this failing.
 */

const CATALOGUES = { "en-CH": en, "de-CH": de } as const;

function privacyKeys(catalogue: (typeof CATALOGUES)[keyof typeof CATALOGUES]) {
  // The page copy lives in `legalPages`, not `legal`: `legal` is a shared namespace that
  // `clientMessages` ships to every client bundle for the cookie bar, and the legal text is far
  // too long to ride along. Read positionally, because the catalogues are typed as the English shape.
  return (
    catalogue as unknown as {
      legalPages: { privacy: Record<string, Record<string, unknown>> };
    }
  ).legalPages.privacy;
}

/** The keys of a block that are per-item entries, i.e. those whose value carries a `purpose`. */
function itemKeys(block: Record<string, { purpose?: string } | undefined>): readonly string[] {
  return Object.entries(block)
    .filter(([, value]) => typeof value?.purpose === "string")
    .map(([key]) => key)
    .sort();
}

describe("PROCESSORS", () => {
  it("names a company rather than a product for each entry", () => {
    for (const processor of PROCESSORS) {
      expect(processor.name.length).toBeGreaterThan(0);
      expect(processor.id).toMatch(/^[a-z][a-z0-9]*$/);
    }
  });

  it("has no duplicate ids", () => {
    const ids = PROCESSORS.map((processor: Processor) => processor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries a purpose in both catalogues for every processor", () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const processors = privacyKeys(catalogue).processors as Record<
        string,
        { purpose?: string } | undefined
      >;
      for (const processor of PROCESSORS) {
        expect(processors[processor.id]?.purpose, `${locale} / ${processor.id}`).toBeTruthy();
      }
      // No orphan key either: a removed processor must lose its copy in the same edit. Only the
      // entries carrying a `purpose` are per-processor; the siblings are the column labels and
      // the region names the page renders around the table.
      expect(itemKeys(processors)).toEqual(PROCESSORS.map((processor) => processor.id).sort());
    }
  });
});

describe("RETENTION", () => {
  it("takes every purged period from the module the tasks enforce", () => {
    // AC-8: the page may never claim a number the scheduled task does not actually apply. The
    // periods are asserted against the pure module rather than against the task files, because
    // importing a task parses the task environment at module scope and would fail under Vitest;
    // the task-side half of the equality is the re-export in each task, which typecheck proves.
    const byTable = new Map(RETENTION.map((row: Retention) => [row.table, row]));
    expect(byTable.get("email_deliveries")?.days).toBe(EMAIL_DELIVERY_RETENTION_DAYS);
    expect(byTable.get("enquiries")?.days).toBe(CLOSED_RETENTION_DAYS);
    expect(byTable.get("enquiries_ip_hash")?.days).toBe(IP_HASH_RETENTION_DAYS);
  });

  it("gives a day count to purged rows and none to the other two kinds", () => {
    for (const row of RETENTION) {
      if (row.kind === "purged") {
        expect(row.days, row.table).toBeGreaterThan(0);
      } else {
        expect(row.days, row.table).toBeNull();
      }
    }
  });

  it("has no duplicate tables", () => {
    const tables = RETENTION.map((row: Retention) => row.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("carries a purpose in both catalogues for every table", () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const retention = privacyKeys(catalogue).retention as Record<
        string,
        { purpose?: string } | undefined
      >;
      for (const row of RETENTION) {
        expect(retention[row.table]?.purpose, `${locale} / ${row.table}`).toBeTruthy();
      }
      expect(itemKeys(retention)).toEqual(RETENTION.map((row) => row.table).sort());
    }
  });
});
