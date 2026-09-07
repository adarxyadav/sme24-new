// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The recompute script (spec 0008, AC-13): with a variable missing it names the variable on
 * stderr and exits 1 before it touches Supabase or Trigger.dev. Run as a child process from an
 * empty directory so no `.env.local` leaks in; the happy path needs a database and a worker and
 * belongs to `/check verify`.
 */
const SCRIPT = join(process.cwd(), "scripts", "benchmarks-recompute.mts");

function run(env: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "sme24-recompute-"));
  const { PATH, HOME, NODE_OPTIONS } = process.env;
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: {
      PATH: PATH ?? "",
      HOME: HOME ?? "",
      NODE_OPTIONS: NODE_OPTIONS ?? "",
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/**
 * Runs the script without blocking this process, so a stub server living in the same event loop
 * can answer it (`spawnSync` would deadlock against it).
 */
function runAsync(env: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "sme24-recompute-"));
  const { PATH, HOME, NODE_OPTIONS } = process.env;
  const child = spawn(process.execPath, [SCRIPT], {
    cwd,
    env: {
      PATH: PATH ?? "",
      HOME: HOME ?? "",
      NODE_OPTIONS: NODE_OPTIONS ?? "",
      ...env,
    } as unknown as NodeJS.ProcessEnv,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** Node's own startup warnings reach stderr; only the script's own `fail` output matters here. */
const scriptErrors = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.includes("benchmarks:recompute"))
    .join("\n");

/**
 * A stub PostgREST that answers the snapshot select from a fixed row list, plus the Trigger.dev
 * trigger endpoint. supabase-js sends `.range()` as `offset` and `limit` query parameters, so the
 * stub slices on those and records each window; a test then proves the script paged rather than
 * asking once and trusting a capped answer.
 */
function stubApi(companyIds: readonly string[]) {
  const windows: string[] = [];
  const triggered: string[] = [];
  const server: Server = createServer((request, response) => {
    const url = request.url ?? "";
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      if (url.startsWith("/rest/v1/benchmark_snapshots")) {
        const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
        const offset = Number(query.get("offset") ?? 0);
        const limit = Number(query.get("limit") ?? companyIds.length);
        windows.push(`${offset}+${limit}`);
        const page = companyIds.slice(offset, offset + limit);
        response.end(JSON.stringify(page.map((company_id) => ({ company_id }))));
        return;
      }
      if (url.includes("/tasks/") && url.endsWith("/trigger")) {
        triggered.push(body);
        response.end(JSON.stringify({ id: `run_${triggered.length}`, isCached: false }));
        return;
      }
      response.end("{}");
    });
  });
  return { server, windows, triggered };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

describe("pnpm benchmarks:recompute (AC-13)", () => {
  it("exits 1 and names the Supabase URL when nothing is set", () => {
    const { status, stderr, stdout } = run({});
    expect(status).toBe(1);
    expect(stderr).toContain("benchmarks:recompute: NEXT_PUBLIC_SUPABASE_URL is not set");
    expect(stdout).toBe("");
  });

  it("accepts either name for the service key and then asks for the Trigger.dev key", () => {
    const { status, stderr } = run({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(status).toBe(1);
    expect(stderr).toContain("TRIGGER_SECRET_KEY is not set");
    expect(stderr).not.toContain("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not set");
  });

  /**
   * The row cap regression: `benchmark_snapshots` holds one row per computation, so the 1000 row
   * PostgREST cap arrives well before 1000 clients and a single unpaged select drops everyone
   * past it without an error. The script must page until a short page comes back and say how many
   * pages it read, so a truncation is visible rather than reported as a success.
   */
  it("pages past the row cap and queues every company across more than one page", async () => {
    // 1001 rows over two pages: the 1000 row window is full, so the company on the second page is
    // exactly the one an unpaged select drops. Few distinct companies keeps the trigger calls cheap.
    const companyIds = Array.from({ length: 1001 }, (_, index) =>
      UUID(index < 1000 ? index % 4 : 99),
    );
    const distinct = new Set(companyIds).size;
    const { server, windows, triggered } = stubApi(companyIds);
    servers.push(server);
    const port = await listen(server);

    const { status, stdout, stderr } = await runAsync({
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
      SUPABASE_SECRET_KEY: "service",
      TRIGGER_SECRET_KEY: "tr_dev_stub",
      TRIGGER_API_URL: `http://127.0.0.1:${port}`,
    });

    expect(scriptErrors(stderr)).toBe("");
    expect(status).toBe(0);
    // The full first window, then the short page that ends the loop.
    expect(windows).toEqual(["0+1000", "1000+1000"]);
    // The company only the second page carries is queued, which the unpaged select never reached.
    expect(distinct).toBe(5);
    expect(triggered).toHaveLength(distinct);
    expect(triggered.join("\n")).toContain(UUID(99));
    expect(stdout).toContain(`queued ${distinct} of ${distinct} companies with a snapshot`);
    expect(stdout).toContain("1001 snapshot rows over 2 pages");
  }, 120_000);
});

const UUID = (n: number) => `0c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
