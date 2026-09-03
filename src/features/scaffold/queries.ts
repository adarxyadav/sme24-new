import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type ScaffoldCheck = Database["public"]["Tables"]["scaffold_checks"]["Row"];

/** Latest smoke test rows. Runs as the signed in user, so RLS limits this to ops. */
export async function listScaffoldChecks(supabase: SupabaseClient<Database>, limit = 20) {
  const { data, error } = await supabase
    .from("scaffold_checks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
