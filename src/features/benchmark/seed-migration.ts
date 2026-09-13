import {
  type AssumptionSeedRow,
  BENCHMARK_CONFLICT_COLUMNS,
  type BenchmarkSeedRow,
  PEER_FIGURE_CONFLICT_COLUMNS,
  type PeerCompanySeedRow,
  type PeerFigureSeedRow,
} from "./seed-schema.ts";

/**
 * Renders the seed migration (spec 0008, AC-2): one upsert per peer row and per assumption, so a
 * rerun changes no row count and a replaced value is a new generated migration. Pure; the
 * `benchmarks-migration` script writes the result to supabase/migrations/.
 */

/** A SQL string literal with single quotes doubled. Pure. */
function literal(value: string | null): string {
  return value === null ? "null" : `'${value.replaceAll("'", "''")}'`;
}

/** A jsonb literal of a `{de, en}` pair, or `null` when both are empty. Pure. */
function localized(de: string | null, en: string | null): string {
  if (de === null || en === null) return "null";
  return `${literal(JSON.stringify({ de, en }))}::jsonb`;
}

function number(value: number): string {
  return String(value);
}

/** The upsert of one peer row. Pure. */
export function renderBenchmarkUpsert(row: BenchmarkSeedRow): string {
  const columns = [
    "kpi_key",
    "industry_section",
    "size_band",
    "period_year",
    "p25",
    "median",
    "p75",
    "sample_size",
    "source_name",
    "source_url",
    "source_note",
    "source_key",
    "basis",
    "provisional",
    "is_assumption",
  ];
  const values = [
    literal(row.kpi_key),
    literal(row.industry_section),
    literal(row.size_band),
    number(row.period_year),
    number(row.p25),
    number(row.median),
    number(row.p75),
    row.sample_size === null ? "null" : number(row.sample_size),
    literal(row.source_name),
    literal(row.source_url),
    localized(row.source_note_de, row.source_note_en),
    literal(row.source_key),
    localized(row.basis_de, row.basis_en),
    row.provisional ? "true" : "false",
    row.is_assumption ? "true" : "false",
  ];
  const updates = columns
    .filter((column) => !(BENCHMARK_CONFLICT_COLUMNS as readonly string[]).includes(column))
    .map((column) => `${column} = excluded.${column}`);
  return [
    `insert into public.benchmarks (${columns.join(", ")})`,
    `values (${values.join(", ")})`,
    `on conflict (${BENCHMARK_CONFLICT_COLUMNS.join(", ")}) do update set ${updates.join(", ")};`,
  ].join("\n");
}

/** The upsert of one assumption. Pure. */
export function renderAssumptionUpsert(row: AssumptionSeedRow): string {
  const columns = [
    "key",
    "value",
    "unit",
    "label",
    "source_name",
    "source_url",
    "note",
    "provisional",
    "is_assumption",
    "effective_from",
  ];
  const values = [
    literal(row.key),
    number(row.value),
    literal(row.unit),
    localized(row.label_de, row.label_en),
    literal(row.source_name),
    literal(row.source_url),
    localized(row.note_de, row.note_en),
    row.provisional ? "true" : "false",
    row.is_assumption ? "true" : "false",
    literal(row.effective_from),
  ];
  const updates = columns
    .filter((column) => column !== "key")
    .map((column) => `${column} = excluded.${column}`);
  return [
    `insert into public.benchmark_assumptions (${columns.join(", ")})`,
    `values (${values.join(", ")})`,
    `on conflict (key) do update set ${updates.join(", ")};`,
  ].join("\n");
}

/**
 * Retires every peer row the CSV no longer names (spec 0016 amendment, AC-29). The CSV is the
 * whole peer table: an upsert alone would leave a replaced reading (the 2022 Suva rows) in place
 * beside the new one, and the launch gate would count it. The tuple list is the same conflict key
 * the upserts use. Nothing to retire when the CSV is empty. Pure.
 */
export function renderBenchmarkRetirement(rows: readonly BenchmarkSeedRow[]): string | null {
  if (rows.length === 0) return null;
  const tuples = rows.map(
    (row) =>
      `(${literal(row.kpi_key)}, ${literal(row.industry_section)}, ${literal(row.size_band)}, ${number(row.period_year)})`,
  );
  return [
    "-- Retire the peer rows the CSV no longer names, so a replaced reading does not stay beside the new one.",
    `delete from public.benchmarks where (${BENCHMARK_CONFLICT_COLUMNS.join(", ")}) not in (`,
    tuples.join(",\n"),
    ");",
  ].join("\n");
}

/** The upsert of one peer company (spec 0021, AC-3). Pure. */
export function renderPeerCompanyUpsert(row: PeerCompanySeedRow): string {
  const columns = [
    "key",
    "name",
    "country",
    "industry_section",
    "headcount",
    "headcount_year",
    "report_url",
    "note",
  ];
  const values = [
    literal(row.key),
    literal(row.name),
    literal(row.country),
    literal(row.industry_section),
    number(row.headcount),
    number(row.headcount_year),
    literal(row.report_url),
    localized(row.note_de, row.note_en),
  ];
  const updates = columns
    .filter((column) => column !== "key")
    .map((column) => `${column} = excluded.${column}`);
  return [
    `insert into public.peer_companies (${columns.join(", ")})`,
    `values (${values.join(", ")})`,
    `on conflict (key) do update set ${updates.join(", ")};`,
  ].join("\n");
}

/** The upsert of one peer figure, with `value` already converted by the seed schema (spec 0021, AC-3, AC-13). Pure. */
export function renderPeerFigureUpsert(row: PeerFigureSeedRow): string {
  const columns = [
    "peer_key",
    "kpi_key",
    "period_year",
    "value",
    "value_as_published",
    "unit_as_published",
    "basis",
    "source_url",
    "verified_at",
    "verified_by",
  ];
  const values = [
    literal(row.peer_key),
    literal(row.kpi_key),
    number(row.period_year),
    number(row.value),
    number(row.value_as_published),
    literal(row.unit_as_published),
    literal(row.basis),
    literal(row.source_url),
    row.verified_at === null ? "null" : `${literal(row.verified_at)}::timestamptz`,
    literal(row.verified_by),
  ];
  const updates = columns
    .filter((column) => !(PEER_FIGURE_CONFLICT_COLUMNS as readonly string[]).includes(column))
    .map((column) => `${column} = excluded.${column}`);
  return [
    `insert into public.peer_figures (${columns.join(", ")})`,
    `values (${values.join(", ")})`,
    `on conflict (${PEER_FIGURE_CONFLICT_COLUMNS.join(", ")}) do update set ${updates.join(", ")};`,
  ].join("\n");
}

/**
 * Retires the figures and then the companies the two CSVs no longer name (spec 0021, AC-3): the
 * files are the whole tables. Figures first, then companies; the cascade would take a retired
 * company's figures either way, the order keeps the SQL readable. Nothing to retire when a file
 * is empty. Pure.
 */
export function renderPeerRetirement(
  companies: readonly PeerCompanySeedRow[],
  figures: readonly PeerFigureSeedRow[],
): string | null {
  if (companies.length === 0 || figures.length === 0) return null;
  const figureTuples = figures.map(
    (row) =>
      `(${literal(row.peer_key)}, ${literal(row.kpi_key)}, ${number(row.period_year)}, ${literal(row.basis)})`,
  );
  const companyKeys = companies.map((row) => literal(row.key));
  return [
    "-- Retire the peer figures and companies the CSVs no longer name, so the files are the whole tables.",
    `delete from public.peer_figures where (${PEER_FIGURE_CONFLICT_COLUMNS.join(", ")}) not in (`,
    figureTuples.join(",\n"),
    ");",
    `delete from public.peer_companies where key not in (${companyKeys.join(", ")});`,
  ].join("\n");
}

/** The whole migration file. Pure. */
export function renderSeedMigration(
  benchmarks: readonly BenchmarkSeedRow[],
  assumptions: readonly AssumptionSeedRow[],
  generatedAt: Date,
  peers: {
    readonly companies: readonly PeerCompanySeedRow[];
    readonly figures: readonly PeerFigureSeedRow[];
  } = { companies: [], figures: [] },
): string {
  const header = [
    "-- Benchmark seed (spec 0008, AC-2; spec 0021, AC-3), generated by `pnpm benchmarks:migration` on",
    `-- ${generatedAt.toISOString()} from supabase/seed-data/benchmarks.csv, benchmark-assumptions.csv,`,
    "-- peer-companies.csv and peer-figures.csv. Do not edit by hand: change the CSV and generate again.",
    "-- Every statement is an upsert, so a rerun changes no row count; the deletes retire the rows",
    "-- a CSV no longer names, so each CSV is the whole table.",
    "",
  ];
  const retirement = renderBenchmarkRetirement(benchmarks);
  const peerBlock = [
    `-- ${benchmarks.length} peer rows`,
    ...benchmarks.map(renderBenchmarkUpsert),
    ...(retirement === null ? [] : [retirement]),
    "",
  ];
  const assumptionBlock = [
    `-- ${assumptions.length} assumptions`,
    ...assumptions.map(renderAssumptionUpsert),
    "",
  ];
  const peerRetirement = renderPeerRetirement(peers.companies, peers.figures);
  const libraryBlock = [
    `-- ${peers.companies.length} peer companies`,
    ...peers.companies.map(renderPeerCompanyUpsert),
    `-- ${peers.figures.length} peer figures`,
    ...peers.figures.map(renderPeerFigureUpsert),
    ...(peerRetirement === null ? [] : [peerRetirement]),
    "",
  ];
  return [...header, ...peerBlock, ...assumptionBlock, ...libraryBlock].join("\n");
}

/** The 14 digit timestamp prefix of a migration file name, or `null`. Pure. */
export function migrationTimestamp(fileName: string): string | null {
  const match = fileName.match(/^(\d{14})_/);
  return match?.[1] ?? null;
}

/** `yyyymmddhhmmss` in UTC. Pure. */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}

/**
 * A timestamp strictly later than every existing migration and not earlier than `now`, so the
 * seed always applies after the table migration (spec 0008, AC-2). Pure.
 */
export function nextMigrationTimestamp(existingFiles: readonly string[], now: Date): string {
  const newest = existingFiles
    .map(migrationTimestamp)
    .filter((stamp): stamp is string => stamp !== null)
    .sort()
    .at(-1);
  const current = formatTimestamp(now);
  if (!newest || current > newest) return current;
  // Same second or clock behind the newest file: step the newest stamp by one second.
  const asDate = new Date(
    Date.UTC(
      Number(newest.slice(0, 4)),
      Number(newest.slice(4, 6)) - 1,
      Number(newest.slice(6, 8)),
      Number(newest.slice(8, 10)),
      Number(newest.slice(10, 12)),
      Number(newest.slice(12, 14)) + 1,
    ),
  );
  return formatTimestamp(asDate);
}
