/**
 * Creates the four role test accounts on a hosted environment so every signed in flow can be
 * driven by hand on a preview or staging deployment:
 *
 *   pnpm users:seed [--dry-run]
 *
 * The hosted counterpart of `supabase/seed.sql`, which only ever runs on the local stack through
 * `supabase db reset`. Creates one client with an organization, a second client in a second
 * organization (so cross tenant checks are possible), one expert and one ops user, each already
 * email confirmed with a generated password printed once at the end. Uses the same fixed ids as
 * the local seed, so a database seeded either way looks the same.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the project's name for the service role
 * key; SUPABASE_SERVICE_ROLE_KEY is accepted too) from the environment or `.env.local`, swapped to
 * the target environment's values with `vercel env pull .env.local --environment=preview` as
 * docs/auth.md describes for `pnpm user:invite`.
 *
 * Refuses to touch a database that already holds a user outside this set, which is what a real
 * environment looks like; that guard mirrors the one at the top of `supabase/seed.sql`. Rerunning
 * it on an already seeded project resets the passwords rather than creating duplicates, so the
 * printed list is always current. The secret key never leaves this script. Plain Node.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

type Role = "client" | "expert" | "ops";

type SeedUser = {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly fullName: string;
  readonly locale: "de" | "en";
  /** The organization this client owns; expert and ops belong to none. */
  readonly organization?: { readonly id: string; readonly name: string };
};

/** The same ids, addresses and names as `supabase/seed.sql`, so both paths seed one shape. */
const SEED_USERS: readonly SeedUser[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    email: "client@example.com",
    role: "client",
    fullName: "Clara Client",
    locale: "de",
    organization: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Musterfirma AG" },
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    email: "client2@example.com",
    role: "client",
    fullName: "Bruno Beispiel",
    locale: "de",
    organization: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Beispiel GmbH" },
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    email: "expert@example.com",
    role: "expert",
    fullName: "Erik Expert",
    locale: "de",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    email: "ops@example.com",
    role: "ops",
    fullName: "Olivia Ops",
    locale: "en",
  },
];

const SEED_IDS: ReadonlySet<string> = new Set(SEED_USERS.map((user) => user.id));

function fail(message: string): never {
  console.error(`users:seed: ${message}`);
  process.exit(1);
}

function requireEnv(...names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return fail(`${names.join(" or ")} is not set (export it or put it in .env.local)`);
}

/**
 * A 24 character password from a URL safe alphabet: comfortably past the eight character minimum
 * in `config.toml`, and safe to paste into a form or a password manager.
 */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabase = createClient(
  supabaseUrl,
  requireEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

// The guard from supabase/seed.sql: a database holding anyone outside this set is a real
// environment, and this script must never rewrite a real user's password.
const { data: existing, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listError) fail(`could not list the existing users: ${listError.message}`);

const strangers = existing.users.filter((user) => !SEED_IDS.has(user.id));
if (strangers.length > 0) {
  fail(
    `refusing to seed ${supabaseUrl}: it already holds ${strangers.length} user(s) outside the seed set ` +
      `(first: ${strangers[0]?.email ?? strangers[0]?.id}). This looks like a real environment.`,
  );
}

const alreadySeeded: ReadonlySet<string> = new Set(existing.users.map((user) => user.id));

console.log(
  `users:seed: ${dryRun ? "would seed" : "seeding"} ${SEED_USERS.length} accounts on ${supabaseUrl}`,
);
if (dryRun) {
  for (const user of SEED_USERS) {
    const verb = alreadySeeded.has(user.id) ? "reset the password of" : "create";
    console.log(`  ${verb} ${user.email} (${user.role})`);
  }
  process.exit(0);
}

const credentials: { email: string; role: Role; password: string }[] = [];

for (const user of SEED_USERS) {
  const password = generatePassword();
  const userMetadata = {
    full_name: user.fullName,
    locale: user.locale,
    // Clients consent at sign up; the profiles trigger copies this into terms_accepted_at.
    ...(user.role === "client" ? { terms_accepted_at: new Date().toISOString() } : {}),
  };

  if (alreadySeeded.has(user.id)) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      app_metadata: { role: user.role },
      user_metadata: userMetadata,
    });
    if (error) fail(`could not reset ${user.email}: ${error.message}`);
  } else {
    const { error } = await supabase.auth.admin.createUser({
      // Supabase's admin API accepts an explicit id, which keeps both seed paths identical.
      id: user.id,
      email: user.email,
      password,
      email_confirm: true,
      app_metadata: { role: user.role },
      user_metadata: userMetadata,
    });
    if (error) fail(`could not create ${user.email}: ${error.message}`);
  }

  // The admin API writes app_metadata after the insert, so the profiles trigger has already
  // defaulted the profile to client; fix the role the same way `pnpm user:invite` does.
  const { data: profile, error: roleError } = await supabase
    .from("profiles")
    .update({ role: user.role })
    .eq("id", user.id)
    .select("role")
    .single();
  if (roleError || profile.role !== user.role) {
    fail(`could not set the role on ${user.email}'s profile: ${roleError?.message ?? "no row"}`);
  }

  credentials.push({ email: user.email, role: user.role, password });
}

// The expert gets an `active` profile row (spec 0012, AC-1), the hosted counterpart of the one
// supabase/seed.sql writes: without it the expert layout sends expert@example.com to onboarding
// on every sign in, and the four test accounts have to stay usable without an invite.
for (const user of SEED_USERS) {
  if (user.role !== "expert") continue;

  const now = new Date().toISOString();
  const { error: expertError } = await supabase.from("expert_profiles").upsert(
    {
      expert_id: user.id,
      email: user.email,
      status: "active",
      headline: "Sicherheitsingenieur mit Schwerpunkt Maschinenbau",
      bio: "Über 15 Jahre Erfahrung in der Arbeitssicherheit produzierender Betriebe in der Deutschschweiz. Begleitet ISO 45001 Zertifizierungen und EKAS 6508 Umsetzungen.",
      competencies: ["compliance", "management_system"],
      industries: ["C", "F"],
      standards: ["iso_45001", "ekas_6508", "suva_asa"],
      languages: ["de", "en"],
      regions: ["ZH", "AG", "ZG"],
      availability: "available",
      years_experience: 15,
      phone: "+41 44 000 00 00",
      invited_at: now,
      onboarded_at: now,
    },
    { onConflict: "expert_id" },
  );
  if (expertError)
    fail(`could not create the expert profile for ${user.email}: ${expertError.message}`);
}

// Organizations and memberships after every profile exists, because both reference profiles.
// The service role bypasses RLS, and private.sync_profile_organization treats a null auth.uid()
// as the seed path, so each owner's profile.organization_id is set by the membership trigger.
for (const user of SEED_USERS) {
  if (!user.organization) continue;

  const { error: orgError } = await supabase
    .from("organizations")
    .upsert(
      { id: user.organization.id, name: user.organization.name, created_by: user.id },
      { onConflict: "id" },
    );
  if (orgError) fail(`could not create ${user.organization.name}: ${orgError.message}`);

  const { error: memberError } = await supabase
    .from("organization_members")
    .upsert(
      { organization_id: user.organization.id, user_id: user.id, role: "owner" },
      { onConflict: "organization_id,user_id" },
    );
  if (memberError) {
    fail(
      `could not make ${user.email} an owner of ${user.organization.name}: ${memberError.message}`,
    );
  }
}

console.log(`\nSeeded ${credentials.length} accounts. These passwords are shown once:\n`);
for (const { email, role, password } of credentials) {
  console.log(`  ${role.padEnd(6)}  ${email.padEnd(22)}  ${password}`);
}
console.log(
  "\nStore them in your password manager; rerun this script to roll them. " +
    "Delete these users before the environment carries real data.",
);
