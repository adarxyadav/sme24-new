"use client";

import { startTransition, useActionState } from "react";
import type { ResearchActionResult } from "@/features/research/actions";

type Action<Data> = (
  previous: ResearchActionResult<Data> | null,
  input: unknown,
) => Promise<ResearchActionResult<Data>>;

/**
 * Runs a research action from a React Hook Form submit: `useActionState` keeps the last result
 * and the pending flag, the transition lets the dispatch run outside a form `action` prop. Browser.
 */
export function useResearchAction<Data, Input>(action: Action<Data>) {
  const [result, dispatch, pending] = useActionState(action, null);
  const submit = (input: Input) => startTransition(() => dispatch(input));
  return { result, submit, pending } as const;
}
