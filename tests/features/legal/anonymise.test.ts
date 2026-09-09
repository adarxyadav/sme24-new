import { beforeEach, describe, expect, it, vi } from "vitest";
import { anonymisePerson } from "@/features/legal/anonymise";

vi.mock("server-only", () => ({}));

/**
 * The anonymisation routine of a fulfilled deletion request (spec 0015, AC-15).
 *
 * The regression these tests exist for: `updateUserById` was called with `user_metadata: {}`, and
 * GoTrue MERGES metadata rather than replacing it, so the call returned success while the person's
 * real name stayed in `auth.users.raw_user_meta_data`. Nothing in the suite noticed, because the
 * routine still answered `authScrubbed: true` and no test looked at the payload it sent. These
 * assert the payload itself: a key is cleared only when it is sent explicitly as null.
 *
 * The live stack half of the proof is in `e2e/legal.spec.ts`, which fulfils a real deletion and
 * reads `raw_user_meta_data` back. jsdom cannot catch that, which is the same shape of gap the ICU
 * grouping hydration bug left.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";

/** The metadata a password sign up leaves behind, plus the key GoTrue owns and the app must keep. */
const SIGN_UP_METADATA = {
  email_verified: true,
  full_name: "Real Person",
  organization_name: "ACME AG",
  locale: "de",
  terms_accepted_at: "2026-01-01T00:00:00.000Z",
  terms_version: "1",
} as const;

type UpdateCall = { readonly id: string; readonly attributes: Record<string, unknown> };

/**
 * A service client stub recording what the routine sent. Only the calls `anonymisePerson` makes
 * are modelled; anything else would throw as an unknown table, so a widened routine fails loudly
 * rather than passing on a stub that quietly accepted it.
 */
function stubClient(options: { readonly metadata?: Record<string, unknown> } = {}) {
  const updates: UpdateCall[] = [];
  const profileUpdates: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      if (table === "profiles") {
        return {
          update(values: Record<string, unknown>) {
            profileUpdates.push(values);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "expert_profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: {
            user: { id, user_metadata: options.metadata ?? { ...SIGN_UP_METADATA } },
          },
          error: null,
        }),
        updateUserById: async (id: string, attributes: Record<string, unknown>) => {
          updates.push({ id, attributes });
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };

  // The stub models only what the routine touches, so the cast is to the parameter type rather
  // than a pretence of being a whole `SupabaseClient`.
  return {
    client: client as unknown as Parameters<typeof anonymisePerson>[0],
    updates,
    profileUpdates,
  };
}

/** The `user_metadata` payload of the scrub call, the one the ban call does not carry. */
function scrubPayload(updates: readonly UpdateCall[]) {
  const call = updates.find((entry) => "user_metadata" in entry.attributes);
  return call?.attributes.user_metadata as Record<string, unknown> | undefined;
}

describe("anonymisePerson: the auth metadata scrub", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends every metadata key the user carries as an explicit null", async () => {
    const { client, updates } = stubClient();

    await anonymisePerson(client, USER_ID);

    const payload = scrubPayload(updates);
    // The regression in one assertion: `{}` is a silent no op against GoTrue's merge, so an empty
    // payload means nothing was cleared however successful the call looked.
    expect(payload).not.toEqual({});
    for (const key of Object.keys(SIGN_UP_METADATA)) {
      expect(payload, `${key} must be sent as null to be removed`).toHaveProperty(key, null);
    }
  });

  it("clears a key it was never told about, so a sixth sign up field cannot survive", async () => {
    // The nulls are derived from the keys the user actually carries rather than a hard coded list,
    // which is what keeps this true as sign up grows. `avatar_url` is what an OAuth sign in adds.
    const { client, updates } = stubClient({
      metadata: {
        full_name: "Real Person",
        avatar_url: "https://example.test/face.png",
        nickname: "rp",
      },
    });

    await anonymisePerson(client, USER_ID);

    expect(scrubPayload(updates)).toEqual({ full_name: null, avatar_url: null, nickname: null });
  });

  it("scrubs the email in the same call as the metadata", async () => {
    const { client, updates } = stubClient();

    await anonymisePerson(client, USER_ID);

    const call = updates.find((entry) => "user_metadata" in entry.attributes);
    expect(call?.attributes.email).toBe(`deleted+${USER_ID}@invalid.sme24.ch`);
  });

  it("still ends the ability to sign in, and reports the scrub it actually performed", async () => {
    const { client, updates, profileUpdates } = stubClient();

    const outcome = await anonymisePerson(client, USER_ID);

    // The ban is a separate call, and it is what actually closes the account (`banStaffUser`).
    expect(updates.some((entry) => "ban_duration" in entry.attributes)).toBe(true);
    expect(profileUpdates).toEqual([{ full_name: null }]);
    expect(outcome).toEqual({
      profileCleared: true,
      authScrubbed: true,
      expertCleared: false,
      photoRemoved: false,
    });
  });

  it("sends an empty payload only when the user carries no metadata at all", async () => {
    // The one case where `{}` is the honest payload: there is nothing to remove. Asserted so the
    // derivation is not mistaken for a rule that always sends keys.
    const { client, updates } = stubClient({ metadata: {} });

    await anonymisePerson(client, USER_ID);

    expect(scrubPayload(updates)).toEqual({});
  });

  it("leaves the request open rather than reporting a scrub it could not read", async () => {
    const { client } = stubClient();
    vi.spyOn(client.auth.admin, "getUserById").mockResolvedValue({
      data: { user: null },
      error: { message: "auth is down" },
    } as never);

    // A throw is the contract: `updateDataRequest` turns it into a typed `unexpected` and leaves
    // the request open, rather than recording a fulfilment that did not happen.
    await expect(anonymisePerson(client, USER_ID)).rejects.toThrow(/auth read/);
  });
});
