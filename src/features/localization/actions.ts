"use server";

import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { setLocaleSchema } from "./schema";

export type SetLocaleResult =
  | { ok: true; data: { persisted: boolean } }
  | { ok: false; error: "invalid_input" | "persist_failed" };

/**
 * Remembers the language a signed in user chose (spec 0004, AC-2): writes the short code to the
 * caller's own `profiles.locale` (RLS plus the column grant enforce ownership). Without a session
 * it returns ok without writing. It never redirects and never revalidates: the URL is the truth
 * for the page, the profile only feeds what leaves the app (emails, documents). Server action.
 */
export async function setLocale(input: unknown): Promise<SetLocaleResult> {
  const parsed = setLocaleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || userId === "") {
    return { ok: true, data: { persisted: false } };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ locale: parsed.data.locale })
    .eq("id", userId);
  if (error) {
    log.warn("locale not persisted", { userId, reason: error.message });
    return { ok: false, error: "persist_failed" };
  }
  return { ok: true, data: { persisted: true } };
}
