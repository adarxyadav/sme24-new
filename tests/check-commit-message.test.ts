import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The script is a small command line program (no exports), so every test runs it the way the
// commit-msg hook and CI do: as a child process, with the message on stdin or in a file.
const SCRIPT = join(process.cwd(), "scripts/check-commit-message.mts");
const TYPES = ["feat", "fix", "chore", "docs", "test", "refactor", "ci"];

type Outcome = { readonly status: number | null; readonly stderr: string; readonly stdout: string };

/** Runs the checker with the message on stdin, the way the CI step feeds it. */
const checkViaStdin = (message: string): Outcome => {
  const result = spawnSync(process.execPath, [SCRIPT], { input: message, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

/** Runs the checker with a message file path, the way git's commit-msg hook feeds it. */
const checkViaFile = (dir: string, message: string): Outcome => {
  const file = join(dir, "COMMIT_EDITMSG");
  writeFileSync(file, message);
  const result = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

describe("check-commit-message (feature 2, conventional commits)", () => {
  describe("accepts", () => {
    it.each(TYPES)("a subject that starts with the %s type", (type) => {
      expect(checkViaStdin(`${type}: do the thing\n`).status).toBe(0);
    });

    it("a scope in parentheses", () => {
      expect(checkViaStdin("feat(auth): add magic link sign in\n").status).toBe(0);
    });

    it("a breaking change marker, with or without a scope", () => {
      expect(checkViaStdin("chore!: drop Node 20\n").status).toBe(0);
      expect(checkViaStdin("feat(api)!: rename the orders endpoint\n").status).toBe(0);
    });

    it.each([
      "Merge branch 'main' into feat/x",
      'Revert "feat: x"',
      "fixup! feat: x",
      "squash! feat: x",
    ])("the git generated subject %s", (subject) => {
      expect(checkViaStdin(`${subject}\n`).status).toBe(0);
    });

    it("a message whose body does not follow the convention, since only the subject counts", () => {
      expect(
        checkViaStdin("fix: stop double submit\n\nSome explanation.\nnot a type: here\n").status,
      ).toBe(0);
    });

    it("a subject with trailing whitespace", () => {
      expect(checkViaStdin("docs: explain hooks   \n").status).toBe(0);
    });

    it("the first line that is neither blank nor a # comment as the subject", () => {
      const message =
        "\n# Please enter the commit message for your changes.\n# Lines starting with # are ignored.\nrefactor: split the env module\n";
      expect(checkViaStdin(message).status).toBe(0);
    });

    it("prints nothing on success", () => {
      const outcome = checkViaStdin("ci: cache pnpm\n");
      expect(outcome.stdout).toBe("");
      expect(outcome.stderr).toBe("");
    });
  });

  describe("rejects", () => {
    it("a subject without a type prefix, naming the allowed types", () => {
      const outcome = checkViaStdin("bad message\n");
      expect(outcome.status).toBe(1);
      expect(outcome.stderr).toContain("Commit message rejected: bad message");
      for (const type of TYPES) expect(outcome.stderr).toContain(type);
    });

    it("a type that is not on the list", () => {
      expect(checkViaStdin("feature: add thing\n").status).toBe(1);
      expect(checkViaStdin("build: bump deps\n").status).toBe(1);
    });

    it("an uppercase type", () => {
      expect(checkViaStdin("Feat: add thing\n").status).toBe(1);
    });

    it("a missing space or an empty summary after the colon", () => {
      expect(checkViaStdin("feat:add thing\n").status).toBe(1);
      expect(checkViaStdin("feat: \n").status).toBe(1);
      expect(checkViaStdin("feat:\n").status).toBe(1);
    });

    it("a scope without a closing parenthesis", () => {
      expect(checkViaStdin("feat(auth: add thing\n").status).toBe(1);
    });

    it("a type that only appears later in the message", () => {
      expect(checkViaStdin("wip\n\nfeat: the real subject\n").status).toBe(1);
    });

    it("an empty message", () => {
      const outcome = checkViaStdin("");
      expect(outcome.status).toBe(1);
      expect(outcome.stderr).toContain("(empty message)");
    });

    it("a message made only of blank lines and # comments", () => {
      const outcome = checkViaStdin("\n\n# nothing here\n");
      expect(outcome.status).toBe(1);
      expect(outcome.stderr).toContain("(empty message)");
    });
  });

  describe("reads the message file git passes to the commit-msg hook", () => {
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "sme24-commit-msg-"));
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("accepts a conventional subject from the file", () => {
      expect(checkViaFile(dir, "test(tooling): cover the commit message check\n").status).toBe(0);
    });

    it("rejects a bad subject from the file", () => {
      const outcome = checkViaFile(dir, "fixed stuff\n");
      expect(outcome.status).toBe(1);
      expect(outcome.stderr).toContain("Commit message rejected: fixed stuff");
    });

    it("skips git's comment lines in the file, as an editor session leaves them", () => {
      const message = "chore: tidy\n# Please enter the commit message.\n#\n# On branch main\n";
      expect(checkViaFile(dir, message).status).toBe(0);
    });
  });
});
