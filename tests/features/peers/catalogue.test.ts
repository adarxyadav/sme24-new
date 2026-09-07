import { describe, expect, it } from "vitest";
import { PEER_SET_EXCLUDED_KPIS, PEER_SET_MIN, SIZE_BANDS } from "@/features/benchmark/catalogue";
import {
  HOUSE_ORGANIZATION_ID,
  HOUSE_RUN_LIMIT_PER_DAY,
  isPeerStatus,
  MAX_PEERS_PER_SET,
  MIN_PEERS_FOR_SET,
  PEER_EXCLUDED_KPIS,
  PEER_LABELS,
  PEER_REFRESH_BATCH,
  PEER_REFRESH_MAX_FAILURES,
  PEER_REFRESH_MONTHS,
  PEER_SECTIONS,
  PEER_SIZE_BANDS,
  PEER_STATUSES,
  refreshDueBefore,
} from "@/features/peers/catalogue";
import { RUN_LIMIT_PER_DAY } from "@/features/research/catalogue";

/**
 * The peer catalogue (spec 0012): the constants the SQL side mirrors, the label set that matches
 * the database check, the statuses, and the refresh window. A drift here is a drift against the
 * migration, which is why each one is pinned.
 */
describe("the peer catalogue (spec 0012)", () => {
  it("names the house organization exactly as the migration seeds it", () => {
    expect(HOUSE_ORGANIZATION_ID).toBe("99999999-9999-4999-8999-999999999999");
  });

  it("gives the house organization a higher run limit than a client organization", () => {
    expect(HOUSE_RUN_LIMIT_PER_DAY).toBe(50);
    expect(HOUSE_RUN_LIMIT_PER_DAY).toBeGreaterThan(RUN_LIMIT_PER_DAY);
  });

  it("holds ten labels, Peer A to Peer J, each matching the database check", () => {
    expect(MAX_PEERS_PER_SET).toBe(10);
    expect(PEER_LABELS).toHaveLength(MAX_PEERS_PER_SET);
    expect(PEER_LABELS[0]).toBe("Peer A");
    expect(PEER_LABELS.at(-1)).toBe("Peer J");
    for (const label of PEER_LABELS) expect(label).toMatch(/^Peer [A-J]$/);
  });

  it("names the four statuses and recognises them", () => {
    expect([...PEER_STATUSES]).toEqual(["proposed", "approved", "rejected", "retired"]);
    expect(isPeerStatus("approved")).toBe(true);
    expect(isPeerStatus("archived")).toBe(false);
    expect(isPeerStatus(null)).toBe(false);
  });

  it("takes the peer set rules from the benchmark model rather than repeating them", () => {
    expect(MIN_PEERS_FOR_SET).toBe(PEER_SET_MIN);
    expect(PEER_EXCLUDED_KPIS).toBe(PEER_SET_EXCLUDED_KPIS);
  });

  it("carries the 21 NOGA sections and the four size bands", () => {
    expect(PEER_SECTIONS).toHaveLength(21);
    expect(PEER_SECTIONS[0]).toBe("A");
    expect(PEER_SECTIONS.at(-1)).toBe("U");
    expect(PEER_SIZE_BANDS).toBe(SIZE_BANDS);
  });

  it("puts the refresh window twelve months back and bounds the batch and the failures", () => {
    expect(PEER_REFRESH_MONTHS).toBe(12);
    expect(PEER_REFRESH_BATCH).toBe(10);
    expect(PEER_REFRESH_MAX_FAILURES).toBe(3);
    const due = refreshDueBefore(new Date("2026-09-07T10:00:00.000Z"));
    expect(due.toISOString()).toBe("2025-09-07T10:00:00.000Z");
  });

  it("moves the refresh window across a year boundary", () => {
    expect(refreshDueBefore(new Date("2026-01-15T00:00:00.000Z")).toISOString()).toBe(
      "2025-01-15T00:00:00.000Z",
    );
  });
});
