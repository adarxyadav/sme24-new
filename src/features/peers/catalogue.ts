import {
  NOGA_SECTIONS,
  PEER_SET_EXCLUDED_KPIS,
  PEER_SET_MIN,
  SIZE_BANDS,
} from "@/features/benchmark/catalogue";

/**
 * The peer catalogue (spec 0012): the house organization, the peer statuses and labels, the set
 * limits and the refresh constants. Pure data, runs anywhere; the SQL side mirrors the house id
 * in `private.house_organization_id()` and the run limit in `private.research_run_allowed`.
 */

/** The one ops owned organization every peer company belongs to; seeded by the peer_companies migration. */
export const HOUSE_ORGANIZATION_ID = "99999999-9999-4999-8999-999999999999";

/** Research runs the house organization may start per rolling 24 hours (AC-5); mirrors the SQL branch. */
export const HOUSE_RUN_LIMIT_PER_DAY = 50;

export const PEER_STATUSES = ["proposed", "approved", "rejected", "retired"] as const;
export type PeerStatus = (typeof PEER_STATUSES)[number];

/** True when `value` is one of the four peer statuses. Pure. */
export function isPeerStatus(value: unknown): value is PeerStatus {
  return typeof value === "string" && (PEER_STATUSES as readonly string[]).includes(value);
}

/** At most ten approved peers per section and band (AC-3), held by `public.approve_peer_company`. */
export const MAX_PEERS_PER_SET = 10;

/** The anonymous labels, one per slot of the set: `Peer A` to `Peer J`. */
export const PEER_LABELS: readonly string[] = Array.from(
  { length: MAX_PEERS_PER_SET },
  (_, index) => `Peer ${String.fromCharCode(65 + index)}`,
);

/** A KPI gets a peer set only when at least this many approved peers hold a value for it (AC-9); the model owns the rule. */
export const MIN_PEERS_FOR_SET = PEER_SET_MIN;

/** KPIs that never get a peer set (AC-9); the model owns the rule. */
export const PEER_EXCLUDED_KPIS = PEER_SET_EXCLUDED_KPIS;

/** A peer researched longer ago than this is due for a refresh (AC-14). */
export const PEER_REFRESH_MONTHS = 12;

/** Peers the daily schedule refreshes per run at most (AC-14). */
export const PEER_REFRESH_BATCH = 10;

/** Consecutive failed refreshes after which a peer is flagged and skipped by the schedule (AC-14). */
export const PEER_REFRESH_MAX_FAILURES = 3;

/** How many candidates one proposal asks the model for by default (AC-2). */
export const PEER_PROPOSAL_COUNT = 10;

/** Who put a peer on the list: the model or an ops user by hand. */
export const PEER_PROPOSERS = ["ai", "ops"] as const;
export type PeerProposer = (typeof PEER_PROPOSERS)[number];

/** The 21 section letters a peer set can belong to. */
export const PEER_SECTIONS = NOGA_SECTIONS.map((section) => section.letter) as readonly string[];

/** The size bands a peer set can belong to, the same four the benchmark uses. */
export const PEER_SIZE_BANDS = SIZE_BANDS;

/** The moment before which `researched_at` counts as stale, `PEER_REFRESH_MONTHS` before `now`. Pure. */
export function refreshDueBefore(now: Date): Date {
  const due = new Date(now.getTime());
  due.setUTCMonth(due.getUTCMonth() - PEER_REFRESH_MONTHS);
  return due;
}
