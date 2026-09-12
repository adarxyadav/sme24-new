// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECTORY_PAGE_SIZE } from "@/features/directory/catalogue";
import {
  getCreditBalance,
  getDirectoryOpsSummary,
  getDirectoryTotals,
  listUnlockedContacts,
  searchDirectory,
  unlockedContactsPage,
} from "@/features/directory/queries";
import { decodeSearchCursor } from "@/features/directory/schema";

/**
 * The directory reads (spec 0018, AC-4, AC-5, AC-13, AC-15): the keyset paging rule that decides
 * whether a "Mehr laden" link appears at all, the arguments each definer function receives, the
 * mapping of a `returns table` row (where every column reads as non null) onto the nullable shape
 * the page renders, and the promise that a database error throws rather than returning empty.
 * Only the Supabase client is replaced.
 */
type Row = Record<string, unknown>;

const rpc = vi.fn();
const counts = { companies: 0, contacts: 0, suppressed: 0, error: null as unknown };

/** A Supabase client stub: `rpc` for the definer functions, `from` for the three ops counts. */
const client = {
  rpc,
  from: (table: string) => ({
    select: () => {
      const key =
        table === "directory_companies"
          ? "companies"
          : table === "directory_contacts"
            ? "contacts"
            : "suppressed";
      // `getDirectoryTotals` awaits the builder itself, so the stub is a real promise carrying
      // the chain methods the other reads call.
      const answer = { count: counts[key as keyof typeof counts] as number, error: counts.error };
      const chain = Object.assign(Promise.resolve(answer), {
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      });
      return chain;
    },
  }),
} as unknown as SupabaseClient<never>;

/** A `directory_search` row as the function returns it: masked, with the raw three null. */
const searchRow = (index: number): Row => ({
  contact_id: `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  company_id: "a0000000-0000-4000-8000-000000000001",
  company_name: "Alpha Werke AG",
  company_name_normalised: "alpha werke ag",
  company_country: "CH",
  company_city: "Baar",
  first_name: "Erika",
  last_name: "Muster",
  contact_title: "Head of Safety",
  contact_country: null,
  contact_city: null,
  email_masked: "e••••@alpha.test",
  phone_masked: "+41 •• ••• •• 67",
  mobile_masked: null,
  unlocked: false,
  email: null,
  phone: null,
  mobile: null,
});

const unlockedRow = (index: number, at: string): Row => ({
  unlock_id: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  id: `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  company_name: "Alpha Werke AG",
  company_country: "CH",
  company_city: "Baar",
  first_name: "Erika",
  last_name: "Muster",
  contact_title: "Head of Safety",
  contact_country: null,
  contact_city: null,
  email: "erika.muster@alpha.test",
  phone: "+41 41 123 45 67",
  mobile: null,
  unlocked_at: at,
});

beforeEach(() => {
  vi.clearAllMocks();
  counts.companies = 0;
  counts.contacts = 0;
  counts.suppressed = 0;
  counts.error = null;
});

describe("searchDirectory (AC-4)", () => {
  it("passes only the filters that are set, plus the fixed page size", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await searchDirectory(client, { q: "alpha", title: undefined, country: "CH" }, null);

    expect(rpc).toHaveBeenCalledWith("directory_search", {
      q: "alpha",
      country: "CH",
      page_size: DIRECTORY_PAGE_SIZE,
    });
  });

  it("passes the cursor as three arguments the caller cannot set one by one", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const cursor = { name: "alpha werke ag", id: "c0000000-0000-4000-8000-000000000001", page: 3 };

    await searchDirectory(client, { q: undefined, title: undefined, country: undefined }, cursor);

    expect(rpc).toHaveBeenCalledWith("directory_search", {
      after_name: cursor.name,
      after_id: cursor.id,
      after_page: cursor.page,
      page_size: DIRECTORY_PAGE_SIZE,
    });
  });

  it("mints the next cursor from the last row of a full page, one page on", async () => {
    const rows = Array.from({ length: DIRECTORY_PAGE_SIZE }, (_, i) => searchRow(i + 1));
    rpc.mockResolvedValue({ data: rows, error: null });

    const page = await searchDirectory(
      client,
      { q: undefined, title: undefined, country: undefined },
      null,
    );

    expect(page.page).toBe(1);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeSearchCursor(page.nextCursor ?? undefined)).toEqual({
      name: "alpha werke ag",
      id: `c0000000-0000-4000-8000-${String(DIRECTORY_PAGE_SIZE).padStart(12, "0")}`,
      page: 2,
    });
  });

  it("offers no next cursor on a short page, which is how the list ends", async () => {
    rpc.mockResolvedValue({ data: [searchRow(1), searchRow(2)], error: null });

    const page = await searchDirectory(
      client,
      { q: undefined, title: undefined, country: undefined },
      null,
    );

    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("offers no next cursor on an empty page, so a page past the last one just ends", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const page = await searchDirectory(
      client,
      { q: undefined, title: undefined, country: undefined },
      { name: "alpha", id: "c0000000-0000-4000-8000-000000000001", page: 4 },
    );

    expect(page.rows).toEqual([]);
    expect(page.page).toBe(4);
    expect(page.nextCursor).toBeNull();
  });

  it("counts the page from the cursor, so the depth cap can be reached", async () => {
    rpc.mockResolvedValue({
      data: Array.from({ length: DIRECTORY_PAGE_SIZE }, (_, i) => searchRow(i + 1)),
      error: null,
    });

    const page = await searchDirectory(
      client,
      { q: undefined, title: undefined, country: undefined },
      { name: "alpha", id: "c0000000-0000-4000-8000-000000000001", page: 40 },
    );

    expect(page.page).toBe(40);
    expect(decodeSearchCursor(page.nextCursor ?? undefined)?.page).toBe(41);
  });

  it("keeps a locked row masked, with the raw three null", async () => {
    rpc.mockResolvedValue({ data: [searchRow(1)], error: null });

    const [row] = (
      await searchDirectory(client, { q: undefined, title: undefined, country: undefined }, null)
    ).rows;

    expect(row?.unlocked).toBe(false);
    expect(row?.emailMasked).toBe("e••••@alpha.test");
    expect(row?.email).toBeNull();
    expect(row?.phone).toBeNull();
    expect(row?.mobile).toBeNull();
    // A masked value the function left null must not become an empty string on the page.
    expect(row?.mobileMasked).toBeNull();
  });

  it("throws on a database error rather than rendering an empty directory", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "SM403", message: "refused" } });

    await expect(
      searchDirectory(client, { q: undefined, title: undefined, country: undefined }, null),
    ).rejects.toThrow();
  });
});

describe("the unlocks list (AC-13)", () => {
  it("asks for one page after the keyset, at the size the caller names", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await unlockedContactsPage(
      client,
      { createdAt: "2026-09-12T08:00:00Z", id: "d0000000-0000-4000-8000-000000000001" },
      500,
    );

    expect(rpc).toHaveBeenCalledWith("directory_unlocked_contacts", {
      after_created_at: "2026-09-12T08:00:00Z",
      after_id: "d0000000-0000-4000-8000-000000000001",
      page_size: 500,
    });
  });

  it("sends no keyset on the first page", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await unlockedContactsPage(client, null, 25);

    expect(rpc).toHaveBeenCalledWith("directory_unlocked_contacts", { page_size: 25 });
  });

  it("reads a malformed cursor as the first page rather than throwing", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const page = await listUnlockedContacts(client, "not-a-cursor");

    expect(page.first).toBe(true);
    expect(rpc).toHaveBeenCalledWith("directory_unlocked_contacts", {
      page_size: DIRECTORY_PAGE_SIZE,
    });
  });

  it("marks a cursored page as not the first, so the empty state stays on page one", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const first = await listUnlockedContacts(client, null);
    expect(first.first).toBe(true);

    rpc.mockResolvedValue({
      data: Array.from({ length: DIRECTORY_PAGE_SIZE }, (_, i) =>
        unlockedRow(i + 1, "2026-09-12T08:00:00Z"),
      ),
      error: null,
    });
    const full = await listUnlockedContacts(client, null);
    expect(full.nextCursor).not.toBeNull();

    const next = await listUnlockedContacts(client, full.nextCursor);
    expect(next.first).toBe(false);
  });

  it("hands back the raw values, because the caller has paid for every row here", async () => {
    rpc.mockResolvedValue({ data: [unlockedRow(1, "2026-09-12T08:00:00Z")], error: null });

    const [row] = (await listUnlockedContacts(client, null)).rows;

    expect(row?.email).toBe("erika.muster@alpha.test");
    expect(row?.phone).toBe("+41 41 123 45 67");
    expect(row?.mobile).toBeNull();
    expect(row?.unlockedAt).toBe("2026-09-12T08:00:00Z");
  });

  it("throws on a database error, which the export route turns into a 404", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "SM403", message: "refused" } });

    await expect(unlockedContactsPage(client, null, 500)).rejects.toThrow();
  });
});

describe("the balance and the ops reads (AC-5, AC-15)", () => {
  it("reads an empty ledger as a balance of zero, never null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getCreditBalance(client)).toBe(0);

    rpc.mockResolvedValue({ data: 50, error: null });
    expect(await getCreditBalance(client)).toBe(50);
  });

  it("throws when the balance cannot be read, rather than showing zero credits", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "SM403", message: "refused" } });

    await expect(getCreditBalance(client)).rejects.toThrow();
  });

  it("maps an ops summary row, counting unlocks as a number and keeping a missing name null", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          expert_id: "e1",
          full_name: null,
          email: "expert@example.com",
          balance: 49,
          credits_bought: 50,
          // A bigint count arrives as a string over the wire.
          unlocks: "1",
          last_unlock_at: "2026-09-12T08:00:00Z",
        },
      ],
      error: null,
    });

    const [row] = await getDirectoryOpsSummary(client);

    expect(row).toEqual({
      expertId: "e1",
      fullName: null,
      email: "expert@example.com",
      balance: 49,
      creditsBought: 50,
      unlocks: 1,
      lastUnlockAt: "2026-09-12T08:00:00Z",
    });
  });

  it("reads the three totals, an absent count as zero", async () => {
    counts.companies = 12;
    counts.contacts = 340;
    counts.suppressed = 2;

    expect(await getDirectoryTotals(client)).toEqual({
      companies: 12,
      contacts: 340,
      suppressed: 2,
    });
  });

  it("throws when a total cannot be counted", async () => {
    counts.error = { code: "42501", message: "permission denied" };

    await expect(getDirectoryTotals(client)).rejects.toThrow();
  });
});
