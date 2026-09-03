/**
 * Checks that a commit message subject follows Conventional Commits with one of the
 * types this project uses. Runs in the lefthook commit-msg hook (message file as the
 * first argument) and in CI (one subject per run on stdin). Exits 1 on a bad subject.
 */
import { readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "chore", "docs", "test", "refactor", "ci"] as const;

const SUBJECT = new RegExp(`^(${TYPES.join("|")})(\\([^)]+\\))?!?: \\S.*$`);

// Messages git writes itself: merges, reverts, and fixup/squash commits for an interactive rebase.
const GIT_GENERATED = /^(Merge |Revert |fixup! |squash! )/;

const STDIN_FD = 0;

/** Returns the first line that is not blank and not a `#` comment, or undefined. */
const firstSubjectLine = (message: string): string | undefined =>
  message
    .split("\n")
    .map((line) => line.trimEnd())
    .find((line) => line !== "" && !line.startsWith("#"));

/** Reads the message from the file path given as the first argument, else from stdin. */
const readMessage = (path: string | undefined): string => readFileSync(path ?? STDIN_FD, "utf8");

const subject = firstSubjectLine(readMessage(process.argv[2]));

if (subject !== undefined && (GIT_GENERATED.test(subject) || SUBJECT.test(subject))) {
  process.exitCode = 0;
} else {
  const shown = subject === undefined ? "(empty message)" : subject;
  console.error(
    [
      `Commit message rejected: ${shown}`,
      `Start the subject with a type: ${TYPES.join(", ")}.`,
      "Shape: type(optional scope): summary, for example `feat(auth): add magic link sign in`.",
    ].join("\n"),
  );
  process.exitCode = 1;
}
