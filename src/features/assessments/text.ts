/**
 * Turns a content text into blocks the item card renders (spec 0019, AC-11): the requirement and
 * question texts carry line breaks and bullet markers from Phillip's export, and the page shows
 * them as paragraphs and lists rather than one run on paragraph. Pure, runs anywhere.
 */

export type TextListItem = {
  readonly text: string;
  /** Second level lines (`o  ...`) nested under this item. */
  readonly children: readonly string[];
};

export type TextBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly TextListItem[] };

/** `• item`, `- item`, `* item`: a first level bullet. */
const BULLET = /^[•·\-*]\s+(.*)$/;
/** `o  item`, `◦ item`: a second level bullet under the previous first level one. */
const SUB_BULLET = /^[o◦]\s+(.*)$/;

/**
 * Splits a text on line breaks and groups the lines: a marked line is a list item, a line that
 * follows one ending in a colon and ends in a semicolon is a list item too (the export writes
 * "considering:" then one clause per line), and the line that closes such a run with a full stop
 * is its last item. Everything else is a paragraph. Pure.
 */
export function textBlocks(text: string): readonly TextBlock[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const blocks: TextBlock[] = [];
  // A holder rather than two `let`s: the closures below mutate it, and TypeScript's control flow
  // would otherwise narrow a `let` to its initial null inside the loop.
  const run: { list: TextListItem[] | null; colonRun: boolean } = { list: null, colonRun: false };

  const closeList = () => {
    if (run.list && run.list.length > 0) blocks.push({ kind: "list", items: run.list });
    run.list = null;
    run.colonRun = false;
  };
  const pushItem = (item: string) => {
    if (!run.list) run.list = [];
    run.list.push({ text: item, children: [] });
  };

  for (const line of lines) {
    const sub = SUB_BULLET.exec(line);
    const bullet = BULLET.exec(line);
    if (sub?.[1] !== undefined) {
      const last = run.list?.at(-1);
      if (last && run.list) {
        run.list[run.list.length - 1] = { text: last.text, children: [...last.children, sub[1]] };
      } else {
        pushItem(sub[1]);
      }
      continue;
    }
    if (bullet?.[1] !== undefined) {
      pushItem(bullet[1]);
      continue;
    }
    if (run.colonRun) {
      const lastEndedOpen = (run.list?.at(-1)?.text ?? "").endsWith(";");
      if (line.endsWith(";")) {
        pushItem(line);
        continue;
      }
      if (lastEndedOpen) {
        pushItem(line);
        closeList();
        continue;
      }
    }
    closeList();
    blocks.push({ kind: "paragraph", text: line });
    if (line.endsWith(":")) run.colonRun = true;
  }
  closeList();
  return blocks;
}
