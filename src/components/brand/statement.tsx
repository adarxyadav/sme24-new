import { cn } from "@/lib/utils";

export type StatementProps = {
  /** One or more sentences. Each sentence becomes a line that ends in the square stop. */
  readonly text: string;
  readonly as?: "h1" | "h2" | "h3" | "p";
  readonly className?: string;
};

/** Splits copy into its sentences, dropping the periods the square stops will carry. */
export function splitSentences(text: string): readonly string[] {
  return text
    .split(".")
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
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
export function Statement({ text, as: Tag = "p", className }: StatementProps) {
  const sentences = splitSentences(text);
  return (
    <Tag data-slot="statement" className={cn("text-balance", className)}>
      {sentences.map((sentence, index) => (
        <span key={sentence} className="block">
          {sentence}
          <SquareStop />
          {index < sentences.length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}
