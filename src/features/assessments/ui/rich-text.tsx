import { type TextBlock, textBlocks } from "@/features/assessments/text";
import { cn } from "@/lib/utils";

export type RichTextProps = {
  readonly text: string;
  readonly className?: string;
};

/**
 * A content text as paragraphs and lists (spec 0019, AC-11): the requirement and the question of
 * an item carry the export's line breaks and bullets, and this renders them as `<p>` and nested
 * `<ul>` rather than one run on paragraph. No hooks, so it renders on the server and inside the
 * client item card alike.
 */
export function RichText({ text, className }: RichTextProps) {
  const blocks = textBlocks(text);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {blocks.map((block) => (
        <Block key={blockKey(block)} block={block} />
      ))}
    </div>
  );
}

/** A stable key from the block's own text: the blocks of one content text never repeat verbatim. */
function blockKey(block: TextBlock): string {
  return block.kind === "paragraph"
    ? `p:${block.text}`
    : `ul:${block.items.map((item) => item.text).join("|")}`;
}

function Block({ block }: { readonly block: TextBlock }) {
  if (block.kind === "paragraph") return <p>{block.text}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {block.items.map((item) => (
        <li key={item.text}>
          {item.text}
          {item.children.length > 0 ? (
            <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
              {item.children.map((child) => (
                <li key={child}>{child}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
