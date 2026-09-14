import { websiteHost } from "@/features/research/schema";
import type { DroppedPeer, PeerRung } from "@/features/research/summary";
import type { PeerVerdict } from "@/lib/ai/schemas/peer-validation";
import { type PeerCompany, valuePerMillionHours } from "./peer-schema";
import { SKIPPED_CONFIDENCE_CAP } from "./resolve";
import type { PeerVerdictKey } from "./validate-peers";
import { verdictKey } from "./validate-peers";

/**
 * The rules that decide which peers of a search are kept and which rung the comparison sits on
 * (spec 0022, AC-7, AC-8). Every arithmetic step is here rather than trusted from the provider: the
 * value per million hours comes from the printed value and the unit enum, a peer whose name or
 * website says it is the client itself is dropped as `self`, a peer left without one supported rate
 * is dropped as `unsupported`, and the rung is the first of country, region, world that holds at
 * least three peers with a usable rate. Pure.
 */

/** The fewest peers a rung needs before the ladder stops there (AC-7). */
export const PEER_RUNG_MINIMUM = 3;

/** One rate of one kept peer, ready to become a `research_peers` row (AC-10). */
export type KeptPeerRate = {
  readonly kpiKey: "ltifr" | "trifr";
  readonly periodYear: number;
  /** Per million hours worked, converted in code from the two fields below (AC-8). */
  readonly value: number;
  readonly valueAsPublished: number;
  readonly unitAsPublished: string;
  readonly basis: "employees" | "employees_and_contractors" | null;
  readonly sourceUrl: string;
  readonly sourceTitle: string | null;
  readonly confidence: number;
};

/** A peer that survived the drops, with at least one usable rate (AC-7). */
export type KeptPeer = {
  readonly name: string;
  readonly website: string | null;
  readonly country: string;
  readonly headcount: number | null;
  readonly headcountYear: number | null;
  readonly rates: readonly KeptPeerRate[];
};

export type ResolvePeersInput = {
  readonly peers: readonly PeerCompany[];
  /** Verdicts keyed by `<peerIndex>:<kpiKey>`; null when the validation call was skipped (AC-8). */
  readonly verdicts: ReadonlyMap<PeerVerdictKey, PeerVerdict> | null;
  readonly clientName: string;
  readonly clientWebsite: string | null;
  readonly country: string;
  readonly regionCountries: readonly string[];
};

export type ResolvePeersOutput = {
  readonly kept: readonly KeptPeer[];
  readonly dropped: readonly DroppedPeer[];
  /** Null when nothing was kept; the same value goes on every stored row (AC-7). */
  readonly rung: PeerRung | null;
  /** True when the comparison rests on fewer than three peers, worldwide included (AC-7). */
  readonly thin: boolean;
};

/**
 * The legal forms dropped from a name before two spellings are compared. Matched on the spelling
 * that survives the steps above: the dots of an abbreviation are removed rather than turned into
 * spaces, so `S.A.` arrives as `sa` and one entry covers both spellings.
 */
const LEGAL_FORMS =
  /\b(ag|sa|spa|srl|sas|sarl|gmbh|mbh|nv|bv|plc|ltd|limited|llc|inc|incorporated|corp|corporation|co|company|holding|holdings|group|groupe|gruppe|se|kg|ohg|oy|oyj|ab|kft|zrt|sp ?z ?oo)\b/g;

/**
 * A company name reduced to what two spellings of the same company share: lower case, accents,
 * punctuation and legal form gone, one space between words. The dots of an abbreviation go before
 * the other punctuation becomes whitespace, so `S.p.A.` and `SpA` normalise alike. Pure.
 */
export function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b([a-z])\.(?=[a-z]\.|\s|$)/g, "$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the peer is the client company under another spelling (AC-8): either normalised name
 * contains the other, or the two websites share a host. An empty normalised client name never
 * matches, so a company called only by its legal form does not swallow every peer. Pure.
 */
export function isSelfPeer(
  peer: Pick<PeerCompany, "name" | "website">,
  clientName: string,
  clientHost: string | null,
): boolean {
  const host = websiteHost(peer.website);
  if (clientHost && host && host === clientHost) return true;
  const client = normaliseCompanyName(clientName);
  const candidate = normaliseCompanyName(peer.name);
  if (!client || !candidate) return false;
  return candidate.includes(client) || client.includes(candidate);
}

/**
 * The rates of one peer that survive the unit conversion and the validator (AC-8): a unit outside
 * the three enum values yields nothing, and with verdicts present a rate the cited page does not
 * state is skipped. Without verdicts every convertible rate is kept at the skipped cap. Pure.
 */
function keptRatesOf(
  peer: PeerCompany,
  peerIndex: number,
  verdicts: ReadonlyMap<PeerVerdictKey, PeerVerdict> | null,
): readonly KeptPeerRate[] {
  return (["ltifr", "trifr"] as const).flatMap((kpiKey) => {
    const rate = peer[kpiKey];
    if (!rate) return [];
    const value = valuePerMillionHours(rate.value, rate.unit);
    if (value === null) return [];
    if (!verdicts) {
      return [
        {
          kpiKey,
          periodYear: rate.periodYear,
          value,
          valueAsPublished: rate.value,
          unitAsPublished: rate.unit,
          basis: rate.basis,
          sourceUrl: rate.sourceUrl,
          sourceTitle: rate.sourceTitle,
          confidence: SKIPPED_CONFIDENCE_CAP,
        },
      ];
    }
    const verdict = verdicts.get(verdictKey(peerIndex, kpiKey));
    if (!verdict?.supported) return [];
    return [
      {
        kpiKey,
        periodYear: verdict.periodYear ?? rate.periodYear,
        value,
        valueAsPublished: rate.value,
        unitAsPublished: rate.unit,
        basis: rate.basis,
        sourceUrl: rate.sourceUrl,
        sourceTitle: rate.sourceTitle,
        confidence: verdict.confidence,
      },
    ];
  });
}

/**
 * The rung the kept peers sit on and the peers of that rung (AC-7): the client's country when at
 * least three peers are headquartered there, else the region's countries when at least three are,
 * else every peer. Fewer than three even worldwide keeps what there is and says so. Pure.
 */
export function climbRung(
  peers: readonly KeptPeer[],
  country: string,
  regionCountries: readonly string[],
): { readonly rung: PeerRung | null; readonly peers: readonly KeptPeer[]; readonly thin: boolean } {
  if (peers.length === 0) return { rung: null, peers: [], thin: true };
  const region = new Set(regionCountries);
  const home = peers.filter((peer) => peer.country === country);
  if (home.length >= PEER_RUNG_MINIMUM) return { rung: "country", peers: home, thin: false };
  const regional = peers.filter((peer) => region.has(peer.country));
  if (regional.length >= PEER_RUNG_MINIMUM) return { rung: "region", peers: regional, thin: false };
  return { rung: "world", peers, thin: peers.length < PEER_RUNG_MINIMUM };
}

/** Applies the drops of AC-8 and then the ladder of AC-7 to one provider answer. Pure. */
export function resolvePeers({
  peers,
  verdicts,
  clientName,
  clientWebsite,
  country,
  regionCountries,
}: ResolvePeersInput): ResolvePeersOutput {
  const clientHost = websiteHost(clientWebsite);
  const dropped: DroppedPeer[] = [];
  const survived: KeptPeer[] = [];

  for (const [peerIndex, peer] of peers.entries()) {
    if (isSelfPeer(peer, clientName, clientHost)) {
      dropped.push({ name: peer.name, reason: "self" });
      continue;
    }
    const rates = keptRatesOf(peer, peerIndex, verdicts);
    if (rates.length === 0) {
      dropped.push({ name: peer.name, reason: "unsupported" });
      continue;
    }
    survived.push({
      name: peer.name,
      website: peer.website,
      country: peer.country,
      headcount: peer.headcount,
      headcountYear: peer.headcountYear,
      rates,
    });
  }

  const climbed = climbRung(survived, country, regionCountries);
  // A peer the ladder left behind is not a drop: it was usable, just not on the rung the
  // comparison settled on (AC-7), so it is absent from `dropped` and from the table alike.
  return { kept: climbed.peers, dropped, rung: climbed.rung, thin: climbed.thin };
}
