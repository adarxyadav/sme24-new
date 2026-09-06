import { z } from "zod";
import { KPI_KEYS } from "../research/catalogue.ts";
import { ASSUMPTION_KEYS, SIZE_BANDS } from "./catalogue.ts";

/**
 * The seed CSV contracts (spec 0008, AC-2): the shape of one row of
 * supabase/seed-data/benchmarks.csv and benchmark-assumptions.csv, plus the two file level
 * rules (every assumption key exactly once, multipliers in order). `pnpm benchmarks:migration`
 * and a Vitest test parse the committed files with these. Pure.
 */

const csvNumber = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: `not a number: ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

const csvOptionalInteger = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      ctx.addIssue({ code: "custom", message: `not a whole number: ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

const csvBoolean = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "true") return true;
    if (value === "false") return false;
    ctx.addIssue({ code: "custom", message: `expected true or false: ${value}` });
    return z.NEVER;
  });

const csvOptionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

export const benchmarkRowSchema = z
  .object({
    kpi_key: z.enum(KPI_KEYS),
    industry_section: z
      .string()
      .trim()
      .regex(/^(?:[A-U]|ALL)$/),
    size_band: z.enum(SIZE_BANDS),
    period_year: csvNumber.pipe(z.number().int().min(2000).max(2100)),
    p25: csvNumber,
    median: csvNumber,
    p75: csvNumber,
    sample_size: csvOptionalInteger,
    source_name: z.string().trim().min(1),
    source_url: csvOptionalText.pipe(z.url().nullable()),
    source_note_de: csvOptionalText,
    source_note_en: csvOptionalText,
    provisional: csvBoolean,
  })
  .refine((row) => row.p25 <= row.median && row.median <= row.p75, {
    message: "quartiles must satisfy p25 <= median <= p75",
    path: ["median"],
  })
  .refine((row) => (row.source_note_de === null) === (row.source_note_en === null), {
    message: "source_note_de and source_note_en are both set or both empty",
    path: ["source_note_en"],
  });
export type BenchmarkSeedRow = z.infer<typeof benchmarkRowSchema>;

export const assumptionRowSchema = z
  .object({
    key: z.enum(ASSUMPTION_KEYS),
    value: csvNumber,
    unit: z.string().trim().min(1),
    label_de: z.string().trim().min(1),
    label_en: z.string().trim().min(1),
    source_name: z.string().trim().min(1),
    source_url: csvOptionalText.pipe(z.url().nullable()),
    note_de: csvOptionalText,
    note_en: csvOptionalText,
    provisional: csvBoolean,
    effective_from: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((row) => (row.note_de === null) === (row.note_en === null), {
    message: "note_de and note_en are both set or both empty",
    path: ["note_en"],
  });
export type AssumptionSeedRow = z.infer<typeof assumptionRowSchema>;

/** The file level rule for the assumptions (over parsed rows): every key exactly once and the multipliers in order. */
export const assumptionFileSchema = z
  .array(z.custom<AssumptionSeedRow>((value) => typeof value === "object" && value !== null))
  .refine(
    (rows) =>
      ASSUMPTION_KEYS.every((key) => rows.filter((row) => row.key === key).length === 1) &&
      rows.length === ASSUMPTION_KEYS.length,
    { message: `every key of ${ASSUMPTION_KEYS.join(", ")} must appear exactly once` },
  )
  .refine(
    (rows) => {
      const value = (key: string) => rows.find((row) => row.key === key)?.value ?? Number.NaN;
      return (
        value("indirect_multiplier_low") <= value("indirect_multiplier") &&
        value("indirect_multiplier") <= value("indirect_multiplier_high")
      );
    },
    { message: "indirect_multiplier_low <= indirect_multiplier <= indirect_multiplier_high" },
  );

/** The unique key of a peer row, the conflict target of the generated migration. */
export const BENCHMARK_CONFLICT_COLUMNS = [
  "kpi_key",
  "industry_section",
  "size_band",
  "period_year",
] as const;

export type CsvTable = {
  readonly header: readonly string[];
  /** One record per data line, keyed by header; `line` is the 1 based line number in the file. */
  readonly records: ReadonlyArray<{
    readonly line: number;
    readonly fields: Record<string, string>;
  }>;
};

/**
 * Parses RFC 4180 CSV text (comma separated, double quotes with `""` escapes, quoted fields may
 * span lines) into records keyed by the header row. Throws with the line number on a malformed
 * row. Pure.
 */
export function parseCsv(text: string): CsvTable {
  const rows: string[][] = [];
  const lineOf: number[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field !== "") throw new Error(`line ${line}: a quote may only open a field`);
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      lineOf.push(rowStart);
      row = [];
      field = "";
      line += 1;
      rowStart = line;
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error(`line ${rowStart}: unterminated quoted field`);
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
    lineOf.push(rowStart);
  }
  const [header, ...data] = rows;
  if (!header) throw new Error("line 1: the file has no header row");
  const records = data.flatMap((cells, index) => {
    const lineNumber = lineOf[index + 1] as number;
    if (cells.length === 1 && cells[0] === "") return [];
    if (cells.length !== header.length) {
      throw new Error(
        `line ${lineNumber}: expected ${header.length} fields, found ${cells.length}`,
      );
    }
    return [
      {
        line: lineNumber,
        fields: Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])),
      },
    ];
  });
  return { header, records };
}

export type SeedParseError = { readonly line: number; readonly message: string };

/**
 * Parses every record with `schema`, returning the rows or the first invalid record's line and
 * message (spec 0008, AC-2: the generator fails with a line number). Pure.
 */
export function parseSeedRows<T>(
  table: CsvTable,
  schema: z.ZodType<T, unknown>,
):
  | { readonly ok: true; readonly rows: readonly T[] }
  | { readonly ok: false; readonly error: SeedParseError } {
  const rows: T[] = [];
  for (const record of table.records) {
    const result = schema.safeParse(record.fields);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.map(String).join(".") ?? "";
      return {
        ok: false,
        error: {
          line: record.line,
          message: `${path ? `${path}: ` : ""}${issue?.message ?? "invalid row"}`,
        },
      };
    }
    rows.push(result.data);
  }
  return { ok: true, rows };
}
