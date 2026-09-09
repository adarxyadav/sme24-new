import { cn } from "@/lib/utils";

export type StatementProps = {
  /** One or more sentences. Each becomes a line; a line that ended in "." gets the square stop. */
  readonly text: string;
  readonly as?: "h1" | "h2" | "h3" | "p";
  /** An id, so a section can name the statement as its heading through `aria-labelledby`. */
  readonly id?: string;
  /**
   * `line` (default) puts every sentence on its own line, the campaign format; `flow` lets them
   * run on and wrap like prose, for a headline whose sentences are shorter than its measure.
   */
  readonly layout?: "line" | "flow";
  /**
   * How many opening sentences keep the heading's own colour. The rest render in
   * `text-muted-foreground`, so one heading carries both the claim and the sentence that used to
   * sit beside it as a lead. Omit it (the default) and every sentence takes the same colour.
   */
  readonly leadSentences?: number;
  readonly className?: string;
};

export type Sentence = { readonly text: string; readonly stop: boolean };

/**
 * Splits copy at sentence ends (a period followed by whitespace or the end of the text, so
 * "sme24.ch" and "1.5" stay whole) and remembers which lines carried one ("AI" stays bare).
 */
export function splitSentences(text: string): readonly Sentence[] {
  return text
    .split(/(?<=\.)(?:\s+|$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== ".")
    .map((part) => ({ text: part.replace(/\.$/, ""), stop: part.endsWith(".") }));
}

/** A sentence split before its last word ("Know what to " and "fix"), so the stop can stay with the word. Pure. */
export function lastWord(text: string): { readonly head: string; readonly tail: string } {
  const at = text.lastIndexOf(" ");
  return at === -1
    ? { head: "", tail: text }
    : { head: text.slice(0, at + 1), tail: text.slice(at + 1) };
}

/**
 * The campaign full stop: a solid square on the baseline. Screen readers get a real period so
 * the sentence still reads as one. Server or browser.
 */
export function SquareStop() {
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-[0.1em] inline-block size-[0.2em] bg-current align-baseline"
      />
      <span className="sr-only">.</span>
    </>
  );
}

/**
 * A campaign statement (brand guidelines 06, the campaign decks): short sentences, one per line,
 * each closed by the square stop. "Senior experts. No slides. Just results." Pair with a display
 * size (`text-display-*`) or a headline size. Server or browser.
 */
export function Statement({
  text,
  as: Tag = "p",
  id,
  layout = "line",
  leadSentences,
  className,
}: StatementProps) {
  const sentences = splitSentences(text);
  return (
    <Tag id={id} data-slot="statement" className={cn("text-balance", className)}>
      {sentences.map((sentence, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines are static per render and derived from one string, and a repeated sentence must keep its own line
          key={index}
          className={cn(
            layout === "line" ? "block" : undefined,
            // Everything past the opening sentences drops to the muted colour, so the heading
            // states the claim and then answers it in one breath. The stop stays `bg-current`,
            // so each square takes the colour of the sentence it closes.
            leadSentences !== undefined && index >= leadSentences && "text-muted-foreground",
          )}
        >
          {lastWord(sentence.text).head}
          {/* The stop stays glued to the last word, so a wrapped sentence never opens a line with it. */}
          <span className="whitespace-nowrap">
            {lastWord(sentence.text).tail}
            {sentence.stop ? <SquareStop /> : null}
          </span>
          {index < sentences.length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}
