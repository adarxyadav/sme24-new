/**
 * Invites an expert or ops user with their role fixed (spec 0005, AC-10):
 *
 *   pnpm user:invite --email erika@example.com --role expert [--locale en] [--name "Erika Expert"]
 *
 * The steps themselves live in `src/lib/auth/invite.ts`, shared with the ops action on
 * `/admin/experts/new` (spec 0012, AC-2), so this script and the admin page create the same two
 * rows in the same order and a fix to either lands in both. For `--role expert` that includes the
 * `expert_profiles` row, which is what puts the invitee on the ops list.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_APP_URL from the environment
 * or `.env.local` (`vercel env pull .env.local` for staging and prod). The secret key never leaves
 * this script; the app itself never uses it for sign in. Plain Node.
 */
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { createInviteClient, inviteStaffUser } from "../src/lib/auth/invite.ts";

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

const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");
const supabase = createInviteClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SECRET_KEY"),
);

const result = await inviteStaffUser(supabase, {
  email,
  role,
  locale,
  fullName: values.name,
  appUrl,
});

if (!result.ok) {
  if (result.error === "already_invited") {
    fail(`${email} has already been invited as an expert; resend from /admin/experts instead`);
  }
  if (result.error === "email_taken") {
    fail(`${email} already has an account`);
  }
  fail(`could not invite ${email}: ${result.message}`);
}

console.log(
  `invited ${email} as ${role} (${locale}); user ${result.userId}; the link opens ${appUrl.replace(/\/$/, "")}/${locale}/reset-password`,
);
