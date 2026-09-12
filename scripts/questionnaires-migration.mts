/**
 * Generates the questionnaire seed migration (spec 0019, AC-2):
 *
 *   pnpm questionnaires:migration
 *
 * Parses src/features/assessments/content/<key>.json for every key in `QUESTIONNAIRE_KEYS` with
 * the content schema, fails with the file and path on the first invalid field, and writes
 * supabase/migrations/<timestamp>_questionnaire_seed.sql holding one upsert per version and per
 * item, with a timestamp strictly later than the newest migration. Plain Node (type stripping),
 * so the imported modules use relative `.ts` paths and no alias. Commit the file it writes.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QUESTIONNAIRE_KEYS } from "../src/features/assessments/catalogue.ts";
import { type ContentFile, contentFileSchema } from "../src/features/assessments/content-schema.ts";
import { renderQuestionnaireMigration } from "../src/features/assessments/seed-migration.ts";
import { nextMigrationTimestamp } from "../src/features/benchmark/seed-migration.ts";

const CONTENT_DIR = join(process.cwd(), "src/features/assessments/content");
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function fail(message: string): never {
  console.error(`questionnaires:migration: ${message}`);
  process.exit(1);
}

function readContent(key: string): ContentFile {
  const path = join(CONTENT_DIR, `${key}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return fail(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = contentFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`${path} at ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "invalid"}`);
  }
  if (parsed.data.key !== key) fail(`${path} carries key ${parsed.data.key}, expected ${key}`);
  return parsed.data;
}

const files = QUESTIONNAIRE_KEYS.map(readContent);
const now = new Date();
const stamp = nextMigrationTimestamp(readdirSync(MIGRATIONS_DIR), now);
const target = join(MIGRATIONS_DIR, `${stamp}_questionnaire_seed.sql`);
writeFileSync(target, renderQuestionnaireMigration(files, now));
console.log(
  `questionnaires:migration: wrote ${target} (${files.map((file) => `${file.key}@${file.version}: ${file.items.length} items`).join(", ")})`,
);
