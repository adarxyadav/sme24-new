/**
 * Invites an expert or ops user with their role fixed (spec 0005, AC-10):
 *
 *   pnpm user:invite --email erika@example.com --role expert [--locale en] [--name "Erika Expert"]
 *
 * Creates the user unconfirmed with `app_metadata.role`, fixes the same role on the profile (the
 * admin API writes app_metadata after the insert, so the profiles trigger has already defaulted
 * to client), then sends Supabase's invite email whose link opens the set password page in the
 * invitee's language. The access token hook reads the role from the profile. Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_APP_URL
 * from the environment or `.env.local` (`vercel env pull .env.local` for staging and prod). The
 * secret key never leaves this script; the app itself never uses it for sign in. Plain Node.
 */
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { buildConfirmRedirectUrl } from "../src/lib/auth/confirm-url.ts";

loadEnv({ path: ".env.local", quiet: true });

const ROLES = ["expert", "ops"] as const;
const LOCALES = ["de", "en"] as const;
type Role = (typeof ROLES)[number];
type LocaleCode = (typeof LOCALES)[number];

function fail(message: string): never {
  console.error(`user:invite: ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is not set (export it or put it in .env.local)`);
  return value;
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    role: { type: "string" },
    locale: { type: "string", default: "en" },
    name: { type: "string" },
  },
});

const email = values.email?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("--email <address> is required");
const role = values.role as Role | undefined;
if (!role || !ROLES.includes(role)) fail(`--role must be one of: ${ROLES.join(", ")}`);
const locale = values.locale as LocaleCode;
if (!LOCALES.includes(locale)) fail(`--locale must be one of: ${LOCALES.join(", ")}`);

const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SECRET_KEY"),
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  },
);
const redirectTo = buildConfirmRedirectUrl(
  requireEnv("NEXT_PUBLIC_APP_URL"),
  locale,
  "/reset-password",
);

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  email_confirm: false,
  app_metadata: { role },
  user_metadata: { locale, ...(values.name ? { full_name: values.name } : {}) },
});
if (createError) fail(`could not create ${email}: ${createError.message}`);

const { data: profile, error: roleError } = await supabase
  .from("profiles")
  .update({ role })
  .eq("id", created.user.id)
  .select("role")
  .single();
if (roleError || profile.role !== role) {
  await supabase.auth.admin.deleteUser(created.user.id);
  fail(
    `could not set the role on the profile (${roleError?.message ?? "no row"}); the user was removed again`,
  );
}

const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
if (inviteError)
  fail(`user ${created.user.id} created, but the invite email failed: ${inviteError.message}`);

console.log(
  `invited ${email} as ${role} (${locale}); user ${created.user.id}; the link opens ${redirectTo}`,
);
