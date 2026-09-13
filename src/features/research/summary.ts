import { z } from "zod";
import { KPI_KEYS, RUN_STEPS } from "./catalogue";

/**
 * The `research_runs.summary` shape, version 1 (spec 0007, Feature design). Counters and `step`
 * are written as the task goes; the rest lands with the terminal status, so every field but
 * `version` and `step` is optional while the run is open. Pure schema, runs anywhere.
 */

export const DROP_REASONS = [
  "unsupported",
  "out_of_range",
  "bad_year",
  "conflict",
  "unparseable",
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** The 26 cantons as the two letter codes `companies.canton` accepts. */
export const CANTON_CODES = [
  "AG",
  "AI",
  "AR",
  "BE",
  "BL",
  "BS",
  "FR",
  "GE",
  "GL",
  "GR",
  "JU",
  "LU",
  "NE",
  "NW",
  "OW",
  "SG",
  "SH",
  "SO",
  "SZ",
  "TG",
  "TI",
  "UR",
  "VD",
  "VS",
  "ZG",
  "ZH",
] as const;

/**
 * The facts a run may write onto the company, as a function of the company's country (spec 0022,
 * AC-3). The register identifier is only forced into the Swiss `CHE-123.456.789` shape when the
 * country is `CH`; elsewhere it is whatever the national register prints, kept as a short string.
 * The canton is Swiss by definition, so a company outside CH never carries one. Pure.
 */
export function companyFactsSchemaFor(country: string) {
  const swiss = country === "CH";
  const uid = z.string().trim().min(1).max(40);
  return z.object({
    legalName: z.string().trim().min(1).max(200).optional(),
    uid: (swiss ? uid.regex(/^CHE-\d{3}\.\d{3}\.\d{3}$/) : uid).optional(),
    industryCode: z
      .string()
      .trim()
      .regex(/^\d{2}(?:\.\d{2})?$/)
      .optional(),
    employeesCount: z.number().int().min(0).optional(),
    ...(swiss ? { canton: z.enum(CANTON_CODES).optional() } : {}),
  });
}

/** The stored shape of `summary.companyFacts`: every field a run may have written, all optional. */
export const companyFactsSchema = z.object({
  legalName: z.string().trim().min(1).max(200).optional(),
  uid: z.string().trim().min(1).max(40).optional(),
  industryCode: z
    .string()
    .trim()
    .regex(/^\d{2}(?:\.\d{2})?$/)
    .optional(),
  employeesCount: z.number().int().min(0).optional(),
  canton: z.enum(CANTON_CODES).optional(),
});
export type CompanyFacts = z.infer<typeof companyFactsSchema>;

export const summarySourceSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(500),
  retrievedAt: z.string(),
});
export type SummarySource = z.infer<typeof summarySourceSchema>;

export const droppedValueSchema = z.object({
  key: z.enum(KPI_KEYS),
  year: z.number().int().nullable(),
  value: z.number().nullable(),
  reason: z.enum(DROP_REASONS),
});
export type DroppedValue = z.infer<typeof droppedValueSchema>;

/** Why a peer the provider returned was not kept (spec 0022, AC-8). */
export const PEER_DROP_REASONS = ["self", "unsupported"] as const;
export type PeerDropReason = (typeof PEER_DROP_REASONS)[number];

/** The four outcomes the peer task reports through `summary.peers.status` (spec 0022, AC-7). */
export const PEER_STATUSES = ["ok", "skipped", "failed", "timeout"] as const;
export type PeerStatus = (typeof PEER_STATUSES)[number];

/** The three rungs of the geography ladder the peer task settles on (spec 0022, AC-7). */
export const PEER_RUNGS = ["country", "region", "world"] as const;
export type PeerRung = (typeof PEER_RUNGS)[number];

export const droppedPeerSchema = z.object({
  name: z.string().max(200),
  reason: z.enum(PEER_DROP_REASONS),
});
export type DroppedPeer = z.infer<typeof droppedPeerSchema>;

/**
 * What the `research-peers` task reports on the run it ran for (spec 0022, AC-7, AC-8). It is the
 * task's only channel: the run's `status` and `error_code` stay the client task's alone, so a peer
 * failure shows here and nowhere else. `found` counts the kept peers, `rung` is null when none were
 * kept, and `thin` says the comparison rests on fewer than three peers.
 */
export const peersSummarySchema = z.object({
  status: z.enum(PEER_STATUSES),
  found: z.number().int().min(0),
  rung: z.enum(PEER_RUNGS).nullable(),
  thin: z.boolean(),
  dropped: z.array(droppedPeerSchema).max(50).optional(),
  validation: z.enum(["passed", "skipped"]).optional(),
  promptVersion: z.string().optional(),
  durationMs: z.number().int().min(0).optional(),
  /** The short safe sentence naming the cause when `status` is `failed` or `timeout`. */
  reason: z.string().max(300).optional(),
});
export type PeersSummary = z.infer<typeof peersSummarySchema>;

export const researchSummarySchema = z.object({
  version: z.literal(1),
  step: z.enum(RUN_STEPS),
  processor: z.enum(["core", "fixture"]).optional(),
  sourcesFound: z.number().int().min(0).optional(),
  kpisExtracted: z.number().int().min(0).optional(),
  coverage: z.partialRecord(z.enum(KPI_KEYS), z.enum(["found", "not_found"])).optional(),
  years: z.array(z.number().int()).optional(),
  sources: z.array(summarySourceSchema).max(25).optional(),
  text: z.string().max(1000).nullable().optional(),
  companyFacts: companyFactsSchema.optional(),
  dropped: z.array(droppedValueSchema).optional(),
  validation: z.enum(["passed", "skipped"]).optional(),
  promptVersion: z.string().optional(),
  /** Written by the `research-peers` task after the run's terminal write (spec 0022, AC-7). */
  peers: peersSummarySchema.optional(),
  durations: z
    .object({
      searchMs: z.number().int().min(0),
      validationMs: z.number().int().min(0),
      totalMs: z.number().int().min(0),
    })
    .optional(),
});
export type ResearchSummary = z.infer<typeof researchSummarySchema>;

/** The summary of a run row, or null when it is missing or of another shape. Pure. */
export function parseSummary(value: unknown): ResearchSummary | null {
  const parsed = researchSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The sources array stored on a `company_kpis` row (AC-6). */
export const kpiSourceSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(500),
  excerpt: z.string().max(2000),
  retrievedAt: z.string(),
});
export type KpiSource = z.infer<typeof kpiSourceSchema>;

/** The parsed `sources` of a `company_kpis` row; malformed entries are skipped. Pure. */
export function parseKpiSources(value: unknown): readonly KpiSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = kpiSourceSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
