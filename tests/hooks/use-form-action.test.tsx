import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFormAction } from "@/hooks/use-form-action";

/**
 * The hook ten components share (spec 0014's review, minor 2). Its contract is narrower than
 * `useActionState`'s: `submit` hands back a promise that resolves with the result of that one
 * dispatch, which is what lets a caller do the success work in the click handler instead of an
 * effect watching a `result` that outlives the click. The three things worth pinning are that the
 * promise resolves once per submit, that `result` and `pending` still track the dispatch, and what
 * a second submit landing before the first resolves actually does, because the hook defends that
 * case by assumption ("every caller disables its button while pending") rather than by a guard.
 */
type Result = { ok: true; value: string } | { ok: false; error: string };

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("useFormAction", () => {
  it("resolves the submit promise with that dispatch's result", async () => {
    const action = vi.fn(async (_previous: Result | null, input: unknown) => ({
      ok: true as const,
      value: String(input),
    }));

    const { result: hook } = renderHook(() => useFormAction<Result, string>(action));

    let settled: Result | undefined;
    await act(async () => {
      settled = await hook.current.submit("bern");
    });

    expect(settled).toEqual({ ok: true, value: "bern" });
    expect(action).toHaveBeenCalledTimes(1);
    expect(hook.current.result).toEqual({ ok: true, value: "bern" });
  });

  it("resolves once per submit, so a later render never settles it a second time", async () => {
    const action = vi.fn(async (): Promise<Result> => ({ ok: true, value: "once" }));
    const { result: hook, rerender } = renderHook(() => useFormAction<Result, string>(action));

    const resolutions = vi.fn();
    await act(async () => {
      await hook.current.submit("first").then(resolutions);
    });

    // The result is held for the life of the component; re-rendering must not re-announce it.
    rerender();
    rerender();

    expect(resolutions).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("reports pending across the dispatch and clears it when the action settles", async () => {
    const gate = deferred<Result>();
    const action = vi.fn(() => gate.promise);
    const { result: hook } = renderHook(() => useFormAction<Result, string>(action));

    let submitted: Promise<Result> | undefined;
    act(() => {
      submitted = hook.current.submit("zurich");
    });

    await waitFor(() => expect(hook.current.pending).toBe(true));

    await act(async () => {
      gate.resolve({ ok: false, error: "invalid_transition" });
      await submitted;
    });

    expect(hook.current.pending).toBe(false);
    expect(hook.current.result).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("carries the previous result into the next dispatch", async () => {
    const seen: (Result | null)[] = [];
    const action = vi.fn(async (previous: Result | null, input: unknown): Promise<Result> => {
      seen.push(previous);
      return { ok: true, value: String(input) };
    });
    const { result: hook } = renderHook(() => useFormAction<Result, string>(action));

    await act(async () => {
      await hook.current.submit("one");
    });
    await act(async () => {
      await hook.current.submit("two");
    });

    expect(seen).toEqual([null, { ok: true, value: "one" }]);
  });

  it("settles the newest caller when a second submit lands mid flight, the case callers avoid by disabling the button", async () => {
    // The hook holds one settler, so an overlapping submit replaces it: the first caller's promise
    // is left unsettled rather than resolved with someone else's result. Documented here as the
    // accepted behaviour so a future guard changes this test deliberately, not by accident.
    const gates = [deferred<Result>(), deferred<Result>()];
    let call = 0;
    const action = vi.fn(() => gates[call++]?.promise ?? Promise.reject(new Error("too many")));

    const { result: hook } = renderHook(() => useFormAction<Result, string>(action));

    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      void hook.current.submit("first").then(first);
      void hook.current.submit("second").then(second);
    });

    await act(async () => {
      gates[0]?.resolve({ ok: true, value: "first" });
      gates[1]?.resolve({ ok: true, value: "second" });
      await Promise.resolve();
    });

    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(first).not.toHaveBeenCalled();
  });
});
