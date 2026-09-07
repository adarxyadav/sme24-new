/**
 * Recomputes the benchmark for every company that has a snapshot (spec 0008, AC-13):
 *
 *   pnpm benchmarks:recompute
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (the project's name for the service role
 * key; SUPABASE_SERVICE_ROLE_KEY is accepted too) and TRIGGER_SECRET_KEY from the environment or
 * `.env.local`, swapped to the target environment's values as docs/auth.md describes for
 * `pnpm user:invite`. Lists every distinct company in `benchmark_snapshots`, paging with
 * `range` because PostgREST caps a request at `max_rows` (1000) and returns a short result with
 * no error, so an unpaged select would silently skip every company past the cap. Triggers
 * `benchmark-company` for each with `triggerKind` `recompute` under the key
 * `benchmark/recompute/<companyId>/<yyyy-mm-dd>` (24 hour TTL), and prints the row, page and
 * company counts so a truncation is visible. Never writes the database itself; exits 1 when a
 * variable is missing. Plain Node.
 */
import { createClient } from "@supabase/supabase-js";
import { configure, idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

function fail(message: string): never {
  console.error(`benchmarks:recompute: ${message}`);
  process.exit(1);
}

function requireEnv(...names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return fail(`${names.join(" or ")} is not set (export it or put it in .env.local)`);
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const secretKey = requireEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const triggerKey = requireEnv("TRIGGER_SECRET_KEY");

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
configure({ secretKey: triggerKey });

/**
 * One page of `company_id` values. Asks for `PAGE_SIZE` rows and reports how many came back, so
 * the caller stops on the first short page (PostgREST also caps the page at `max_rows`).
 */
const PAGE_SIZE = 1000;

const seen = new Set<string>();
let rows = 0;
let pages = 0;
for (let from = 0; ; from += PAGE_SIZE) {
  const { data, error } = await supabase
    .from("benchmark_snapshots")
    .select("company_id")
    .order("company_id", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) fail(`could not list the snapshots: ${error.message}`);
  const page = data ?? [];
  pages += 1;
  rows += page.length;
  for (const row of page) seen.add(row.company_id as string);
  // A short page is the last one: PostgREST returned fewer rows than the window asked for.
  if (page.length < PAGE_SIZE) break;
}
const companyIds = [...seen];
const day = new Date().toISOString().slice(0, 10);

let queued = 0;
for (const companyId of companyIds) {
  const idempotencyKey = await idempotencyKeys.create(`benchmark/recompute/${companyId}/${day}`, {
    scope: "global",
  });
  await tasks.trigger(
    "benchmark-company",
    { companyId, triggerKind: "recompute" },
    { idempotencyKey, idempotencyKeyTTL: "24h" },
  );
  queued += 1;
}
console.log(
  `benchmarks:recompute: queued ${queued} of ${companyIds.length} companies with a snapshot ` +
    `(${rows} snapshot rows over ${pages} page${pages === 1 ? "" : "s"}, key day ${day})`,
);
