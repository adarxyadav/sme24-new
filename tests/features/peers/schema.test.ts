import { describe, expect, it } from "vitest";
import {
  ALL,
  addPeerSchema,
  peerFiltersSchema,
  peerListQuery,
  proposePeersSchema,
  rejectPeerSchema,
  researchPeersSchema,
} from "@/features/peers/schema";

/**
 * The peers boundary schemas (spec 0012, AC-1 to AC-4): the list filters fall back rather than
 * throw, the hand added peer normalises its website, the proposal bounds its count, and the
 * research batch bounds its ids.
 */
describe("peerFiltersSchema", () => {
  it("defaults every filter to all and keeps a valid one", () => {
    expect(peerFiltersSchema.parse({})).toEqual({ section: ALL, sizeBand: ALL, status: ALL });
    expect(peerFiltersSchema.parse({ section: "C", sizeBand: "250+", status: "approved" })).toEqual(
      {
        section: "C",
        sizeBand: "250+",
        status: "approved",
      },
    );
  });

  it("falls back rather than throwing on a bad value from the URL", () => {
    expect(peerFiltersSchema.parse({ section: "Z", sizeBand: "huge", status: "gone" })).toEqual({
      section: ALL,
      sizeBand: ALL,
      status: ALL,
    });
  });
});

describe("peerListQuery", () => {
  it("drops the defaults and keeps what was chosen", () => {
    expect(peerListQuery({})).toBe("");
    expect(peerListQuery({ section: ALL, sizeBand: ALL, status: ALL })).toBe("");
    expect(peerListQuery({ section: "C", status: "approved" })).toBe("?section=C&status=approved");
  });
});

describe("addPeerSchema (AC-1)", () => {
  const base = { name: "Muster AG", section: "C", sizeBand: "50-249" };

  it("normalises the website to an origin and empties to null", () => {
    expect(addPeerSchema.parse({ ...base, website: "Example.CH/reports?x=1" }).website).toBe(
      "https://example.ch",
    );
    expect(addPeerSchema.parse({ ...base, website: "" }).website).toBeNull();
    expect(addPeerSchema.parse({ ...base, legalName: "" }).legalName).toBeNull();
  });

  it("refuses a short name, an unknown section and a bad website", () => {
    expect(addPeerSchema.safeParse({ ...base, name: "M" }).success).toBe(false);
    expect(addPeerSchema.safeParse({ ...base, section: "Z" }).success).toBe(false);
    expect(addPeerSchema.safeParse({ ...base, sizeBand: "huge" }).success).toBe(false);
    expect(addPeerSchema.safeParse({ ...base, website: "not a host" }).success).toBe(false);
  });
});

describe("proposePeersSchema (AC-2)", () => {
  it("defaults the count to ten and accepts a number as a string from the form", () => {
    expect(proposePeersSchema.parse({ section: "C", sizeBand: "all" }).count).toBe(10);
    expect(proposePeersSchema.parse({ section: "C", sizeBand: "all", count: "4" }).count).toBe(4);
  });

  it("bounds the count to the size of one set", () => {
    expect(proposePeersSchema.safeParse({ section: "C", sizeBand: "all", count: 0 }).success).toBe(
      false,
    );
    expect(proposePeersSchema.safeParse({ section: "C", sizeBand: "all", count: 11 }).success).toBe(
      false,
    );
  });
});

describe("researchPeersSchema and rejectPeerSchema (AC-3, AC-4)", () => {
  const id = "0e000000-0000-4000-8000-000000000001";

  it("needs at least one id and refuses something that is not a uuid", () => {
    expect(researchPeersSchema.parse({ peerIds: [id] }).peerIds).toEqual([id]);
    expect(researchPeersSchema.safeParse({ peerIds: [] }).success).toBe(false);
    expect(researchPeersSchema.safeParse({ peerIds: ["nope"] }).success).toBe(false);
  });

  it("empties a blank rejection reason to null and bounds a long one", () => {
    expect(rejectPeerSchema.parse({ peerId: id, reason: "  " }).reason).toBeNull();
    expect(rejectPeerSchema.parse({ peerId: id, reason: "Wrong industry" }).reason).toBe(
      "Wrong industry",
    );
    expect(rejectPeerSchema.safeParse({ peerId: id, reason: "x".repeat(501) }).success).toBe(false);
  });
});
