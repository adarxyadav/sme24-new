/**
 * The peer proposal prompt (spec 0012, AC-2): asks Claude for Swiss companies that belong in one
 * industry section and size band, each with a one line reason. Its output is a list of names for
 * an ops user to approve, never a number: nothing it returns reaches a client without a human
 * approving it first, and no value it returns is ever used in the benchmark arithmetic. Pure.
 */

/** Bumped by hand when the prompt text changes; stored on the row in `proposal.promptVersion`. */
export const PEER_PROPOSAL_PROMPT_VERSION = "peer-proposal@1";

export type PeerProposalInput = {
  /** The NOGA 2008 section letter and its name in English. */
  readonly section: string;
  readonly sectionName: string;
  /** The size band as the benchmark spells it (`1-49`, `50-249`, `250+`, `all`). */
  readonly sizeBand: string;
  readonly count: number;
  /** Names already proposed, approved, rejected or retired for this set: never propose them again. */
  readonly exclude: readonly string[];
};

/** The system prompt: the job, what makes a good candidate, and the hard rules. Pure. */
export function peerProposalSystemPrompt(): string {
  return [
    "You suggest Swiss companies that could serve as occupational health and safety benchmark peers for a given industry section and company size band.",
    "",
    "A good candidate:",
    "- is a real company with operations in Switzerland, either headquartered there or running a substantial Swiss site;",
    "- belongs to the named NOGA 2008 industry section, by its actual main activity rather than its name;",
    "- sits in or close to the named employee size band;",
    "- publishes occupational safety figures, typically in an annual report, a sustainability or ESG report, a GRI index or a safety report, so that a web research pass can find real numbers.",
    "",
    "Rules:",
    "- Return only companies you are confident exist. Never invent a company, a group or a subsidiary.",
    "- Never return a company from the exclusion list, in any spelling.",
    "- `name` is the common trading name; `legalName` is the registered name with its legal form when you know it, else null.",
    "- `website` is the company's own domain as a bare host such as `example.ch`, or null when you are not sure.",
    "- `reason` is one sentence, at most 200 characters, saying why this company fits the section and the size band.",
    "- Prefer companies that publish figures over larger companies that do not.",
    "- Return fewer candidates rather than padding the list with weak or invented ones.",
    "- Return no numbers, no safety figures and no estimates: a human approves the names, and the figures are read from sources afterwards.",
  ].join("\n");
}

/** The user prompt: the section, the band, how many to return and the exclusion list. Pure. */
export function peerProposalPrompt({
  section,
  sectionName,
  sizeBand,
  count,
  exclude,
}: PeerProposalInput): string {
  const band = sizeBand === "all" ? "any size" : `${sizeBand.replace("+", " and more")} employees`;
  return [
    `NOGA 2008 section: ${section} (${sectionName})`,
    `Employee size band: ${band}`,
    `Return at most ${count} candidates.`,
    "",
    "Already on the list, never propose these again:",
    exclude.length === 0 ? "- none" : exclude.map((name) => `- ${name}`).join("\n"),
  ].join("\n");
}
