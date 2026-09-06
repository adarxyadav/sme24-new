"use client";

import { startTransition, useActionState } from "react";

type Action<Result> = (previous: Result | null, input: unknown) => Promise<Result>;

/**
 * Runs a server action with a typed payload from a React Hook Form submit: `useActionState`
 * keeps the last result and the pending flag, the transition lets the dispatch run outside a
 * form `action` prop (spec 0009; the shape of the auth and research hooks). Browser.
 */
export function useFormAction<Result, Input>(action: Action<Result>) {
  const [result, dispatch, pending] = useActionState(action, null);
  const submit = (input: Input) => startTransition(() => dispatch(input));
  return { result, submit, pending } as const;
}
