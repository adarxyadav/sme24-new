import { inRange, type KpiKey, MIN_PERIOD_YEAR } from "@/features/research/catalogue";
import type { DroppedValue, KpiSource } from "@/features/research/summary";
import type { Candidate } from "./candidates";
import { basisPrior } from "./provider";

/**
 * The rules that decide which values are stored (spec 0007, AC-5): a value is dropped when the
 * validator found the excerpt does not support it (`unsupported`), when nothing parsed
 * (`unparseable`), when it sits outside the catalogue range (`out_of_range`), when its year is
 * outside 2000 to the current year (`bad_year`), or when the same KPI and year appear twice
 * (`conflict`: the source host equal to the company website host wins, else the higher
 * confidence, else the first in provider order; the loser's sources join the winner's). Every drop
 * is recorded with its reason. Pure.
 */

/** What the validator says about one candidate (slice 3); absent when validation was skipped. */
export type Verdict = {
  readonly supported: boolean;
  /** The value converted to the catalogue unit, or null when the validator could not parse it. */
  readonly value: number | null;
  readonly periodYear: number | null;
  readonly confidence: number;
  readonly reason?: string;
};

export type KeptValue = {
  readonly key: KpiKey;
  readonly periodYear: number;
  readonly value: number;
  readonly confidence: number;
  readonly sources: readonly KpiSource[];
};

/** Confidence cap when the validation pass was skipped (AC-5). */
export const SKIPPED_CONFIDENCE_CAP = 0.5;

type Scored = KeptValue & { readonly order: number };

export type ResolveInput = {
  readonly candidates: readonly Candidate[];
  /** Verdicts keyed by the candidate's field; null when validation was skipped. */
  readonly verdicts: ReadonlyMap<string, Verdict> | null;
  readonly companyHost: string | null;
  readonly currentYear: number;
};

export function resolveValues({ candidates, verdicts, companyHost, currentYear }: ResolveInput): {
  readonly kept: readonly KeptValue[];
  readonly dropped: readonly DroppedValue[];
} {
  const dropped: DroppedValue[] = [];
  const scored: Scored[] = [];

  for (const [order, candidate] of candidates.entries()) {
    const verdict = verdicts?.get(candidate.field) ?? null;
    const value = verdicts ? (verdict?.value ?? null) : candidate.value;
    const year = verdicts ? (verdict?.periodYear ?? candidate.year) : candidate.year;
    const confidence = verdicts
      ? (verdict?.confidence ?? 0)
      : Math.min(basisPrior(candidate.basisConfidence), SKIPPED_CONFIDENCE_CAP);
    const reason = dropReason({ verdicts, verdict, candidate, value, year, currentYear });
    if (reason) {
      dropped.push({ key: candidate.key, year, value, reason });
      continue;
    }
    scored.push({
      key: candidate.key,
      periodYear: year as number,
      value: value as number,
      confidence,
      sources: candidate.sources,
      order,
    });
  }

  const winners = new Map<string, Scored>();
  for (const entry of scored) {
    const slot = `${entry.key}:${entry.periodYear}`;
    const current = winners.get(slot);
    if (!current) {
      winners.set(slot, entry);
      continue;
    }
    const winner = pickWinner(current, entry, companyHost);
    const loser = winner === current ? entry : current;
    winners.set(slot, { ...winner, sources: [...winner.sources, ...loser.sources] });
    dropped.push({
      key: loser.key,
      year: loser.periodYear,
      value: loser.value,
      reason: "conflict",
    });
  }

  const kept = [...winners.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...value }) => value);
  return { kept, dropped };
}

/** Why a candidate is dropped, or null when it is kept (AC-5). Pure. */
function dropReason({
  verdicts,
  verdict,
  candidate,
  value,
  year,
  currentYear,
}: {
  readonly verdicts: ReadonlyMap<string, Verdict> | null;
  readonly verdict: Verdict | null;
  readonly candidate: Candidate;
  readonly value: number | null;
  readonly year: number | null;
  readonly currentYear: number;
}): DroppedValue["reason"] | null {
  if (verdicts && !verdict?.supported) return "unsupported";
  if (value === null) return "unparseable";
  if (!inRange(candidate.key, value)) return "out_of_range";
  if (year === null || year < MIN_PERIOD_YEAR || year > currentYear) return "bad_year";
  return null;
}

/** The company's own site wins, else the higher confidence, else the earlier candidate. Pure. */
function pickWinner(a: Scored, b: Scored, companyHost: string | null): Scored {
  const own = (entry: Scored) =>
    companyHost !== null && entry.sources.some((source) => hostOf(source.url) === companyHost);
  const aOwn = own(a);
  const bOwn = own(b);
  if (aOwn !== bOwn) return aOwn ? a : b;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  return a.order <= b.order ? a : b;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
