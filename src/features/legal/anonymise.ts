import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "@/features/experts/catalogue";
import { banStaffUser } from "@/lib/auth/invite";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";

type ServiceClient = SupabaseClient<Database>;

/**
 * Anonymising a person whose deletion request is being fulfilled (spec 0015, AC-15). Called only
 * from inside `updateDataRequest`, never as a manual side channel, so the audit log proves what
 * happened and when.
 *
 * The scope is fixed and is not a per case ops judgement. It touches exactly three places:
 *
 * 1. `profiles.full_name` set to null. The row itself survives, so no foreign key breaks and the
 *    accounting rows keep pointing somewhere.
 * 2. `auth.users` email and user metadata scrubbed through the admin API, plus the permanent ban
 *    that ends the ability to sign in. Not optional: leaving it means the "deleted" person is
 *    still findable by email and can still log in, which would make the fulfilment a lie.
 * 3. For an expert, `expert_profiles.email`, `photo_path` and `bio`, plus the photo object in the
 *    private bucket.
 *
 * Every accounting row (`orders`, `invoices`, `order_events`) is deliberately untouched: it
 * belongs to the organisation rather than to the person, and Art. 958f CO requires it for ten
 * years. The privacy page states that exception in plain words.
 */

/** What was actually cleared, so the caller can log it and ops can see it on the record. */
export type AnonymisationOutcome = {
  readonly profileCleared: boolean;
  readonly authScrubbed: boolean;
  readonly expertCleared: boolean;
  readonly photoRemoved: boolean;
};

/** The address a scrubbed auth user is left with: unique, unroutable and obviously not a person. */
function scrubbedEmail(userId: string): string {
  return `deleted+${userId}@invalid.sme24.ch`;
}

/**
 * Clears the identifying columns of one person and ends their ability to sign in (AC-15).
 *
 * Postgres has no transaction spanning `auth.users` and `public`, so the writes run in the order
 * that fails safe: the `public` columns first, the auth scrub and the ban last. A partial run that
 * stops early leaves a person whose profile is cleared but who can still sign in — visible,
 * fixable by pressing the button again — where the reverse would leave a name on a profile nobody
 * can reach and no obvious way back. Every step is independently idempotent, and the caller leaves
 * the request open on a throw, so re running the fulfilment finishes what a partial run started.
 *
 * Throws on a failure of any of the three column groups: the caller turns that into a typed
 * `unexpected` and leaves the request open rather than recording a fulfilment that did not
 * happen. Server only, service client (these columns sit outside every app role's grants).
 */
export async function anonymisePerson(
  service: ServiceClient,
  userId: string,
): Promise<AnonymisationOutcome> {
  const { error: profileError } = await service
    .from("profiles")
    .update({ full_name: null })
    .eq("id", userId);
  if (profileError) throw new Error(`anonymise: profile: ${profileError.message}`);

  // The expert columns, when there is an expert profile at all. `maybeSingle` rather than a guess
  // from the role claim: a deactivated expert still has the row, and a client never had one.
  const { data: expert, error: readError } = await service
    .from("expert_profiles")
    .select("photo_path")
    .eq("expert_id", userId)
    .maybeSingle();
  if (readError) throw new Error(`anonymise: expert read: ${readError.message}`);

  let expertCleared = false;
  let photoRemoved = false;
  if (expert) {
    const { error: expertError } = await service
      .from("expert_profiles")
      .update({ email: scrubbedEmail(userId), photo_path: null, bio: null })
      .eq("expert_id", userId);
    if (expertError) throw new Error(`anonymise: expert: ${expertError.message}`);
    expertCleared = true;

    if (expert.photo_path) {
      // The object itself, not just the pointer: a signed URL minted before this moment would
      // otherwise keep serving the person's face for its full ten minutes and beyond. A failure
      // here is logged rather than thrown, because the pointer is already gone and the bucket is
      // private, so the remaining risk is an orphaned object rather than a reachable photo.
      const { error: removeError } = await service.storage
        .from(PHOTO_BUCKET)
        .remove([expert.photo_path]);
      if (removeError)
        log.warn("anonymise: photo not removed", { userId, reason: removeError.message });
      else photoRemoved = true;
    }
  }

  // `user_metadata` is where the name the person supplied at sign up lives, so it is cleared.
  // `app_metadata` is deliberately left alone: it carries Supabase's own `provider`/`providers`
  // keys, and its `role` and `organization_id` are rewritten from the profile by the access token
  // hook on every token anyway, so clearing it would break the auth row without removing anything
  // the person supplied.
  //
  // GoTrue MERGES `user_metadata` rather than replacing it, so passing `{}` is a silent no-op that
  // returns success while leaving the person's real name in `auth.users.raw_user_meta_data`. A key
  // is removed only by sending it explicitly as null, so the nulls are derived from the keys the
  // user actually carries: a hard coded list would rot the day a sixth key is added at sign up,
  // and this clears whatever is there (`full_name`, `organization_name`, `locale`,
  // `terms_accepted_at`, `terms_version`, an OAuth `avatar_url`) without naming any of them.
  const { data: current, error: readAuthError } = await service.auth.admin.getUserById(userId);
  if (readAuthError) throw new Error(`anonymise: auth read: ${readAuthError.message}`);
  const scrubbedMetadata = Object.fromEntries(
    Object.keys(current.user?.user_metadata ?? {}).map((key) => [key, null]),
  );
  const { error: authError } = await service.auth.admin.updateUserById(userId, {
    email: scrubbedEmail(userId),
    user_metadata: scrubbedMetadata,
  });
  if (authError) throw new Error(`anonymise: auth: ${authError.message}`);

  // The ban is what actually ends the ability to sign in; the scrubbed address alone would still
  // accept a magic link. `banStaffUser` is the same call spec 0013 uses to deactivate an expert,
  // reused so the ban duration is written in one place.
  const banned = await banStaffUser(service, userId);
  if (!banned) throw new Error("anonymise: auth: sign in not ended");

  return { profileCleared: true, authScrubbed: true, expertCleared, photoRemoved };
}
