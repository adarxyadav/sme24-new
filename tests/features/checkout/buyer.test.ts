// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buyerLabel, isCreditOrder } from "@/features/checkout/buyer";

/**
 * The one buyer label every alert and the ops list share (spec 0018, AC-10): an organization's
 * name for a client order, "Expert: <name>" for a credit pack order, never "Unknown organization"
 * for an expert.
 */

type Row = Record<string, unknown> | null;

/** A service client that answers one row per table by id. */
function client(rows: { organizations?: Row; profiles?: Row }) {
  const calls: { table: string; id: unknown }[] = [];
  const service = {
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: unknown) => {
          calls.push({ table, id });
          return {
            maybeSingle: async () => ({
              data: rows[table as keyof typeof rows] ?? null,
              error: null,
            }),
          };
        },
      }),
    }),
  };
  return { service: service as never, calls };
}

describe("buyerLabel", () => {
  it("names a client order by its organization", async () => {
    const { service, calls } = client({ organizations: { name: "Musterfirma AG" } });
    await expect(
      buyerLabel(service, { organization_id: "org-1", buyer_expert_id: null }),
    ).resolves.toBe("Musterfirma AG");
    expect(calls).toEqual([{ table: "organizations", id: "org-1" }]);
  });

  it("names an expert order by the expert, prefixed", async () => {
    const { service, calls } = client({ profiles: { full_name: "Erika Expert" } });
    await expect(
      buyerLabel(service, { organization_id: null, buyer_expert_id: "expert-1" }),
    ).resolves.toBe("Expert: Erika Expert");
    expect(calls).toEqual([{ table: "profiles", id: "expert-1" }]);
  });

  it("falls back to Expert when the profile has no name, never to Unknown organization", async () => {
    const { service } = client({ profiles: { full_name: "  " } });
    await expect(
      buyerLabel(service, { organization_id: null, buyer_expert_id: "expert-1" }),
    ).resolves.toBe("Expert");
  });

  it("answers Unknown organization for a client order whose organization is gone", async () => {
    const { service } = client({});
    await expect(
      buyerLabel(service, { organization_id: "org-gone", buyer_expert_id: null }),
    ).resolves.toBe("Unknown organization");
  });
});

describe("isCreditOrder", () => {
  it("is true only for an expert buyer with frozen credits", () => {
    expect(isCreditOrder({ organization_id: null, buyer_expert_id: "e", credits: 50 })).toBe(true);
    expect(isCreditOrder({ organization_id: "o", buyer_expert_id: null, credits: null })).toBe(
      false,
    );
  });
});
