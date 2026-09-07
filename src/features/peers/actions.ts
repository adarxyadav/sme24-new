"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOGA_SECTIONS } from "@/features/benchmark/catalogue";
import { type Locale, resolveLocale } from "@/i18n/routing";
import { structuredOutput } from "@/lib/ai/gateway";
import {
  PEER_PROPOSAL_PROMPT_VERSION,
  peerProposalPrompt,
  peerProposalSystemPrompt,
} from "@/lib/ai/prompts/peer-proposal";
import { type PeerCandidate, peerProposalSchema } from "@/lib/ai/schemas/peer-proposal";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { HOUSE_ORGANIZATION_ID, MAX_PEERS_PER_SET, PROPOSAL_MODEL } from "./catalogue";
import { type PeerSkip, startPeerRuns } from "./runs";
import {
  addPeerSchema,
  peerIdSchema,
  proposePeersSchema,
  rejectPeerSchema,
  researchPeersSchema,
} from "./schema";

type Client = SupabaseClient<Database>;

/**
 * The peer server actions (spec 0012, AC-1 to AC-4): ops propose candidates through the model,
 * add a peer by hand, approve, reject and retire one, and start research on a batch or a single
 * peer. Every action checks the ops role
 * from the claims (not only the proxy), parses its input with the feature's schema and answers a
 * typed result. Writes to `peer_companies` and `companies` go through the ops policies under
 * RLS; only the research run insert uses the service client, because an ops token never carries
 * the house organization (see `runs.ts`).
 */

export type PeerActionError =
  | "validation"
  | "forbidden"
  | "not_found"
  | "invalid_status"
  | "set_full"
  | "already_full"
  | "duplicate"
  | "ai_unavailable"
  | "trigger_unavailable"
  | "unexpected";

export type PeerActionResult<Data> =
  | { ok: true; data: Data }
  | { ok: false; error: PeerActionError };

/** Only Swiss companies are in scope (spec 0001), so the country is a constant. */
const COUNTRY = "CH";

type Actor = { readonly supabase: Client; readonly userId: string };

/** A signed in ops user; authorization lives here, not only in the proxy. */
async function requireOps(): Promise<Actor | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "ops" || typeof claims?.sub !== "string") return null;
  return { supabase, userId: claims.sub };
}

function localeOf(input: unknown): Locale {
  return resolveLocale((input as { locale?: unknown } | null)?.locale);
}

export type AddPeerData = { peerId: string; companyId: string };

/**
 * Adds a peer by hand (AC-1): a `companies` row in the house organization marked `is_peer` and
 * its `peer_companies` row as `proposed` by ops. A house company of the same name answers
 * `duplicate`. A failed peer insert removes the company again. Server action, ops.
 */
export async function addPeer(
  _previous: PeerActionResult<AddPeerData> | null,
  input: unknown,
): Promise<PeerActionResult<AddPeerData>> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(addPeerSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, userId } = actor;
  const { name, legalName, website, section, sizeBand } = parsed.data;

  const { data: existing, error: existingError } = await supabase
    .from("companies")
    .select("id")
    .eq("organization_id", HOUSE_ORGANIZATION_ID)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (existingError) return unexpected("add-peer", existingError);
  if (existing) return { ok: false, error: "duplicate" };

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({
      organization_id: HOUSE_ORGANIZATION_ID,
      name,
      legal_name: legalName,
      website,
      country: COUNTRY,
      is_peer: true,
      created_by: userId,
    })
    .select("id")
    .single();
  if (companyError) return unexpected("add-peer", companyError);

  const { data: peer, error: peerError } = await supabase
    .from("peer_companies")
    .insert({
      company_id: company.id,
      industry_section: section,
      size_band: sizeBand,
      proposed_by: "ops",
    })
    .select("id")
    .single();
  if (peerError) {
    const { error: removeError } = await supabase.from("companies").delete().eq("id", company.id);
    if (removeError)
      log.warn("peer company not removed", { companyId: company.id, reason: removeError.message });
    return unexpected("add-peer", peerError);
  }
  log.info("peer added by hand", {
    peerId: peer.id,
    companyId: company.id,
    section,
    sizeBand,
    by: userId,
  });
  return { ok: true, data: { peerId: peer.id, companyId: company.id } };
}

export type ApprovePeerData = { id: string; displayLabel: string };

/**
 * Approves a proposed or retired peer (AC-3) through `public.approve_peer_company`, which holds
 * the ten peer cap and the label under an advisory lock; the SQLSTATE names the refusal. Server
 * action, ops.
 */
export async function approvePeer(
  _previous: PeerActionResult<ApprovePeerData> | null,
  input: unknown,
): Promise<PeerActionResult<ApprovePeerData>> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(peerIdSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { peerId } = parsed.data;
  const { data, error } = await actor.supabase.rpc("approve_peer_company", { peer_id: peerId });
  if (error) {
    const code = approvalError(error);
    if (code === "unexpected") return unexpected("approve-peer", error);
    log.info("peer approval refused", { peerId, reason: code });
    return { ok: false, error: code };
  }
  log.info("peer approved", { peerId, displayLabel: data, by: actor.userId });
  return { ok: true, data: { id: peerId, displayLabel: data } };
}

/** The function's refusals by SQLSTATE and message (`SM403`, `SM404`, `SM409` set_full or invalid_status). Pure. */
function approvalError(error: {
  readonly code?: string | null;
  readonly message: string;
}): PeerActionError {
  if (error.code === "SM403") return "forbidden";
  if (error.code === "SM404") return "not_found";
  if (error.code === "SM409")
    return error.message.includes("set_full") ? "set_full" : "invalid_status";
  return "unexpected";
}

export type PeerIdData = { id: string };

/** Rejects a proposed peer with an optional reason (AC-3); the row stays so the name is not proposed again. Server action, ops. */
export async function rejectPeer(
  _previous: PeerActionResult<PeerIdData> | null,
  input: unknown,
): Promise<PeerActionResult<PeerIdData>> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(rejectPeerSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { peerId, reason } = parsed.data;
  return transition(actor, "reject-peer", peerId, "proposed", {
    status: "rejected",
    rejection_reason: reason,
  });
}

/** Retires an approved peer (AC-3): it drops out of every set and frees its label. Server action, ops. */
export async function retirePeer(
  _previous: PeerActionResult<PeerIdData> | null,
  input: unknown,
): Promise<PeerActionResult<PeerIdData>> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(peerIdSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  return transition(actor, "retire-peer", parsed.data.peerId, "approved", {
    status: "retired",
    display_label: null,
  });
}

/** One guarded status move: the update names the current status, so a stale screen answers `invalid_status`. */
async function transition(
  { supabase, userId }: Actor,
  action: string,
  peerId: string,
  from: Database["public"]["Tables"]["peer_companies"]["Row"]["status"],
  patch: Database["public"]["Tables"]["peer_companies"]["Update"],
): Promise<PeerActionResult<PeerIdData>> {
  const { data, error } = await supabase
    .from("peer_companies")
    .update(patch)
    .eq("id", peerId)
    .eq("status", from)
    .select("id");
  if (error) return unexpected(action, error);
  if (data.length === 0) {
    const { data: row, error: rowError } = await supabase
      .from("peer_companies")
      .select("id")
      .eq("id", peerId)
      .maybeSingle();
    if (rowError) return unexpected(action, rowError);
    return { ok: false, error: row ? "invalid_status" : "not_found" };
  }
  log.info(`${action} done`, { peerId, to: patch.status, by: userId });
  return { ok: true, data: { id: peerId } };
}

export type ResearchPeersData = { triggered: number; skipped: readonly PeerSkip[] };

/**
 * Starts research on a confirmed batch (AC-4): the ids are a request; `startPeerRuns` re reads
 * them, skips what is no longer approved or already running, inserts each run through the
 * service client and triggers the task. Answers `trigger_unavailable` before any write when the
 * task runner is not configured. Server action, ops.
 */
export async function researchPeers(
  _previous: PeerActionResult<ResearchPeersData> | null,
  input: unknown,
): Promise<PeerActionResult<ResearchPeersData>> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(researchPeersSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const service = serviceClient();
  if (!service) return { ok: false, error: "trigger_unavailable" };
  try {
    const result = await startPeerRuns(service, parsed.data.peerIds, actor.userId);
    return { ok: true, data: { triggered: result.triggered.length, skipped: result.skipped } };
  } catch (error) {
    return unexpected("research-peers", error);
  }
}

export type RerunPeerData = { runId: string };

/** Reruns one approved peer on demand (AC-14) through the same path as the batch. Server action, ops. */
export async function rerunPeer(
  _previous: PeerActionResult<RerunPeerData> | PeerRerunRefused | null,
  input: unknown,
): Promise<PeerActionResult<RerunPeerData> | PeerRerunRefused> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(peerIdSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const service = serviceClient();
  if (!service) return { ok: false, error: "trigger_unavailable" };
  try {
    const result = await startPeerRuns(service, [parsed.data.peerId], actor.userId);
    const started = result.triggered[0];
    if (started) return { ok: true, data: { runId: started.runId } };
    const skip = result.skipped[0];
    return { ok: false, error: skip?.reason ?? "unexpected" };
  } catch (error) {
    return unexpected("rerun-peer", error);
  }
}

/** A rerun refused for one of the skip reasons (`not_approved`, `run_in_progress`, `quota_exceeded`, `trigger_failed`). */
export type PeerRerunRefused = { ok: false; error: PeerSkip["reason"] };

export type ProposePeersData = { proposed: number };

/**
 * Proposes candidates for one section and band (AC-2): reads the names already on the list so
 * the model does not repeat them, asks the model through `structuredOutput`, and stores each
 * candidate as a `proposed` peer with the model, the prompt version and the reason recorded. No
 * research run is triggered and no number the model returns is ever stored. Refuses with
 * `already_full` when the set already holds ten approved peers, so nothing is spent on a set
 * that cannot take another peer. Server action, ops.
 */
export async function proposePeers(
  _previous: PeerActionResult<ProposePeersData> | null,
  input: unknown,
): Promise<PeerActionResult<ProposePeersData>> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(proposePeersSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase } = actor;
  const { section, sizeBand, count } = parsed.data;

  const { data: onFile, error: onFileError } = await supabase
    .from("peer_companies")
    .select("status, company:companies!inner(name, legal_name)")
    .eq("industry_section", section)
    .eq("size_band", sizeBand);
  if (onFileError) return unexpected("propose-peers", onFileError);
  if (onFile.filter((row) => row.status === "approved").length >= MAX_PEERS_PER_SET) {
    return { ok: false, error: "already_full" };
  }
  const exclude = [
    ...new Set(
      onFile.flatMap((row) =>
        [row.company.name, row.company.legal_name].filter((name): name is string => Boolean(name)),
      ),
    ),
  ];

  const apiKey = serverEnv().AI_GATEWAY_API_KEY;
  if (!apiKey) {
    log.warn("peer proposal skipped: AI_GATEWAY_API_KEY is not set", { section, sizeBand });
    return { ok: false, error: "ai_unavailable" };
  }
  let candidates: readonly PeerCandidate[];
  try {
    const output = await structuredOutput({
      apiKey,
      schema: peerProposalSchema,
      system: peerProposalSystemPrompt(),
      prompt: peerProposalPrompt({
        section,
        sectionName: sectionNameOf(section),
        sizeBand,
        count,
        exclude,
      }),
    });
    candidates = output.candidates;
  } catch (error) {
    log.error("peer proposal failed", {
      section,
      sizeBand,
      reason: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { source: "propose-peers" } });
    return { ok: false, error: "ai_unavailable" };
  }

  const known = new Set(exclude.map((name) => name.toLowerCase()));
  const fresh = candidates.filter((candidate) => !known.has(candidate.name.toLowerCase()));
  const proposedAt = new Date().toISOString();
  let stored = 0;
  try {
    for (const candidate of fresh) {
      if (await storeCandidate(actor, candidate, section, sizeBand, proposedAt)) stored += 1;
    }
  } catch (error) {
    return unexpected("propose-peers", error);
  }
  log.info("peers proposed", {
    section,
    sizeBand,
    returned: candidates.length,
    stored,
    by: actor.userId,
  });
  return { ok: true, data: { proposed: stored } };
}

/** One candidate as a house company plus its `proposed` peer row; a name already on file is skipped. */
async function storeCandidate(
  { supabase, userId }: Actor,
  candidate: PeerCandidate,
  section: string,
  sizeBand: string,
  proposedAt: string,
): Promise<boolean> {
  const { data: existing, error: existingError } = await supabase
    .from("companies")
    .select("id")
    .eq("organization_id", HOUSE_ORGANIZATION_ID)
    .ilike("name", candidate.name)
    .limit(1)
    .maybeSingle();
  if (existingError) throw queryError(existingError);
  if (existing) return false;

  const host = candidate.website?.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({
      organization_id: HOUSE_ORGANIZATION_ID,
      name: candidate.name,
      legal_name: candidate.legalName,
      website: host ? `https://${host}` : null,
      country: COUNTRY,
      is_peer: true,
      created_by: userId,
    })
    .select("id")
    .single();
  if (companyError) throw queryError(companyError);

  const { error: peerError } = await supabase.from("peer_companies").insert({
    company_id: company.id,
    industry_section: section,
    size_band: sizeBand,
    proposed_by: "ai",
    proposal: {
      model: PROPOSAL_MODEL,
      promptVersion: PEER_PROPOSAL_PROMPT_VERSION,
      reason: candidate.reason,
      proposedAt,
    },
  });
  if (peerError) {
    const { error: removeError } = await supabase.from("companies").delete().eq("id", company.id);
    if (removeError) {
      log.warn("proposed company not removed", {
        companyId: company.id,
        reason: removeError.message,
      });
    }
    throw queryError(peerError);
  }
  return true;
}

/** The section's English name for the prompt (not user facing text, so not a message key). Pure. */
function sectionNameOf(section: string): string {
  const known = NOGA_SECTIONS.some((entry) => entry.letter === section);
  return known ? (SECTION_NAMES[section] ?? section) : section;
}

/**
 * The 21 NOGA section names in English, for the proposal prompt only. The client facing labels
 * live in the message catalogs (`benchmark.noga.sections`); a prompt is not user facing text, so
 * it does not go through next-intl.
 */
const SECTION_NAMES: Record<string, string> = {
  A: "Agriculture, forestry and fishing",
  B: "Mining and quarrying",
  C: "Manufacturing",
  D: "Electricity, gas, steam and air conditioning supply",
  E: "Water supply, sewerage and waste management",
  F: "Construction",
  G: "Wholesale and retail trade, repair of motor vehicles",
  H: "Transportation and storage",
  I: "Accommodation and food service activities",
  J: "Information and communication",
  K: "Financial and insurance activities",
  L: "Real estate activities",
  M: "Professional, scientific and technical activities",
  N: "Administrative and support service activities",
  O: "Public administration and defence",
  P: "Education",
  Q: "Human health and social work activities",
  R: "Arts, entertainment and recreation",
  S: "Other service activities",
  T: "Activities of households as employers",
  U: "Activities of extraterritorial organisations and bodies",
};

/** The service client for the run insert, or null when the task runner is not configured (no key, no run). */
function serviceClient(): Client | null {
  const env = serverEnv();
  if (!env.TRIGGER_SECRET_KEY) {
    log.warn("peer research not started: TRIGGER_SECRET_KEY is not set");
    return null;
  }
  return createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
}

function unexpected(action: string, error: unknown): { ok: false; error: "unexpected" } {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: string })?.message ?? error);
  log.error(`${action} failed`, { reason: message });
  Sentry.captureException(error instanceof Error ? error : queryError({ message }), {
    tags: { source: action },
  });
  return { ok: false, error: "unexpected" };
}
