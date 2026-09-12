import {
  CLOSED_RETENTION_DAYS,
  EMAIL_DELIVERY_RETENTION_DAYS,
  IP_HASH_RETENTION_DAYS,
} from "./retention-periods";

/**
 * What the privacy page says, as typed data rather than prose (spec 0015, AC-7, AC-8): every
 * processor SME24 uses and every retention period of a table holding personal data. A stack
 * change is a one line edit here, and the page cannot drift from the code without a test
 * failing. Pure data; read by the privacy page (a server component) and by tests.
 */

/** Where a processor stores the data it handles for SME24. */
export type ProcessorRegion = "ch" | "eu" | "us";

/** The processor ids, so the privacy page's `processors.<id>.purpose` key resolves to a real one. */
export type ProcessorId =
  | "supabase"
  | "vercel"
  | "trigger"
  | "resend"
  | "stripe"
  | "anthropic"
  | "parallel"
  | "posthog"
  | "sentry";

export type Processor = {
  /** The key of the `legalPages.privacy.processors.<id>.purpose` message in both catalogues. */
  readonly id: ProcessorId;
  /** The company as it must be named, not the product name. */
  readonly name: string;
  readonly region: ProcessorRegion;
};

/**
 * Every third party that processes personal data on SME24's behalf, in the order the page lists
 * them: the platform first, then the things it calls. A new vendor is a row here plus a
 * `purpose` key in both catalogues; the processors test fails while either is missing.
 */
export const PROCESSORS: readonly Processor[] = [
  { id: "supabase", name: "Supabase, Inc.", region: "ch" },
  { id: "vercel", name: "Vercel, Inc.", region: "eu" },
  { id: "trigger", name: "Trigger.dev Ltd.", region: "eu" },
  { id: "resend", name: "Resend, Inc.", region: "eu" },
  { id: "stripe", name: "Stripe Payments Europe, Ltd.", region: "eu" },
  { id: "anthropic", name: "Anthropic PBC, through the Vercel AI Gateway", region: "us" },
  { id: "parallel", name: "Parallel Web Systems, Inc.", region: "us" },
  { id: "posthog", name: "PostHog, Inc.", region: "eu" },
  { id: "sentry", name: "Functional Software, Inc. (Sentry)", region: "eu" },
] as const;

/**
 * The three honest answers to "how long do you keep it" (AC-8). `indefinite` exists because
 * `benchmark_snapshots` and `research_runs` genuinely have no end date, and calling them either
 * of the other two would be false.
 */
export type RetentionKind =
  /** A purge task deletes or nulls it after `days`. */
  | "purged"
  /** Kept while the account exists, removed or anonymised when it is closed. */
  | "account"
  /** Kept without an end date, for the reason the message key names. */
  | "indefinite";

/** The table names, so the privacy page's `retention.<table>.purpose` key resolves to a real one. */
export type RetentionTable =
  | "profiles"
  | "organization_members"
  | "expert_profiles"
  | "companies"
  | "company_kpis"
  | "notifications"
  | "email_deliveries"
  | "enquiries"
  | "enquiries_ip_hash"
  | "orders"
  | "invoices"
  | "order_events"
  | "research_runs"
  | "benchmark_snapshots"
  | "audit_log"
  | "directory_companies"
  | "directory_contacts"
  | "directory_suppressions"
  | "directory_unlocks"
  | "directory_credit_entries"
  | "directory_imports";

export type Retention = {
  /** The table, and the key of the `legalPages.privacy.retention.<table>.purpose` message. */
  readonly table: RetentionTable;
  readonly kind: RetentionKind;
  /** The number of days a `purged` row survives; null for the other two kinds. */
  readonly days: number | null;
};

/**
 * Every table holding personal data, with its period. The `days` of a purged row is imported
 * from the task that actually enforces it, never retyped, so a task whose schedule changes
 * cannot leave the privacy page claiming the old number.
 */
export const RETENTION: readonly Retention[] = [
  { table: "profiles", kind: "account", days: null },
  { table: "organization_members", kind: "account", days: null },
  { table: "expert_profiles", kind: "account", days: null },
  { table: "companies", kind: "account", days: null },
  { table: "company_kpis", kind: "account", days: null },
  { table: "notifications", kind: "account", days: null },
  { table: "email_deliveries", kind: "purged", days: EMAIL_DELIVERY_RETENTION_DAYS },
  { table: "enquiries", kind: "purged", days: CLOSED_RETENTION_DAYS },
  { table: "enquiries_ip_hash", kind: "purged", days: IP_HASH_RETENTION_DAYS },
  { table: "orders", kind: "indefinite", days: null },
  { table: "invoices", kind: "indefinite", days: null },
  { table: "order_events", kind: "indefinite", days: null },
  { table: "research_runs", kind: "indefinite", days: null },
  { table: "benchmark_snapshots", kind: "indefinite", days: null },
  { table: "audit_log", kind: "indefinite", days: null },
  // The contact directory (spec 0018, AC-16). The two contact tables are `indefinite` until the
  // owner's retention question comes back with the lawyer's licence answer; the suppression hash
  // is indefinite by design (the hash is the objection); the import row is the audit of every
  // bulk write; and the two expert owned tables are the record of what was sold, never `account`,
  // because anonymisePerson touches profiles and expert_profiles only and a profile is never
  // deleted, so nothing would implement `account`.
  { table: "directory_companies", kind: "indefinite", days: null },
  { table: "directory_contacts", kind: "indefinite", days: null },
  { table: "directory_suppressions", kind: "indefinite", days: null },
  { table: "directory_unlocks", kind: "indefinite", days: null },
  { table: "directory_credit_entries", kind: "indefinite", days: null },
  { table: "directory_imports", kind: "indefinite", days: null },
] as const;

/**
 * The facts of the contact directory block on the privacy page (spec 0018, AC-16): the purchased
 * list is processing of people who never signed up, so the page names the source batch, the
 * purpose, the legal basis and the promise made to an objector. Every fact is a constant here so
 * the prose cannot claim something the code does not do; the objection address is `SITE.email`.
 */
export const DIRECTORY_PROCESSING = {
  /** The supplier's batch name, recorded on every contact row and import run. */
  sourceBatch: "20260902 Global Account Lists",
  /** The basis code of the record of processing: legitimate interest under the supplier's licence. */
  basis: "interest",
  /** Days within which an objection is honoured; the hash then keeps the person out for good. */
  removalDays: 30,
  /** What one reveal costs, as the page states it. */
  creditPriceChf: 1.99,
} as const;
