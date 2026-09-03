import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Secret key client: no session, bypasses RLS. Only for Trigger.dev tasks and server only admin
 * code. Every caller filters by explicit ids; never query broadly with this client.
 *
 * Not marked with the `server-only` package because that module throws outside Next.js and this
 * file runs inside Trigger.dev. Biome forbids importing it from `src/app`, `src/components` and
 * any `ui` folder instead (see biome.json overrides), and the secret key is never NEXT_PUBLIC_.
 */
export function createServiceClient(secretKey: string, url: string) {
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
