// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyRow,
  companyKey,
  formatReport,
  type ImportStore,
  type RawRow,
  readWorkbook,
  runImport,
} from "../../scripts/directory-import.mts";
import { IMPORT_COLUMNS, IMPORT_SHEETS } from "../../src/features/directory/catalogue.ts";
import type { ImportPolicy } from "../../src/features/directory/import-policy.ts";
import { emailHash } from "../../src/features/directory/normalise.ts";

/**
 * The import script (spec 0018, AC-2, AC-3) driven against a small invented workbook written to
 * a temp dir: the header check, the five skip reasons, the batched writes through a fake store,
 * the dry run, and the report that carries counts only.
 */

const HEADERS = Object.values(IMPORT_COLUMNS);

const POLICY: ImportPolicy = {
  status: "awaiting_lawyer",
  excludedCountries: ["RU"],
  loadRowsWithoutCountry: false,
  licenceNote: "",
};

/** Invented rows, in the workbook's column order. */
const ROWS: readonly (string | null)[][] = [
  [
    "Alpha Werke AG",
    "Anna",
    "Muster",
    "Head of EHS",
    "Anna.Muster@alpha.test",
    "+41 41 123 45 67",
    null,
    "Bahnhofstrasse 1",
    "Baar",
    "ZG",
    "6340",
    "Switzerland",
  ],
  [
    "Alpha Werke AG",
    "Beat",
    "Beispiel",
    "Safety Manager",
    "beat@alpha.test",
    null,
    "079 123 45 67",
    null,
    "Baar",
    null,
    null,
    "Schweiz",
  ],
  [
    "Beta Industries",
    "Carla",
    "Probe",
    "Operations Director",
    "carla@beta.test",
    null,
    null,
    null,
    "Köln",
    null,
    null,
    "Germany",
  ],
  [
    "Gamma Logistics",
    "Dora",
    "Test",
    "EHS Coordinator",
    "not an email",
    null,
    null,
    null,
    null,
    null,
    null,
    "Austria",
  ],
  [
    "Delta Corp",
    "Emil",
    "Fiktiv",
    "Plant Manager",
    "emil@delta.test",
    null,
    null,
    null,
    null,
    null,
    null,
    "Russia",
  ],
  [
    "Epsilon Ltd",
    "Fritz",
    "Erfunden",
    "HSE Lead",
    "fritz@epsilon.test",
    null,
    null,
    null,
    null,
    null,
    null,
    "Atlantis",
  ],
  [
    "Zeta SA",
    "Greta",
    "Beispiel",
    "QHSE",
    "greta@zeta.test",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  [
    "Alpha Werke AG",
    "Gone",
    "Person",
    "Former",
    "gone@alpha.test",
    null,
    null,
    null,
    null,
    null,
    null,
    "Switzerland",
  ],
  [
    "Alpha Werke AG",
    "Anna",
    "Muster",
    "Head of EHS (dup)",
    "anna.muster@alpha.test",
    null,
    null,
    null,
    null,
    null,
    null,
    "Switzerland",
  ],
];

async function writeWorkbook(
  dir: string,
  name: string,
  headers: readonly string[],
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet(IMPORT_SHEETS.summary);
  summary.addRow(["Total contacts", ROWS.length]);
  summary.addRow(["Source", "20260902 Invented Account List"]);
  const contacts = workbook.addWorksheet(IMPORT_SHEETS.contacts);
  contacts.addRow([...headers]);
  for (const row of ROWS) contacts.addRow(row.map((cell) => cell ?? undefined));
  const path = join(dir, name);
  await workbook.xlsx.writeFile(path);
  return path;
}

/** A store that records what it was asked to write. */
function fakeStore(suppressed: readonly string[] = []) {
  const companies = new Map<string, string>();
  const contacts = new Map<string, unknown>();
  const imports: unknown[] = [];
  const calls = { ensureCompanies: 0, upsertContacts: 0 };
  const store: ImportStore = {
    async suppressedHashes(hashes) {
      return new Set(hashes.filter((hash) => suppressed.includes(hash)));
    },
    async ensureCompanies(drafts) {
      calls.ensureCompanies += 1;
      const ids = new Map<string, string>();
      for (const draft of drafts) {
        const key = companyKey(draft);
        if (!companies.has(key)) companies.set(key, `company-${companies.size + 1}`);
        ids.set(key, companies.get(key) as string);
      }
      return ids;
    },
    async upsertContacts(rows) {
      calls.upsertContacts += 1;
      let updated = 0;
      for (const row of rows) {
        if (contacts.has(row.email)) updated += 1;
        contacts.set(row.email, row);
      }
      return { loaded: rows.length - updated, updated };
    },
    async recordImport(row) {
      imports.push(row);
    },
  };
  return { store, companies, contacts, imports, calls };
}

let dir: string;
let workbookPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sme24-directory-import-"));
  workbookPath = await writeWorkbook(dir, "invented.xlsx", HEADERS);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readWorkbook", () => {
  it("maps the twelve columns by header and reads the Source cell", async () => {
    const workbook = await readWorkbook(workbookPath);
    expect(workbook.fileName).toBe("invented.xlsx");
    expect(workbook.sourceBatch).toBe("20260902 Invented Account List");
    expect(workbook.rows.length).toBe(ROWS.length);
    expect(workbook.rows[0]).toEqual({
      company: "Alpha Werke AG",
      firstName: "Anna",
      lastName: "Muster",
      title: "Head of EHS",
      email: "Anna.Muster@alpha.test",
      phone: "+41 41 123 45 67",
      mobile: null,
      street: "Bahnhofstrasse 1",
      city: "Baar",
      state: "ZG",
      postalCode: "6340",
      country: "Switzerland",
    });
  });

  it("refuses a workbook missing a column, naming it", async () => {
    const path = await writeWorkbook(
      dir,
      "missing.xlsx",
      HEADERS.filter((header) => header !== IMPORT_COLUMNS.mobile),
    );
    await expect(readWorkbook(path)).rejects.toThrow(/missing the column\(s\): Mobile/);
  });
});

describe("classifyRow", () => {
  const base: RawRow = {
    company: "Alpha Werke AG",
    firstName: "Anna",
    lastName: "Muster",
    title: null,
    email: "Anna@alpha.test",
    phone: null,
    mobile: null,
    street: null,
    city: null,
    state: null,
    postalCode: null,
    country: "Switzerland",
  };

  it("loads a valid row with the email lowercased and the country mapped", () => {
    const result = classifyRow(base, POLICY, new Set());
    expect(result.outcome).toBe("load");
    if (result.outcome !== "load") return;
    expect(result.contact.email).toBe("anna@alpha.test");
    expect(result.contact.country).toBe("CH");
    expect(result.contact.company.nameNormalised).toBe("alpha werke ag");
    expect(result.contact.emailHash).toBe(emailHash("anna@alpha.test"));
  });

  it("skips an invalid email, a missing email and a missing company", () => {
    expect(classifyRow({ ...base, email: "nope" }, POLICY, new Set()).outcome).toBe("invalid");
    expect(classifyRow({ ...base, email: null }, POLICY, new Set()).outcome).toBe("invalid");
    expect(classifyRow({ ...base, company: null }, POLICY, new Set()).outcome).toBe("invalid");
  });

  it("skips an excluded country, reports an unmapped one, and skips a missing one by policy", () => {
    expect(classifyRow({ ...base, country: "Russia" }, POLICY, new Set()).outcome).toBe(
      "country_excluded",
    );
    expect(classifyRow({ ...base, country: "Atlantis" }, POLICY, new Set())).toEqual({
      outcome: "country_unmapped",
      spelling: "Atlantis",
    });
    expect(classifyRow({ ...base, country: null }, POLICY, new Set()).outcome).toBe("no_country");
    expect(
      classifyRow(
        { ...base, country: null },
        { ...POLICY, loadRowsWithoutCountry: true },
        new Set(),
      ).outcome,
    ).toBe("load");
  });

  it("skips a suppressed hash", () => {
    const suppressed = new Set([emailHash("anna@alpha.test")]);
    expect(classifyRow(base, POLICY, suppressed).outcome).toBe("suppressed");
  });
});

describe("runImport", () => {
  it("counts every outcome, writes in batches and records the run", async () => {
    const { rows } = await readWorkbook(workbookPath);
    const fake = fakeStore([emailHash("gone@alpha.test")]);
    const counts = await runImport(fake.store, rows, {
      policy: POLICY,
      dryRun: false,
      sourceBatch: "test",
      fileName: "invented.xlsx",
      batchSize: 4,
    });
    expect(counts).toEqual({
      rowsRead: 9,
      rowsLoaded: 3,
      rowsUpdated: 1,
      rowsSkippedInvalid: 1,
      rowsSkippedCountry: 2,
      rowsSkippedNoCountry: 1,
      rowsSkippedSuppressed: 1,
      countries: { CH: 3, DE: 1 },
      unmappedCountries: { Atlantis: 1 },
    });
    // Two companies: Alpha (CH) and Beta (DE); the second Alpha row reuses the first's id.
    expect(fake.companies.size).toBe(2);
    expect(fake.contacts.size).toBe(3);
    expect(fake.calls.upsertContacts).toBe(2);
    expect(fake.imports.length).toBe(1);
    expect(fake.imports[0]).toMatchObject({
      source_batch: "test",
      file_name: "invented.xlsx",
      rows_read: 9,
      rows_loaded: 3,
      rows_updated: 1,
      dry_run: false,
      excluded_countries: ["RU"],
      countries: { CH: 3, DE: 1 },
    });
  });

  it("writes no company and no contact on a dry run, but still records the run", async () => {
    const { rows } = await readWorkbook(workbookPath);
    const fake = fakeStore();
    const counts = await runImport(fake.store, rows, {
      policy: POLICY,
      dryRun: true,
      sourceBatch: "test",
      fileName: "invented.xlsx",
    });
    expect(counts.rowsLoaded).toBe(4);
    expect(fake.calls.ensureCompanies).toBe(0);
    expect(fake.calls.upsertContacts).toBe(0);
    expect(fake.contacts.size).toBe(0);
    expect(fake.imports[0]).toMatchObject({ dry_run: true, rows_loaded: 4 });
  });
});

describe("formatReport", () => {
  it("prints counts and unmapped spellings, never an address, a name or a company", async () => {
    const { rows } = await readWorkbook(workbookPath);
    const fake = fakeStore();
    const counts = await runImport(fake.store, rows, {
      policy: POLICY,
      dryRun: true,
      sourceBatch: "test",
      fileName: "invented.xlsx",
    });
    const report = formatReport(
      { ...counts, unmappedCountries: { Atlantis: 1, "623-932 7000": 2 } },
      true,
    );
    expect(report).toContain("rows read:               9");
    expect(report).toContain('"Atlantis": 1');
    expect(report).toContain("(2 row(s) whose country cell holds digits, not shown)");
    expect(report).not.toContain("623-932");
    expect(report).not.toContain("@");
    expect(report).not.toMatch(/Alpha|Muster|Anna/);
  });
});
