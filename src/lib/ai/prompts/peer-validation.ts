import type { PeerCompany } from "@/lib/research/peer-schema";

/** Bumped by hand when the prompt text changes (spec 0022, AC-8); stored in `summary.peers`. */
export const PEER_PROMPT_VERSION = "peer-validation@1";

/** The client company the peers are compared against; public data only, as AC-13 of spec 0007. */
export type PeerPromptCompany = {
  readonly name: string;
  readonly country: string;
  /** The NOGA/NACE section letter the peers were searched in. */
  readonly section: string;
  readonly sectionName: string;
};

/**
 * The system prompt: check support, never convert. The conversion to per million hours is done in
 * code from the printed unit (AC-8), so the model is asked only whether the page carries the
 * figure, for which year, and how sure it is. Nothing here names one country. Pure.
 */
export function peerValidationSystemPrompt(): string {
  return [
    "You check occupational injury rates a web research service attributed to companies, against the pages it cited.",
    "For every peer and rate you receive, decide whether the cited page states that rate for that company and reporting year.",
    "",
    "Rules:",
    "- supported is true only when the cited page states that rate for that company; a figure the page does not carry, or one that belongs to another company or another metric, is unsupported.",
    "- Never convert a value and never return one. The denominator is handled elsewhere; judge the figure as printed.",
    "- LTIFR counts lost time injuries, TRIFR counts total recordable injuries. A page stating only one of them supports only that one.",
    "- periodYear is the reporting year the page states for the figure; null when it names none.",
    "- confidence is 0 to 1: how directly the page states the figure for that company and year. A figure read off a chart or a range is lower than one printed in a table.",
    "- sourceIndexes lists the source indexes (0 based, in the order given) that carry the figure.",
    "- Return one verdict per peer and rate given, and nothing for a rate that was not given.",
  ].join("\n");
}

/** The user prompt: the client company, then every peer with its printed rates and their sources. Pure. */
export function peerValidationPrompt(
  company: PeerPromptCompany,
  peers: readonly PeerCompany[],
): string {
  const header = [
    `Client company: ${company.name}`,
    `Country: ${company.country}`,
    `Industry section: ${company.section} (${company.sectionName})`,
  ].join("\n");
  const blocks = peers.map((peer, peerIndex) => {
    const rates = (["ltifr", "trifr"] as const).flatMap((key) => {
      const rate = peer[key];
      if (!rate) return [];
      return [
        [
          `  ${key}: ${rate.value} (unit as printed: ${rate.unit}), year ${rate.periodYear}, basis ${rate.basis ?? "not stated"}`,
          `    sources:\n      [0] ${rate.sourceTitle ?? "untitled"} <${rate.sourceUrl}>`,
        ].join("\n"),
      ];
    });
    return [
      `Peer ${peerIndex} — ${peer.name} (${peer.country}), headcount ${peer.headcount ?? "unknown"}${
        peer.headcountYear ? ` in ${peer.headcountYear}` : ""
      }, website ${peer.website ?? "unknown"}:`,
      rates.length > 0 ? rates.join("\n") : "  no rates given",
    ].join("\n");
  });
  return [header, "", `Peers (${peers.length}):`, ...blocks].join("\n");
}
