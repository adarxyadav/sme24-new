import type { SupabaseClient } from "@supabase/supabase-js";
import { type Locale, localeFromCode } from "@/i18n/routing";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The next-intl locale of a user from the stored short code (AC-7). A missing row gives the default
 * locale (a deleted recipient must not fail a retried task forever); a database error throws like
 * every query. Tasks pass the service client with an explicit id; request code passes the server
 * client.
 */
export async function localeForUser(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Locale> {
  const { data, error } = await client
    .from("profiles")
    .select("locale")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return localeFromCode(data?.locale);
}
