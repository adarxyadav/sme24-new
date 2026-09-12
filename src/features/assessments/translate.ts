import { z } from "zod";
import { structuredOutput } from "../../lib/ai/gateway.ts";
import {
  questionnaireTranslationPrompt,
  questionnaireTranslationSystemPrompt,
  type TranslationEntry,
} from "../../lib/ai/prompts/questionnaire-translation.ts";
import type { ItemTexts } from "./content-fixes.ts";
import type { ContentFile } from "./content-schema.ts";

/**
 * The German draft of the questionnaire content (spec 0019, AC-1): the reuse rule over the
 * committed file, the batching, and the one `structuredOutput` call. `pnpm questionnaires:build`
 * is the only caller; the functions other than `draftGerman` are pure. Alias free on purpose.
 */

/** What the committed file remembers about one item: its German and whether a person reviewed it. */
export type ItemMemory = {
  readonly de: ItemTexts;
  readonly deReviewed: boolean;
};

/**
 * The reuse key of an item: its three English texts, byte for byte. A rerun keeps the German of
 * any item whose English is unchanged and drafts anew otherwise (AC-1). Pure.
 */
export function itemMemoryKey(en: ItemTexts): string {
  return JSON.stringify([en.title, en.requirement, en.question]);
}

/** The Germans the committed file holds, keyed by `itemMemoryKey`. Pure. */
export function rememberItems(previous: ContentFile | null): ReadonlyMap<string, ItemMemory> {
  const memory = new Map<string, ItemMemory>();
  for (const item of previous?.items ?? []) {
    const en: ItemTexts = {
      title: item.title.en,
      requirement: item.requirement?.en ?? null,
      question: item.question.en,
    };
    memory.set(itemMemoryKey(en), {
      de: {
        title: item.title.de,
        requirement: item.requirement?.de ?? null,
        question: item.question.de,
      },
      deReviewed: item.deReviewed,
    });
  }
  return memory;
}

/** The Germans of the version, section and group titles the committed file holds, keyed by English. Pure. */
export function rememberTitles(previous: ContentFile | null): ReadonlyMap<string, string> {
  const memory = new Map<string, string>();
  if (!previous) return memory;
  memory.set(previous.title.en, previous.title.de);
  for (const section of previous.sections) {
    memory.set(section.title.en, section.title.de);
    for (const group of section.groups) memory.set(group.title.en, group.title.de);
  }
  return memory;
}

/** A list cut into slices of at most `size`. Pure. */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be at least 1");
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, (index + 1) * size),
  );
}

/** One item awaiting a German draft. */
export type PendingItem = {
  readonly position: number;
  readonly label: string;
  readonly en: ItemTexts;
};

/** The entries of a batch of items: up to three per item, ids `<position>:<field>`. Pure. */
export function itemEntries(items: readonly PendingItem[]): TranslationEntry[] {
  return items.flatMap((item) => [
    { id: `${item.position}:title`, kind: "title", label: item.label, en: item.en.title },
    ...(item.en.requirement === null
      ? []
      : [
          {
            id: `${item.position}:requirement`,
            kind: "requirement",
            label: item.label,
            en: item.en.requirement,
          },
        ]),
    { id: `${item.position}:question`, kind: "question", label: item.label, en: item.en.question },
  ]);
}

/** The German texts of a batch of items, read back from the answered entries. Pure. */
export function assembleItems(
  items: readonly PendingItem[],
  answers: ReadonlyMap<string, string>,
): ReadonlyMap<number, ItemTexts> {
  const read = (id: string): string => {
    const text = answers.get(id);
    if (text === undefined) throw new Error(`no German for ${id}`);
    return text;
  };
  return new Map(
    items.map((item) => [
      item.position,
      {
        title: read(`${item.position}:title`),
        requirement: item.en.requirement === null ? null : read(`${item.position}:requirement`),
        question: read(`${item.position}:question`),
      },
    ]),
  );
}

export const translationOutputSchema = z.object({
  texts: z.array(z.object({ id: z.string().min(1), de: z.string().min(1) })),
});

/** How many items one call carries: three texts each, well inside the output cap. */
export const ITEMS_PER_CALL = 10;
/** How many titles one call carries. */
export const TITLES_PER_CALL = 40;
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Every answered id checked against what was asked: each exactly once, none extra, none in
 * English. Throws on a gap so the caller retries the batch rather than writing a hole. Pure.
 */
export function checkAnswers(
  entries: readonly TranslationEntry[],
  texts: readonly { readonly id: string; readonly de: string }[],
): ReadonlyMap<string, string> {
  const answers = new Map<string, string>();
  for (const text of texts) {
    if (answers.has(text.id)) throw new Error(`id ${text.id} answered twice`);
    answers.set(text.id, text.de.trim());
  }
  for (const entry of entries) {
    if (!answers.has(entry.id)) throw new Error(`id ${entry.id} not answered`);
  }
  const unknown = [...answers.keys()].filter((id) => !entries.some((entry) => entry.id === id));
  if (unknown.length > 0) throw new Error(`unknown ids answered: ${unknown.join(", ")}`);
  return answers;
}

export type DraftGermanInput = {
  readonly apiKey: string;
  readonly context: { readonly questionnaire: string; readonly section: string | null };
  readonly entries: readonly TranslationEntry[];
};

/**
 * One batch drafted through the AI Gateway (temperature 0, the prompt in
 * `src/lib/ai/prompts/questionnaire-translation.ts`), the answers checked. Throws when the SDK's
 * retries are exhausted or the answer has a gap; the build script fails the run. Script only.
 */
export async function draftGerman({
  apiKey,
  context,
  entries,
}: DraftGermanInput): Promise<ReadonlyMap<string, string>> {
  const output = await structuredOutput({
    apiKey,
    schema: translationOutputSchema,
    system: questionnaireTranslationSystemPrompt(),
    prompt: questionnaireTranslationPrompt(context, entries),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  return checkAnswers(entries, output.texts);
}
