import { PostgrestError } from "@supabase/supabase-js";

type QueryErrorLike = {
  readonly message: string;
  readonly details?: string | null;
  readonly hint?: string | null;
  readonly code?: string | null;
};

/**
 * Turns the `error` of a `{ data, error }` result into something safe to throw. supabase-js
 * types it as `PostgrestError` but hands back a plain object at runtime (the parsed PostgREST
 * body), and a thrown plain object reaches the Next.js error boundary as "[object Object]"
 * (code E394) and Sentry without a stack or a class. An `Error` passes through unchanged. Any context.
 */
export function queryError(error: QueryErrorLike): Error {
  if (error instanceof Error) return error;
  return new PostgrestError({
    message: error.message,
    details: error.details ?? "",
    hint: error.hint ?? "",
    code: error.code ?? "",
  });
}
