import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

/**
 * A secret key client for asserting rows the UI never shows (spec 0005 test scenarios): the
 * organization, the owner membership, the consent timestamp. Local stack only; every query filters
 * by an explicit id or email. Playwright.
 */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** True when the service client can be built (the local stack's keys are in the environment). */
export const dbAvailable = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/** The profile, organization and membership of a user by email, or null when the user is unknown. */
export async function accountByEmail(email: string) {
  const supabase = serviceClient();
  const { data: users, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = users.users.find(
    (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, organization_id, full_name, locale, terms_accepted_at")
    .eq("id", user.id)
    .maybeSingle();
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id);
  const organization = profile?.organization_id
    ? (
        await supabase
          .from("organizations")
          .select("id, name, created_by, locale")
          .eq("id", profile.organization_id)
          .maybeSingle()
      ).data
    : null;
  return { user, profile, memberships: memberships ?? [], organization };
}

/** Removes a test account and, through the cascades, its profile, memberships and organization. */
export async function deleteAccount(email: string) {
  const account = await accountByEmail(email);
  if (!account) return;
  const supabase = serviceClient();
  if (account.organization) {
    await supabase.from("organizations").delete().eq("id", account.organization.id);
  }
  await supabase.auth.admin.deleteUser(account.user.id);
}

/**
 * A confirmed client whose sign up metadata still holds the company name and consent, the state
 * a password or code sign up is in right after confirmation and before its first sign in.
 */
export async function createConfirmedClient(
  email: string,
  password: string,
  organizationName = "Fixture AG",
) {
  const supabase = serviceClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: "Fixture Person",
      locale: "de",
      organization_name: organizationName,
      terms_accepted_at: new Date().toISOString(),
    },
  });
  if (error) throw error;
}

/** A confirmed client without any sign up metadata: what a provider sign up looks like. */
export async function createBareClient(email: string, password: string) {
  const supabase = serviceClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Pia Provider" },
  });
  if (error) throw error;
}

/** A client who signed up with a password and never followed the confirmation link. */
export async function createUnconfirmedClient(email: string, password: string) {
  const supabase = serviceClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { full_name: "Uwe Unconfirmed", locale: "de" },
  });
  if (error) throw error;
}
