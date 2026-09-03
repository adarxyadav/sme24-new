import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Server components: cookies are read only here, so a refreshed session cannot be persisted.
 * The request proxy refreshes the session before the component renders. Never module level.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const env = clientEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Server components cannot write cookies; the proxy handles refresh.
        },
      },
    },
  );
}
