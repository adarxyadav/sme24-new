"use client";

import { startTransition, useActionState } from "react";
import type { AuthResult } from "@/features/auth/actions";

type Action<Data> = (
  previous: AuthResult<Data> | null,
  input: unknown,
) => Promise<AuthResult<Data>>;

/**
 * Runs an auth action with a typed payload from a React Hook Form submit: `useActionState` keeps
 * the last result and the pending flag, the transition lets the dispatch run outside a form
 * `action` prop. Browser.
 */
export function useAuthAction<Data, Input>(action: Action<Data>) {
  const [result, dispatch, pending] = useActionState(action, null);
  const submit = (input: Input) => startTransition(() => dispatch(input));
  return { result, submit, pending } as const;
}
