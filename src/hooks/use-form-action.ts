"use client";

import { startTransition, useActionState, useCallback, useRef } from "react";

type Action<Result> = (previous: Result | null, input: unknown) => Promise<Result>;

/**
 * Runs a server action with a typed payload from a React Hook Form submit: `useActionState`
 * keeps the last result and the pending flag, the transition lets the dispatch run outside a
 * form `action` prop (spec 0009; the shape of the auth and research hooks). Browser.
 *
 * `submit` resolves with the result of that one dispatch, so what follows a success — a toast, a
 * `router.refresh`, closing a dialog — belongs in the handler that ran the submit rather than in
 * an effect watching `result`. `useActionState` holds its last value for the life of the
 * component, so such an effect re-runs on every later render: one write announced itself several
 * times and a dialog closed again on every reopen. React says the same
 * (`you-might-not-need-an-effect`): work that happens because a button was clicked is event
 * handler work, not synchronization.
 */
export function useFormAction<Result, Input>(action: Action<Result>) {
  // `dispatch` returns nothing, so the resolution is handed back through the settler this wrapper
  // closes over. One submit is in flight at a time (every caller disables its button while
  // pending), and a dispatch React discards leaves its promise unsettled, which leaves the caller
  // exactly where a click that never landed would.
  const settle = useRef<((value: Result) => void) | null>(null);
  const settling = useCallback<Action<Result>>(
    async (previous, input) => {
      const next = await action(previous, input);
      settle.current?.(next);
      settle.current = null;
      return next;
    },
    [action],
  );

  const [result, dispatch, pending] = useActionState(settling, null);

  const submit = (input: Input) =>
    new Promise<Result>((resolve) => {
      settle.current = resolve;
      startTransition(() => dispatch(input));
    });

  return { result, submit, pending } as const;
}
