// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});
