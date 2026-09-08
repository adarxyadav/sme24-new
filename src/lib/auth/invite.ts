/**
 * The staff invite path (spec 0013, AC-2). One implementation shared by the ops action
 * (`inviteExpert`) and the `pnpm user:invite` script, so a fix to the ordering lands in both.
 *
 * Not marked with the `server-only` package: the script is plain Node and would throw on it. What
 * keeps the secret key off the browser is that this module is imported only by `actions.ts` files
 * and `scripts/`, the same rule `src/lib/supabase/service.ts` documents, plus the key never being
 * a `NEXT_PUBLIC_` variable.
 *
 * The ordering below is the whole point of the module. An expert account is two rows that have to
 * agree (the auth user and the profile row), created through an admin API that cannot do both at
 * once, so every step undoes itself on failure and the email goes last:
 *
 *   1. look up the profile row by email, because a second invite to a known expert is a resend,
 *      not a new account;
 *   2. create the auth user unconfirmed with the role in app_metadata;
 *   3. fix the role on the profile (the admin API writes app_metadata after the insert, so the
 *      profiles trigger has already defaulted the row to client);
 *   4. insert the expert_profiles row, deleting the user again on a duplicate email, which is what
 *      two ops inviting the same address at the same moment looks like;
 *   5. send the invite email, deleting both rows when it fails.
 *
 * Sending last is what makes the failure modes safe: a real user without a profile row can never
 * remain, and nobody ever receives a link to an account that was rolled back.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { buildConfirmRedirectUrl } from "./confirm-url.ts";

/** The two roles that are ever invited; a client signs up instead. */
export type StaffRole = "expert" | "ops";

/** The short language codes an invitee's link and profile carry. */
export type InviteLocale = "de" | "en";

export type InviteStaffUserInput = {
  readonly email: string;
  readonly role: StaffRole;
  readonly locale: InviteLocale;
  readonly fullName?: string;
  /** The caller's id, stored as `invited_by`; absent when the script invited. */
  readonly invitedBy?: string;
  /** The app URL the invite link points at (`NEXT_PUBLIC_APP_URL`). */
  readonly appUrl: string;
};

export type InviteStaffUserResult =
  | { readonly ok: true; readonly userId: string; readonly expertId: string | null }
  | {
      readonly ok: false;
      readonly error: "email_taken" | "already_invited" | "invite_failed";
      readonly message: string;
    };

type ServiceClient = SupabaseClient<Database>;

/** A service client for the invite path. The secret key never leaves the server. Server only. */
export function createInviteClient(url: string, secretKey: string): ServiceClient {
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Invites a staff user with their role fixed, creating the expert profile row for an expert
 * (spec 0013, AC-2). Answers a typed result and never throws for an expected failure. Called by
 * the ops action after its role check and by `pnpm user:invite`; needs the service client.
 */
export async function inviteStaffUser(
  supabase: ServiceClient,
  input: InviteStaffUserInput,
): Promise<InviteStaffUserResult> {
  const email = input.email.trim().toLowerCase();

  // 1. A known expert address is a resend, not a second account. Checking the profile row rather
  //    than the admin API keeps this to one indexed query, which is why the email is copied onto
  //    the row at all.
  if (input.role === "expert") {
    const { data: existing, error } = await supabase
      .from("expert_profiles")
      .select("expert_id")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      return { ok: false, error: "invite_failed", message: error.message };
    }
    if (existing) {
      return { ok: false, error: "already_invited", message: "an expert profile already exists" };
    }
  }

  // 2. The auth user, unconfirmed: the invite email is what confirms it. The role is a literal
  //    from the caller's own check, never anything the invitee typed.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: false,
    app_metadata: { role: input.role },
    user_metadata: {
      locale: input.locale,
      ...(input.fullName ? { full_name: input.fullName } : {}),
    },
  });
  if (createError || !created?.user) {
    // The admin API says `email_exists` whatever role the other account holds, which is the right
    // answer to give: ops learn the address is taken without learning what it is used for.
    const message = createError?.message ?? "the user was not created";
    const taken =
      createError?.code === "email_exists" || /already been registered|email_exists/i.test(message);
    return { ok: false, error: taken ? "email_taken" : "invite_failed", message };
  }
  const userId = created.user.id;

  // 3. The profiles trigger defaulted the row to client, because the admin API writes app_metadata
  //    after the insert. The access token hook reads the role from the profile, so it has to agree.
  const { data: profile, error: roleError } = await supabase
    .from("profiles")
    .update({ role: input.role })
    .eq("id", userId)
    .select("role")
    .single();
  if (roleError || profile?.role !== input.role) {
    await supabase.auth.admin.deleteUser(userId);
    return {
      ok: false,
      error: "invite_failed",
      message: `the role was not set on the profile: ${roleError?.message ?? "no row"}`,
    };
  }

  // 4. The expert profile row, which is what makes the ops list one query.
  let expertId: string | null = null;
  if (input.role === "expert") {
    const { error: profileError } = await supabase.from("expert_profiles").insert({
      expert_id: userId,
      email,
      status: "invited",
      invited_by: input.invitedBy ?? null,
      invited_at: new Date().toISOString(),
    });
    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);
      // 23505 on the email: two ops invited the same address at once and the other one won.
      const duplicate = profileError.code === "23505";
      return {
        ok: false,
        error: duplicate ? "already_invited" : "invite_failed",
        message: profileError.message,
      };
    }
    expertId = userId;
  }

  // 5. The email last, so nothing above can leave a link to an account that was rolled back.
  const redirectTo = buildConfirmRedirectUrl(input.appUrl, input.locale, "/reset-password");
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (inviteError) {
    if (input.role === "expert") {
      await supabase.from("expert_profiles").delete().eq("expert_id", userId);
    }
    await supabase.auth.admin.deleteUser(userId);
    return { ok: false, error: "invite_failed", message: inviteError.message };
  }

  return { ok: true, userId, expertId };
}

export type ResendInviteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: "rate_limited" | "invite_failed";
      readonly message: string;
    };

/**
 * Sends the invite email again to an already invited, still unconfirmed user (spec 0013, AC-3).
 * Supabase resends rather than erroring for an unconfirmed user; a confirmed one would answer
 * `email_exists`, which cannot happen here because confirming moves the status to `active`.
 * Server only, service client.
 */
export async function resendStaffInvite(
  supabase: ServiceClient,
  input: { readonly email: string; readonly locale: InviteLocale; readonly appUrl: string },
): Promise<ResendInviteResult> {
  const redirectTo = buildConfirmRedirectUrl(input.appUrl, input.locale, "/reset-password");
  const { error } = await supabase.auth.admin.inviteUserByEmail(input.email.trim().toLowerCase(), {
    redirectTo,
  });
  if (!error) return { ok: true };
  // The auth email rail's own `max_frequency` limit: a real answer to show ops, not a failure.
  const limited = error.status === 429 || /rate|frequency|too many/i.test(error.message);
  return { ok: false, error: limited ? "rate_limited" : "invite_failed", message: error.message };
}

/** How long a ban lasts: a hundred years, Supabase's idiom for "until someone lifts it". */
const BAN_FOREVER = "876000h";

/**
 * Bans a staff user's sign in (spec 0013, AC-10). The session already issued stays valid until its
 * next refresh, which is why the expert layout also redirects an `inactive` expert. Server only.
 */
export async function banStaffUser(supabase: ServiceClient, userId: string): Promise<boolean> {
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: BAN_FOREVER,
  });
  return !error;
}

/** Lifts the ban of a staff user (spec 0013, AC-10). Server only. */
export async function unbanStaffUser(supabase: ServiceClient, userId: string): Promise<boolean> {
  const { error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: "none" });
  return !error;
}
