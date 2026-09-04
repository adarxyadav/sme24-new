import { beforeEach, describe, expect, it, vi } from "vitest";

// The action client is the system boundary: the claims it returns and the update it receives.
const supabase = vi.hoisted(() => ({
  getClaims: vi.fn<() => Promise<{ data: { claims: { sub?: string } | null } }>>(),
  update: vi.fn(),
  eq: vi.fn<() => Promise<{ error: { message: string } | null }>>(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: { getClaims: supabase.getClaims },
    from: supabase.from,
  }),
}));

const { setLocale } = await import("@/features/localization/actions");

describe("setLocale (spec 0004, AC-2)", () => {
  beforeEach(() => {
    supabase.from.mockReturnValue({ update: supabase.update });
    supabase.update.mockReturnValue({ eq: supabase.eq });
    supabase.eq.mockResolvedValue({ error: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("writes the short code to the caller's own profile row and reports persisted", async () => {
    supabase.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    await expect(setLocale({ locale: "en" })).resolves.toEqual({
      ok: true,
      data: { persisted: true },
    });
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(supabase.update).toHaveBeenCalledWith({ locale: "en" });
    expect(supabase.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("returns ok without writing for a signed out visitor", async () => {
    supabase.getClaims.mockResolvedValue({ data: { claims: null } });
    await expect(setLocale({ locale: "de" })).resolves.toEqual({
      ok: true,
      data: { persisted: false },
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects anything but a known short code before touching the database", async () => {
    await expect(setLocale({ locale: "de-CH" })).resolves.toEqual({
      ok: false,
      error: "invalid_input",
    });
    await expect(setLocale({ locale: "fr" })).resolves.toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(supabase.getClaims).not.toHaveBeenCalled();
  });

  it("reports persist_failed on a database error instead of throwing", async () => {
    supabase.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    supabase.eq.mockResolvedValue({ error: { message: "connection reset" } });
    await expect(setLocale({ locale: "en" })).resolves.toEqual({
      ok: false,
      error: "persist_failed",
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
