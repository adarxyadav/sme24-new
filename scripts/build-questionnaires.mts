/**
 * Builds the questionnaire content files from Phillip's two HTML exports (spec 0019, AC-1):
 *
 *   pnpm questionnaires:build [--iso <path>] [--standards <path>] [--no-translate]
 *
 * Reads the `<script type="application/json">` block of each raw file (defaults under the
 * gitignored docs/raw/), maps it to content in document order with position based ids, applies
 * every fix in src/features/assessments/content-fixes.ts, drafts the German of every text whose
 * English changed since the committed file (through the AI Gateway, `AI_GATEWAY_API_KEY` from the
 * environment or `.env.local`), keeps the German and the `deReviewed` flag of every item whose
 * three English texts are unchanged, and writes src/features/assessments/content/iso45001.json
 * and compliance.json. `--no-translate` refuses to write unless every German is reused, so a
 * rerun without a key can never ship an English text as German. Plain Node (type stripping), so
 * the imported modules use relative `.ts` paths and no alias. Commit the two files it writes.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import {
  QUESTIONNAIRE_KEYS,
  type QuestionnaireKey,
} from "../src/features/assessments/catalogue.ts";
import {
  type EnglishContent,
  extractJsonBlock,
  extractTitle,
  mapIso,
  mapStandards,
  rawIsoSchema,
  rawStandardsSchema,
} from "../src/features/assessments/content-build.ts";
import {
  type ContentFile,
  contentFileSchema,
  type LocalizedText,
} from "../src/features/assessments/content-schema.ts";
import {
  assembleItems,
  chunk,
  draftGerman,
  ITEMS_PER_CALL,
  type ItemMemory,
  itemEntries,
  itemMemoryKey,
  type PendingItem,
  rememberItems,
  rememberTitles,
  TITLES_PER_CALL,
} from "../src/features/assessments/translate.ts";
import { PROMPT_VERSION } from "../src/lib/ai/prompts/questionnaire-translation.ts";

loadEnv({ path: ".env.local", quiet: true });

const CONTENT_DIR = join(process.cwd(), "src/features/assessments/content");
/** How many gateway calls run at once. */
const CONCURRENCY = 4;

function fail(message: string): never {
  console.error(`questionnaires:build: ${message}`);
  process.exit(1);
}

const { values: flags } = parseArgs({
  options: {
    iso: { type: "string", default: "docs/raw/iso45001_assessment.html" },
    standards: { type: "string", default: "docs/raw/standards_assessment.html" },
    "no-translate": { type: "boolean", default: false },
  },
});
const noTranslate = flags["no-translate"];

type RawSource = { readonly html: string; readonly sourceNote: string };

function readRaw(path: string): RawSource {
  if (!existsSync(path)) return fail(`${path} does not exist`);
  const html = readFileSync(path, "utf8");
  const exported = statSync(path).mtime.toISOString().slice(0, 10);
  return {
    html,
    sourceNote: `Built from ${basename(path)} ("${extractTitle(html)}"), export dated ${exported}.`,
  };
}

function readPrevious(key: QuestionnaireKey): ContentFile | null {
  const path = join(CONTENT_DIR, `${key}.json`);
  if (!existsSync(path)) return null;
  const parsed = contentFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    return fail(`${path} is not a valid content file: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/** Runs the jobs with at most `CONCURRENCY` in flight; the first failure rejects. */
async function pooled<T>(jobs: readonly (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      if (job) results[index] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return results;
}

type Drafts = {
  readonly titles: ReadonlyMap<string, string>;
  readonly items: ReadonlyMap<number, ItemMemory["de"]>;
};

async function draft(content: EnglishContent, previous: ContentFile | null): Promise<Drafts> {
  const itemMemory = rememberItems(previous);
  const titleMemory = rememberTitles(previous);
  const allTitles = [
    content.title,
    ...content.sections.flatMap((section) => [
      section.title,
      ...section.groups.map((group) => group.title),
    ]),
  ];
  const uniqueTitles = [...new Set(allTitles)];
  const pendingTitles = uniqueTitles.filter((title) => !titleMemory.has(title));
  const pendingItems: PendingItem[] = content.items
    .filter((item) => !itemMemory.has(itemMemoryKey(item.en)))
    .map((item) => ({ position: item.position, label: item.label, en: item.en }));
  console.log(
    `questionnaires:build: ${content.key}: ${content.items.length - pendingItems.length} of ${content.items.length} items and ${uniqueTitles.length - pendingTitles.length} of ${uniqueTitles.length} titles reuse their German`,
  );
  if (pendingTitles.length === 0 && pendingItems.length === 0) {
    return { titles: titleMemory, items: new Map() };
  }
  if (noTranslate) {
    return fail(
      `${content.key}: ${pendingItems.length} items and ${pendingTitles.length} titles need a German draft and --no-translate was given`,
    );
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return fail("AI_GATEWAY_API_KEY is not set (export it or put it in .env.local)");

  const titleJobs = chunk(pendingTitles, TITLES_PER_CALL).map(
    (batch) => () =>
      draftGerman({
        apiKey,
        context: { questionnaire: content.title, section: null },
        entries: batch.map((title, index) => ({
          id: `title:${index}`,
          kind: "title of a section or group",
          label: null,
          en: title,
        })),
      }).then(
        (answers) =>
          new Map(batch.map((title, index) => [title, answers.get(`title:${index}`) ?? ""])),
      ),
  );
  const sections = content.sections.map((section) => ({
    section,
    items: pendingItems.filter((item) =>
      content.items.some(
        (full) => full.position === item.position && full.sectionKey === section.key,
      ),
    ),
  }));
  const itemJobs = sections.flatMap(({ section, items }) =>
    chunk(items, ITEMS_PER_CALL).map(
      (batch) => () =>
        draftGerman({
          apiKey,
          context: { questionnaire: content.title, section: `${section.label} ${section.title}` },
          entries: itemEntries(batch),
        }).then((answers) => assembleItems(batch, answers)),
    ),
  );
  console.log(
    `questionnaires:build: ${content.key}: drafting ${pendingItems.length} items in ${itemJobs.length} calls and ${pendingTitles.length} titles in ${titleJobs.length} calls (${PROMPT_VERSION})`,
  );
  const [titleBatches, itemBatches] = await Promise.all([pooled(titleJobs), pooled(itemJobs)]);
  const titles = new Map(titleMemory);
  for (const batch of titleBatches) for (const [en, de] of batch) titles.set(en, de);
  const items = new Map<number, ItemMemory["de"]>();
  for (const batch of itemBatches) for (const [position, de] of batch) items.set(position, de);
  return { titles, items };
}

function assemble(
  content: EnglishContent,
  previous: ContentFile | null,
  drafts: Drafts,
  sourceNote: string,
): ContentFile {
  const itemMemory = rememberItems(previous);
  const localized = (en: string): LocalizedText => {
    const de = drafts.titles.get(en);
    if (!de) throw new Error(`no German for title ${JSON.stringify(en)}`);
    return { de, en };
  };
  const file = {
    key: content.key,
    version: previous?.version ?? 1,
    title: localized(content.title),
    sourceNote,
    sections: content.sections.map((section) => ({
      key: section.key,
      label: section.label,
      title: localized(section.title),
      groups: section.groups.map((group) => ({
        key: group.key,
        label: group.label,
        title: localized(group.title),
      })),
    })),
    items: content.items.map((item) => {
      const remembered = itemMemory.get(itemMemoryKey(item.en));
      const de = remembered?.de ?? drafts.items.get(item.position);
      if (!de) throw new Error(`no German for item ${item.position}`);
      const requirement =
        item.en.requirement === null || de.requirement === null
          ? null
          : { de: de.requirement, en: item.en.requirement };
      return {
        position: item.position,
        label: item.label,
        sectionKey: item.sectionKey,
        groupKey: item.groupKey,
        parentPosition: item.parentPosition,
        rateable: item.rateable,
        title: { de: de.title, en: item.en.title },
        requirement,
        question: { de: de.question, en: item.en.question },
        deReviewed: remembered?.deReviewed ?? false,
      };
    }),
  };
  const parsed = contentFileSchema.safeParse(file);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      `${content.key}: built content is invalid at ${issue?.path.join(".")}: ${issue?.message}`,
    );
  }
  return parsed.data;
}

async function build(content: EnglishContent, sourceNote: string): Promise<void> {
  const previous = readPrevious(content.key);
  const drafts = await draft(content, previous);
  const file = assemble(content, previous, drafts, sourceNote);
  const target = join(CONTENT_DIR, `${content.key}.json`);
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
  const drafted = file.items.filter((item) => !item.deReviewed).length;
  console.log(
    `questionnaires:build: wrote ${target} (${file.sections.length} sections, ${file.items.length} items, ${drafted} with an unreviewed German)`,
  );
}

const iso = readRaw(flags.iso);
const standards = readRaw(flags.standards);
const isoRaw = rawIsoSchema.safeParse(extractJsonBlock(iso.html));
if (!isoRaw.success)
  fail(`${flags.iso}: ${isoRaw.error.issues[0]?.message ?? "invalid JSON block"}`);
const standardsRaw = rawStandardsSchema.safeParse(extractJsonBlock(standards.html));
if (!standardsRaw.success) {
  fail(`${flags.standards}: ${standardsRaw.error.issues[0]?.message ?? "invalid JSON block"}`);
}

const contents: readonly { readonly content: EnglishContent; readonly sourceNote: string }[] = [
  { content: mapIso(isoRaw.data, extractTitle(iso.html)), sourceNote: iso.sourceNote },
  {
    content: mapStandards(standardsRaw.data, extractTitle(standards.html)),
    sourceNote: standards.sourceNote,
  },
];
for (const key of QUESTIONNAIRE_KEYS) {
  if (!contents.some((entry) => entry.content.key === key)) fail(`no content built for ${key}`);
}
for (const { content, sourceNote } of contents) await build(content, sourceNote);
