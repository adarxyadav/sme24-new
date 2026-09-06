import { KPI_LIST } from "@/features/research/catalogue";
import type { Candidate } from "@/lib/research/candidates";

/** Bumped by hand when the prompt text changes (spec 0007, AC-5); stored in `summary.promptVersion`. */
export const PROMPT_VERSION = "research-validation@1";

/** What the validator may know about the company (AC-13): public company data only. */
export type PromptCompany = {
  readonly name: string;
  readonly legalName: string | null;
  readonly website: string | null;
  readonly country: string;
};

export type PromptFacts = Partial<
  Record<
    "legal_name" | "uid" | "website" | "industry_noga" | "employees" | "canton" | "summary",
    string
  >
>;

/** The system prompt: the job, the catalogue with ranges, units and hints, the rules. Pure. */
export function researchValidationSystemPrompt(): string {
  const catalogue = KPI_LIST.map(
    (kpi) =>
      `- ${kpi.key}: unit "${kpi.unit}", plausible range ${kpi.range[0]} to ${kpi.range[1]}, ${kpi.direction.replaceAll("_", " ")}. ${kpi.hint}`,
  ).join("\n");
  return [
    "You check occupational health and safety figures a web research service extracted for a Swiss company.",
    "For every candidate you receive, decide whether the cited excerpts state that value for that reporting year, convert the value to the catalogue unit, and score your confidence from 0 to 1.",
    "",
    "Catalogue:",
    catalogue,
    "",
    "Rules:",
    "- supported is true only when at least one excerpt states the value (or the number it converts from) for the given year; a value that appears nowhere in the excerpts is unsupported.",
    "- value is the number in the catalogue unit; convert rates per 200 000 hours to per 1 000 000 hours by multiplying by 5, rates per 100 employees to per 1 000 by multiplying by 10, percentages stay as percent numbers (4.5 means 4.5 percent), yes/no answers become 1 or 0. When you cannot parse or convert, set value to null.",
    "- periodYear is the fiscal or reporting year the excerpt reports; null when the excerpt names none.",
    "- confidence starts from the research service's own level (low 0.3, medium 0.6, high 0.9) and moves with how directly the excerpt states the figure.",
    "- sourceIndexes lists the citation indexes (0 based, in the order given) that support the value.",
    "- companyFacts: the registered legal name (at most 200 characters), the UID as CHE-123.456.789, the NOGA code as dd or dd.dd, employees as a whole number, the canton as its two letter code; null for anything not stated.",
    "- Return nothing for a KPI and year that has no candidate. Never invent a value.",
  ].join("\n");
}

/** The user prompt: the company, the facts the service found and every candidate with its citations. Pure. */
export function researchValidationPrompt(
  company: PromptCompany,
  candidates: readonly Candidate[],
  facts: PromptFacts,
): string {
  const header = [
    `Company: ${company.name}`,
    `Legal name: ${company.legalName ?? "unknown"}`,
    `Website: ${company.website ?? "unknown"}`,
    `Country: ${company.country}`,
  ].join("\n");
  const factLines = Object.entries(facts)
    .map(([field, text]) => `- ${field}: ${text}`)
    .join("\n");
  const candidateBlocks = candidates.map((candidate) => {
    const citations = candidate.sources
      .map(
        (source, index) =>
          `  [${index}] ${source.title} <${source.url}>\n      "${source.excerpt.replaceAll("\n", " ")}"`,
      )
      .join("\n");
    return [
      `Field ${candidate.field} (kpi ${candidate.key}, slot ${candidate.slot}):`,
      `  text: "${candidate.raw.replaceAll("\n", " ")}"`,
      `  service confidence: ${candidate.basisConfidence ?? "none"}`,
      candidate.sources.length > 0 ? `  citations:\n${citations}` : "  citations: none",
    ].join("\n");
  });
  return [
    header,
    "",
    "Company facts the research service found:",
    factLines === "" ? "- none" : factLines,
    "",
    `Candidates (${candidates.length}):`,
    ...candidateBlocks,
  ].join("\n");
}
