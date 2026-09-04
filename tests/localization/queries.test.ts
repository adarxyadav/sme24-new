import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeForOrganization, localeForUser } from "@/features/localization/queries";
import type { Database } from "@/lib/supabase/database.types";

// The client is the boundary: which table and id are asked for, and what comes back.
const maybeSingle = vi.fn<() => Promise<{ data: { locale: string } | null; error: unknown }>>();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const client = { from } as unknown as SupabaseClient<Database>;

describe("stored locale queries (spec 0004, AC-7)", () => {
  beforeEach(() => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it("maps the user's short code to the next-intl locale", async () => {
    maybeSingle.mockResolvedValue({ data: { locale: "en" }, error: null });
    await expect(localeForUser(client, "user-1")).resolves.toBe("en-CH");
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("locale");
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("maps the organisation's short code to the next-intl locale", async () => {
    maybeSingle.mockResolvedValue({ data: { locale: "de" }, error: null });
    await expect(localeForOrganization(client, "org-1")).resolves.toBe("de-CH");
    expect(from).toHaveBeenCalledWith("organizations");
    expect(eq).toHaveBeenCalledWith("id", "org-1");
  });

  it("falls back to the default locale when no row exists, so a retried task never fails forever", async () => {
    await expect(localeForUser(client, "gone")).resolves.toBe("de-CH");
    await expect(localeForOrganization(client, "gone")).resolves.toBe("de-CH");
  });

  it("throws on a database error like every query", async () => {
    const error = new Error("connection reset");
    maybeSingle.mockResolvedValue({ data: null, error });
    await expect(localeForUser(client, "user-1")).rejects.toBe(error);
  });
});
