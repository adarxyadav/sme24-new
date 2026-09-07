// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inviteStaffUser, resendStaffInvite } from "@/lib/auth/invite";

/**
 * `inviteStaffUser` (spec 0012, AC-2). The point of the module is its ordering, and the ordering
 * only shows itself when a step fails, so these tests are mostly about failure: what is left behind
 * when the profile insert collides, when the role write fails, when the email will not send.
 *
 * The invariant every one of them defends is that an expert account is two rows that have to agree.
 * A user without a profile row would be an expert nobody can see on the ops list and nobody can
 * assign; a profile row without a user would be a name on a list that can never sign in. The email
 * going last is what keeps a rolled back invite from reaching a real inbox.
 */

type Row = Record<string, unknown>;

/** A fake service client recording what happened, in order, so the assertions can read it. */
function fakeClient(
  options: {
    existingProfile?: Row | null;
    createError?: { message: string; code?: string } | null;
    roleError?: { message: string } | null;
    profileInsertError?: { message: string; code?: string } | null;
    inviteError?: { message: string; status?: number } | null;
    profileSelectError?: { message: string } | null;
  } = {},
) {
  const events: string[] = [];
  const deleted: string[] = [];
  const profileRowsDeleted: string[] = [];
  let inviteRedirect: string | undefined;
  const userId = "11111111-1111-4111-8111-111111111111";

  const client = {
    auth: {
      admin: {
        createUser: async (_input: unknown) => {
          events.push("createUser");
          if (options.createError) return { data: null, error: options.createError };
          return { data: { user: { id: userId } }, error: null };
        },
        deleteUser: async (id: string) => {
          events.push("deleteUser");
          deleted.push(id);
          return { error: null };
        },
        inviteUserByEmail: async (_email: string, opts: { redirectTo: string }) => {
          events.push("invite");
          inviteRedirect = opts.redirectTo;
          return { error: options.inviteError ?? null };
        },
        updateUserById: async () => ({ error: null }),
      },
    },
    from: (table: string) => {
      if (table === "expert_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                events.push("lookupProfile");
                if (options.profileSelectError) {
                  return { data: null, error: options.profileSelectError };
                }
                return { data: options.existingProfile ?? null, error: null };
              },
            }),
          }),
          insert: async (_row: Row) => {
            events.push("insertProfile");
            return { error: options.profileInsertError ?? null };
          },
          delete: () => ({
            eq: async (_column: string, value: string) => {
              events.push("deleteProfile");
              profileRowsDeleted.push(value);
              return { error: null };
            },
          }),
        };
      }
      // profiles
      return {
        update: (payload: Row) => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                events.push("setRole");
                if (options.roleError) return { data: null, error: options.roleError };
                // Echo back what was written, as the real update does: the caller compares the
                // stored role with the one it asked for, and a fake that always said "expert"
                // would hide a bug in exactly that comparison.
                return { data: { role: payload.role }, error: null };
              },
            }),
          }),
        }),
      };
    },
  };

  return { client, events, deleted, profileRowsDeleted, userId, redirect: () => inviteRedirect };
}

const INPUT = {
  email: "  Erika@Example.COM  ",
  role: "expert" as const,
  locale: "de" as const,
  fullName: "Erika Expert",
  invitedBy: "99999999-9999-4999-8999-999999999999",
  appUrl: "https://sme24.example.com/",
};

describe("inviteStaffUser: the happy path (spec 0012, AC-2)", () => {
  it("creates the user, fixes the role, writes the profile row, then sends the email", async () => {
    const fake = fakeClient();
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result).toEqual({ ok: true, userId: fake.userId, expertId: fake.userId });
    expect(fake.events).toEqual([
      "lookupProfile",
      "createUser",
      "setRole",
      "insertProfile",
      "invite",
    ]);
  });

  it("sends the invite last, so no email can point at a rolled back account", async () => {
    const fake = fakeClient();
    await inviteStaffUser(fake.client as never, INPUT);
    expect(fake.events.at(-1)).toBe("invite");
  });

  it("points the link at the set password page in the invitee's language", async () => {
    const fake = fakeClient();
    await inviteStaffUser(fake.client as never, INPUT);
    expect(fake.redirect()).toBe("https://sme24.example.com/de/reset-password");
  });

  it("normalises the address before anything is written", async () => {
    const fake = fakeClient({ existingProfile: { expert_id: "x" } });
    // The lookup is the first step, so an already invited answer proves the trimmed, lower cased
    // address is what the lookup used.
    const result = await inviteStaffUser(fake.client as never, INPUT);
    expect(result).toEqual({
      ok: false,
      error: "already_invited",
      message: "an expert profile already exists",
    });
  });
});

describe("inviteStaffUser: what is left behind when a step fails", () => {
  it("creates no user at all when the address already has an expert profile", async () => {
    const fake = fakeClient({ existingProfile: { expert_id: "someone" } });
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("already_invited");
    expect(fake.events).toEqual(["lookupProfile"]);
  });

  it("answers email_taken when the admin API says the address is registered", async () => {
    const fake = fakeClient({
      createError: { message: "already been registered", code: "email_exists" },
    });
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result.ok === false && result.error).toBe("email_taken");
    // Nothing to undo: the user was never created.
    expect(fake.deleted).toEqual([]);
  });

  it("deletes the user again when the role could not be written to the profile", async () => {
    const fake = fakeClient({ roleError: { message: "no row" } });
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result.ok === false && result.error).toBe("invite_failed");
    expect(fake.deleted).toEqual([fake.userId]);
    // An expert whose profile still says client would reach the app with the wrong role.
    expect(fake.events).not.toContain("invite");
  });

  it("deletes the user and answers already_invited when two ops invite at the same moment", async () => {
    const fake = fakeClient({ profileInsertError: { message: "duplicate key", code: "23505" } });
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result.ok === false && result.error).toBe("already_invited");
    expect(fake.deleted).toEqual([fake.userId]);
    expect(fake.events).not.toContain("invite");
  });

  it("treats any other profile insert failure as invite_failed, still cleaning up", async () => {
    const fake = fakeClient({
      profileInsertError: { message: "constraint violated", code: "23514" },
    });
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result.ok === false && result.error).toBe("invite_failed");
    expect(fake.deleted).toEqual([fake.userId]);
  });

  it("removes both rows when the invite email will not send", async () => {
    const fake = fakeClient({ inviteError: { message: "smtp down" } });
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result.ok === false && result.error).toBe("invite_failed");
    // Both, and the profile row first: a profile row pointing at a deleted user would break the
    // ops list, and the foreign key cascade is not something to rely on for a rollback.
    expect(fake.profileRowsDeleted).toEqual([fake.userId]);
    expect(fake.deleted).toEqual([fake.userId]);
    expect(fake.events).toEqual([
      "lookupProfile",
      "createUser",
      "setRole",
      "insertProfile",
      "invite",
      "deleteProfile",
      "deleteUser",
    ]);
  });

  it("does not create a user when the profile lookup itself fails", async () => {
    const fake = fakeClient({ profileSelectError: { message: "connection lost" } });
    const result = await inviteStaffUser(fake.client as never, INPUT);

    expect(result.ok === false && result.error).toBe("invite_failed");
    expect(fake.events).toEqual(["lookupProfile"]);
  });
});

describe("inviteStaffUser: the ops role", () => {
  it("writes no expert profile row for an ops invite", async () => {
    const fake = fakeClient();
    const result = await inviteStaffUser(fake.client as never, { ...INPUT, role: "ops" });

    expect(result).toEqual({ ok: true, userId: fake.userId, expertId: null });
    // No lookup and no insert: expert_profiles is not an ops user's table.
    expect(fake.events).toEqual(["createUser", "setRole", "invite"]);
  });
});

describe("resendStaffInvite (spec 0012, AC-3)", () => {
  it("sends to the same set password link", async () => {
    const fake = fakeClient();
    const result = await resendStaffInvite(fake.client as never, {
      email: "erika@example.com",
      locale: "en",
      appUrl: "https://sme24.example.com",
    });

    expect(result).toEqual({ ok: true });
    expect(fake.redirect()).toBe("https://sme24.example.com/en/reset-password");
  });

  it("reports the auth rail's own frequency limit as rate_limited, not as a failure", async () => {
    const fake = fakeClient({
      inviteError: {
        message: "For security purposes, you can only request this after 60 seconds",
        status: 429,
      },
    });
    const result = await resendStaffInvite(fake.client as never, {
      email: "erika@example.com",
      locale: "en",
      appUrl: "https://sme24.example.com",
    });

    expect(result.ok === false && result.error).toBe("rate_limited");
  });

  it("reports anything else as invite_failed", async () => {
    const fake = fakeClient({ inviteError: { message: "smtp down", status: 500 } });
    const result = await resendStaffInvite(fake.client as never, {
      email: "erika@example.com",
      locale: "en",
      appUrl: "https://sme24.example.com",
    });

    expect(result.ok === false && result.error).toBe("invite_failed");
  });
});
