/**
 * Naming a generated migration file. The hand run generators that render a seed migration
 * (`pnpm questionnaires:migration`) pick their file name here, so a generated file always sorts
 * after every migration already on disk and two generators run in the same second cannot collide.
 * Pure, runs anywhere; lifted out of the benchmark seed generator when spec 0022 removed it.
 */

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
 * A timestamp strictly later than every existing migration and not earlier than `now`, so a
 * generated seed always applies after the table migration it depends on. Pure.
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
