import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_STEPS } from "@/features/research/catalogue";
import { RunProgress, type RunProgressProps, stepItems } from "@/features/research/ui/run-progress";
import { EnglishIntl, en, RUN_ID } from "./helpers";

/**
 * The live run progress (spec 0007, AC-7): the five steps follow the status and the summary step,
 * the row is subscribed by id over Realtime and re keyed after a rerun, an UPDATE patches the
 * badge and counters, the page refreshes every five seconds while the run is open and once more
 * when it turns terminal, and the quota line reads "n of 5 runs left today". The browser Supabase
 * client and the App Router are the boundaries.
 */
const realtime = vi.hoisted(() => ({
  handler: null as null | ((payload: { new: unknown }) => void),
  subscribe: null as null | ((status: string) => void),
  filter: null as unknown,
  benchmarkFilter: null as unknown,
  benchmarkHandler: null as null | (() => void),
  channelNames: [] as string[],
  setAuth: vi.fn(),
  removeChannel: vi.fn(),
  refresh: vi.fn(),
}));

// One router object for the whole file: the App Router's is stable, and the subscription effect
// depends on it, so a fresh object per render would re subscribe on every render.
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: (...args: unknown[]) => realtime.refresh(...args),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/app",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => {
    const channel = {
      on: (_event: string, filter: unknown, handler: (payload: { new: unknown }) => void) => {
        // The research run channel and the benchmark snapshot channel (spec 0008, AC-12) share the fake.
        if ((filter as { table: string }).table === "benchmark_snapshots") {
          realtime.benchmarkFilter = filter;
          realtime.benchmarkHandler = () => handler({ new: null });
        } else {
          realtime.filter = filter;
          realtime.handler = handler;
        }
        return channel;
      },
      subscribe: (callback?: (status: string) => void) => {
        if (callback) realtime.subscribe = callback;
        return channel;
      },
    };
    return {
      channel: (name: string) => {
        realtime.channelNames.push(name);
        return channel;
      },
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
        getSession: async () => ({ data: { session: { access_token: "tok" } } }),
      },
      realtime: { setAuth: realtime.setAuth },
      removeChannel: realtime.removeChannel,
    };
  },
}));

const COMPANY_ID = "0c000000-0000-4000-8000-00000000000a";
/** The research run channels alone; the benchmark channel is keyed by the company (spec 0008, AC-12). */
const runChannels = () => realtime.channelNames.filter((name) => name.startsWith("research_run:"));

const steps = en.research.steps;
const label = (step: (typeof RUN_STEPS)[number]) => steps[step];

function run(overrides: Partial<RunProgressProps["run"]> = {}): RunProgressProps["run"] {
  return {
    id: RUN_ID,
    status: "running",
    summary: { version: 1, step: "searching" },
    created_at: "2026-09-06T10:00:00.000Z",
    started_at: "2026-09-06T10:00:05.000Z",
    finished_at: null,
    error_code: null,
    ...overrides,
  };
}

const quota = { remaining: 3, limit: 5 };

/** The step list as [state] per step, in order. */
function states() {
  return screen
    .getAllByRole("listitem")
    .filter((item) => item.hasAttribute("data-state"))
    .map((item) => item.getAttribute("data-state"));
}

beforeEach(() => {
  realtime.handler = null;
  realtime.subscribe = null;
  realtime.filter = null;
  realtime.channelNames = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stepItems (AC-7)", () => {
  it("marks queued as current with everything after pending", () => {
    expect(stepItems("queued", null, label, null).map((item) => item.state)).toEqual([
      "current",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("follows the summary step while running, searching when the summary is missing", () => {
    const extracting = stepItems("running", { version: 1, step: "extracting" }, label, null);
    expect(extracting.map((item) => item.state)).toEqual([
      "done",
      "done",
      "current",
      "pending",
      "pending",
    ]);
    expect(stepItems("running", null, label, null)[1]?.state).toBe("current");
  });

  it("marks every step done on a terminal success or an empty result", () => {
    for (const status of ["succeeded", "empty"]) {
      const items = stepItems(status, { version: 1, step: "done" }, label, null);
      expect(items.every((item) => item.state === "done")).toBe(true);
      expect(items.map((item) => item.label)).toEqual(RUN_STEPS.map(label));
    }
  });

  it("marks the last step failed with the reason on a failed run, whatever step the summary was on", () => {
    const items = stepItems("failed", { version: 1, step: "done" }, label, "It stopped.");
    expect(items.map((item) => item.state)).toEqual(["done", "done", "done", "done", "failed"]);
    expect(items[4]?.detail).toBe("It stopped.");
    // A failure mid way lands on the same last step: failed is terminal, so every earlier step reads done.
    const midway = stepItems("failed", { version: 1, step: "extracting" }, label, null);
    expect(midway.map((item) => item.state)).toEqual(["done", "done", "done", "done", "failed"]);
    expect(midway[4]?.detail).toBeUndefined();
  });
});

describe("RunProgress (AC-7)", () => {
  it("shows the status, the steps, the counters, the times and the quota line", () => {
    render(
      <RunProgress
        run={run({
          summary: { version: 1, step: "extracting", sourcesFound: 5, kpisExtracted: 0 },
        })}
        quota={quota}
        companyId={COMPANY_ID}
        benchmarkState="unavailable"
      />,
      { wrapper: EnglishIntl },
    );
    expect(screen.getByText(en.research.status.running)).toBeInTheDocument();
    expect(states()).toEqual(["done", "done", "current", "pending", "pending"]);
    expect(screen.getByText("5 sources found")).toBeInTheDocument();
    expect(screen.getByText("0 KPIs extracted")).toBeInTheDocument();
    expect(screen.getByText("3 of 5 runs left today")).toBeInTheDocument();
    expect(screen.getByText(/^Started /)).toHaveTextContent("Started 06.09.2026, 12:00");
    expect(screen.getByText(en.research.progress.resultsPending)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: en.research.progress.heading })).toBeInTheDocument();
  });

  it("subscribes to the run's row by id and shows the live badge once the channel is subscribed", async () => {
    render(
      <RunProgress run={run()} quota={quota} companyId={COMPANY_ID} benchmarkState="unavailable" />,
      { wrapper: EnglishIntl },
    );
    await act(async () => {});
    expect(runChannels()).toEqual([`research_run:${RUN_ID}`]);
    expect(realtime.channelNames).toContain(`benchmark_snapshots:${COMPANY_ID}`);
    expect(realtime.benchmarkFilter).toEqual({
      event: "INSERT",
      schema: "public",
      table: "benchmark_snapshots",
      filter: `company_id=eq.${COMPANY_ID}`,
    });
    expect(realtime.filter).toEqual({
      event: "UPDATE",
      schema: "public",
      table: "research_runs",
      filter: `id=eq.${RUN_ID}`,
    });
    expect(realtime.setAuth).toHaveBeenCalledWith("tok");
    expect(screen.getByText(en.research.progress.polling)).toHaveAttribute("data-live", "false");
    act(() => realtime.subscribe?.("SUBSCRIBED"));
    expect(screen.getByText(en.research.progress.live)).toHaveAttribute("data-live", "true");
  });

  it("patches the badge and the counters from an UPDATE and refreshes once when the run turns terminal", async () => {
    render(
      <RunProgress run={run()} quota={quota} companyId={COMPANY_ID} benchmarkState="unavailable" />,
      { wrapper: EnglishIntl },
    );
    await act(async () => {});
    act(() =>
      realtime.handler?.({
        new: run({ summary: { version: 1, step: "saving", sourcesFound: 5, kpisExtracted: 24 } }),
      }),
    );
    expect(states()).toEqual(["done", "done", "done", "current", "pending"]);
    expect(screen.getByText("24 KPIs extracted")).toBeInTheDocument();
    expect(realtime.refresh).not.toHaveBeenCalled();

    act(() =>
      realtime.handler?.({
        new: run({
          status: "succeeded",
          finished_at: "2026-09-06T10:03:00.000Z",
          summary: { version: 1, step: "done", sourcesFound: 5, kpisExtracted: 24 },
        }),
      }),
    );
    expect(realtime.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en.research.status.succeeded)).toBeInTheDocument();
    expect(states()).toEqual(["done", "done", "done", "done", "done"]);
    expect(screen.queryByText(en.research.progress.polling)).not.toBeInTheDocument();
    expect(screen.getByText(/^Finished /)).toBeInTheDocument();
  });

  it("refreshes every five seconds while the run is open and stops once it is terminal", async () => {
    const { rerender } = render(
      <RunProgress run={run()} quota={quota} companyId={COMPANY_ID} benchmarkState="unavailable" />,
      {
        wrapper: EnglishIntl,
      },
    );
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5_000));
    act(() => vi.advanceTimersByTime(5_000));
    expect(realtime.refresh).toHaveBeenCalledTimes(2);

    rerender(
      <RunProgress
        run={run({ status: "empty" })}
        quota={quota}
        companyId={COMPANY_ID}
        benchmarkState="unavailable"
      />,
    );
    act(() => vi.advanceTimersByTime(15_000));
    expect(realtime.refresh).toHaveBeenCalledTimes(2);
  });

  it("shows the failed reason on the step and no live badge for a failed run", () => {
    render(
      <RunProgress
        run={run({
          status: "failed",
          error_code: "provider_timeout",
          finished_at: "2026-09-06T10:20:00.000Z",
        })}
        quota={quota}
        companyId={COMPANY_ID}
        benchmarkState="unavailable"
      />,
      { wrapper: EnglishIntl },
    );
    expect(states()).toEqual(["done", "done", "done", "done", "failed"]);
    expect(screen.getByText(en.research.errors.provider_timeout)).toBeInTheDocument();
    expect(screen.queryByText(en.research.progress.polling)).not.toBeInTheDocument();
  });

  it("re subscribes when the latest run changes after a rerun", async () => {
    const NEXT = "0d000000-0000-4000-8000-000000000002";
    const { rerender } = render(
      <RunProgress run={run()} quota={quota} companyId={COMPANY_ID} benchmarkState="unavailable" />,
      {
        wrapper: EnglishIntl,
      },
    );
    await act(async () => {});
    rerender(
      <RunProgress
        run={run({ id: NEXT, status: "queued", summary: null })}
        quota={quota}
        companyId={COMPANY_ID}
        benchmarkState="unavailable"
      />,
    );
    await act(async () => {});
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(runChannels()).toEqual([`research_run:${RUN_ID}`, `research_run:${NEXT}`]);
    expect(
      screen.getByText(en.research.status.queued, { selector: "[data-status]" }),
    ).toHaveAttribute("data-status", "queued");
    expect(states()).toEqual(["current", "pending", "pending", "pending", "pending"]);
  });

  it("refreshes when a benchmark snapshot lands and polls while the benchmark is calculating (spec 0008, AC-12)", async () => {
    const { rerender } = render(
      <RunProgress
        run={run({ status: "succeeded", finished_at: "2026-09-06T10:03:00.000Z" })}
        quota={quota}
        companyId={COMPANY_ID}
        benchmarkState="calculating"
      />,
      { wrapper: EnglishIntl },
    );
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5_000));
    expect(realtime.refresh).toHaveBeenCalledTimes(1);
    act(() => realtime.benchmarkHandler?.());
    expect(realtime.refresh).toHaveBeenCalledTimes(2);

    rerender(
      <RunProgress
        run={run({ status: "succeeded", finished_at: "2026-09-06T10:03:00.000Z" })}
        quota={quota}
        companyId={COMPANY_ID}
        benchmarkState="ready"
      />,
    );
    act(() => vi.advanceTimersByTime(15_000));
    expect(realtime.refresh).toHaveBeenCalledTimes(2);
  });
});
