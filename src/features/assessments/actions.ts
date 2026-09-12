"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale } from "next-intl/server";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { sendOpsAlert } from "@/lib/alerts/send";
import { captureServerEvent } from "@/lib/analytics/server";
import { roleFromClaims } from "@/lib/auth/roles";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { parseWith } from "@/lib/validation";
import { PACKAGE_QUESTIONNAIRES } from "./catalogue";
import type { LocalizedText } from "./content-schema";
import { classifyAssessmentError } from "./errors";
import { computeProgress, computeScore } from "./model";
import { getAssessment, getNewestVersion, listExpertBookings } from "./queries";
import {
  saveAnswerSchema,
  startAssessmentSchema,
  submitAssessmentSchema,
  updateAssessmentDetailsSchema,
  zurichCalendarDate,
} from "./schema";

/**
 * The assessment actions (spec 0019, AC-5, AC-6, AC-9, AC-12), every one on the caller's own
 * client: no service client anywhere in this feature, because every write is allowed by a policy
 * or a column grant and the database holds the guards (one draft per company and questionnaire,
 * complete before submit, locked after, expert only writes). Each action authorises the caller
 * here rather than trusting the area gate, which never runs for an action post, and answers a
 * typed result without throwing for an expected failure.
 */

type Client = SupabaseClient<Database>;

/** The booking states an assessment can still be started against. */
const OPEN_BOOKING_STATUSES: readonly string[] = ["scheduled", "in_progress"];

export type StartAssessmentResult =
  | { ok: true; data: { assessmentId: string } }
  | {
      ok: false;
      error:
        | "validation"
        | "forbidden"
        | "not_assigned"
        | "draft_exists"
        | "unknown_questionnaire"
        | "company_mismatch"
        | "unexpected";
    };

export type UpdateAssessmentDetailsResult =
  | { ok: true; data: { assessmentId: string } }
  | {
      ok: false;
      error: "validation" | "forbidden" | "not_found" | "locked" | "invalid" | "unexpected";
    };

export type SaveAnswerResult =
  | { ok: true; data: { savedAt: string } }
  | {
      ok: false;
      error: "validation" | "forbidden" | "not_found" | "locked" | "invalid" | "unexpected";
    };

/** One section still missing ratings, for the submit dialog to name (AC-9). */
export type IncompleteSection = {
  readonly key: string;
  readonly label: string;
  readonly title: LocalizedText;
  readonly unrated: number;
};

export type SubmitAssessmentResult =
  | { ok: true; data: { submittedAt: string; score: number | null } }
  | { ok: false; error: "incomplete"; unrated: number; sections: readonly IncompleteSection[] }
  | { ok: false; error: "validation" | "forbidden" | "not_found" | "locked" | "unexpected" };

type Actor = {
  readonly supabase: Client;
  readonly userId: string;
};

/** A signed in expert; anything else is `forbidden`. The policies decide the rest. */
async function requireExpert(): Promise<Actor | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "expert" || typeof claims?.sub !== "string") return null;
  return { supabase, userId: claims.sub };
}

/**
 * Starts a draft (AC-5): pins the newest version of the questionnaire, links the caller's newest
 * open booking for that organization whose package runs this checklist (else no order), pre fills
 * the visit date from that booking as a Swiss calendar date, and inserts with the caller as the
 * expert. The insert policy is what refuses an expert who is not assigned (`not_assigned`) and the
 * partial unique index what refuses a second draft (`draft_exists`); the company check runs first
 * so a mismatched company is named rather than folded into the policy refusal. Captures
 * `assessment.started` after the insert. Server action, expert.
 */
export async function startAssessment(
  _previous: StartAssessmentResult | null,
  input: unknown,
): Promise<StartAssessmentResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireExpert();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(startAssessmentSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, userId } = actor;
  const { organizationId, companyId, questionnaireKey } = parsed.data;

  try {
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, organization_id")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) return unexpected("start-assessment", companyError, { organizationId });
    if (!company || company.organization_id !== organizationId) {
      return { ok: false, error: "company_mismatch" };
    }

    const [version, bookings] = await Promise.all([
      getNewestVersion(supabase, questionnaireKey),
      listExpertBookings(supabase, organizationId),
    ]);
    if (!version) return { ok: false, error: "unknown_questionnaire" };

    const booking = bookings.find(
      (candidate) =>
        candidate.companyId === companyId &&
        OPEN_BOOKING_STATUSES.includes(candidate.status) &&
        (PACKAGE_QUESTIONNAIRES[candidate.packageKey] ?? []).includes(questionnaireKey),
    );

    const { data: inserted, error } = await supabase
      .from("assessments")
      .insert({
        organization_id: organizationId,
        company_id: companyId,
        order_id: booking?.id ?? null,
        questionnaire_key: questionnaireKey,
        questionnaire_version_key: version.key,
        expert_id: userId,
        conducted_on: booking?.scheduledAt
          ? zurichCalendarDate(new Date(booking.scheduledAt))
          : null,
      })
      .select("id")
      .single();
    if (error) {
      const classified = classifyAssessmentError(error, "start");
      if (classified.code === "not_assigned") return { ok: false, error: "not_assigned" };
      if (classified.code === "draft_exists") return { ok: false, error: "draft_exists" };
      if (classified.code === "unknown_questionnaire") {
        return { ok: false, error: "unknown_questionnaire" };
      }
      return unexpected("start-assessment", error, { organizationId });
    }

    log.info("assessment started", {
      assessmentId: inserted.id,
      organizationId,
      questionnaireKey,
      versionKey: version.key,
      orderId: booking?.id ?? null,
    });
    // After the insert (AC-12): the draft exists, whatever analytics does next.
    await captureServerEvent({
      distinctId: userId,
      event: "assessment.started",
      properties: {
        organizationId,
        locale: LOCALE_CODE[locale],
        assessmentId: inserted.id,
        questionnaireKey,
        orderId: booking?.id ?? null,
      },
    });
    return { ok: true, data: { assessmentId: inserted.id } };
  } catch (error) {
    return unexpected("start-assessment", error, { organizationId });
  }
}

/** The status of one assessment the caller may see, or null when RLS hides it. Throws. */
async function readStatus(
  supabase: Client,
  assessmentId: string,
): Promise<{ readonly organizationId: string; readonly status: string } | null> {
  const { data, error } = await supabase
    .from("assessments")
    .select("organization_id, status")
    .eq("id", assessmentId)
    .maybeSingle();
  if (error) throw error;
  return data ? { organizationId: data.organization_id, status: data.status } : null;
}

/**
 * Updates the site and the visit date of a draft (AC-6): the two columns the grant allows besides
 * the status. A submitted assessment is not in the update policy's using clause, so the row is
 * read first to tell `locked` from `not_found`; zero rows on the write means the assignment ended
 * in between, which is `not_found` to this caller. Server action, expert.
 */
export async function updateAssessmentDetails(
  _previous: UpdateAssessmentDetailsResult | null,
  input: unknown,
): Promise<UpdateAssessmentDetailsResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireExpert();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(updateAssessmentDetailsSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase } = actor;
  const { assessmentId, site, conductedOn } = parsed.data;

  try {
    const current = await readStatus(supabase, assessmentId);
    if (!current) return { ok: false, error: "not_found" };
    if (current.status !== "draft") return { ok: false, error: "locked" };

    const { data, error } = await supabase
      .from("assessments")
      .update({ site, conducted_on: conductedOn })
      .eq("id", assessmentId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) {
      const classified = classifyAssessmentError(error);
      if (classified.code === "not_found") return { ok: false, error: "not_found" };
      if (classified.code === "locked" || classified.code === "invalid_transition") {
        return { ok: false, error: "locked" };
      }
      return unexpected("update-assessment-details", error, { assessmentId });
    }
    if (!data) return { ok: false, error: "not_found" };
    return { ok: true, data: { assessmentId } };
  } catch (error) {
    return unexpected("update-assessment-details", error, { assessmentId });
  }
}

/**
 * Saves one item's rating and note (AC-6) as an upsert on `(assessment_id, item_id)`. The unique
 * index is partial, which PostgREST cannot upsert onto, so the row is read and then updated by
 * id or inserted. The two paths report a lock differently, on purpose: the lock trigger fires
 * before the insert policy, so a late insert comes back as `assessment_locked`, while a late
 * update is filtered by the policy first and comes back as zero rows; both answer `locked`. An
 * item that is not rateable or belongs to another version is `invalid` before any write.
 * Server action, expert.
 */
export async function saveAnswer(
  _previous: SaveAnswerResult | null,
  input: unknown,
): Promise<SaveAnswerResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireExpert();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(saveAnswerSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase } = actor;
  const { assessmentId, itemId, rating, note } = parsed.data;

  try {
    const { data: assessment, error: readError } = await supabase
      .from("assessments")
      .select("organization_id, status, questionnaire_version_key")
      .eq("id", assessmentId)
      .maybeSingle();
    if (readError) return unexpected("save-answer", readError, { assessmentId });
    if (!assessment) return { ok: false, error: "not_found" };
    if (assessment.status !== "draft") return { ok: false, error: "locked" };

    const { data: item, error: itemError } = await supabase
      .from("questionnaire_items")
      .select("id, version_key, rateable")
      .eq("id", itemId)
      .maybeSingle();
    if (itemError) return unexpected("save-answer", itemError, { assessmentId });
    if (!item || item.version_key !== assessment.questionnaire_version_key || !item.rateable) {
      return { ok: false, error: "invalid" };
    }

    const { data: existing, error: existingError } = await supabase
      .from("assessment_answers")
      .select("id")
      .eq("assessment_id", assessmentId)
      .eq("item_id", itemId)
      .maybeSingle();
    if (existingError) return unexpected("save-answer", existingError, { assessmentId });

    if (!existing) {
      const { data: inserted, error } = await supabase
        .from("assessment_answers")
        .insert({
          organization_id: assessment.organization_id,
          assessment_id: assessmentId,
          item_id: itemId,
          rating,
          note,
        })
        .select("updated_at")
        .maybeSingle();
      if (!error) {
        if (!inserted) return { ok: false, error: "locked" };
        return { ok: true, data: { savedAt: inserted.updated_at } };
      }
      const classified = classifyAssessmentError(error);
      // Another save of the same item landed first: fall through to the update path below.
      if (classified.code !== "draft_exists") {
        if (classified.code === "locked") return { ok: false, error: "locked" };
        if (classified.code === "not_found") return { ok: false, error: "not_found" };
        if (classified.code === "invalid") return { ok: false, error: "invalid" };
        return unexpected("save-answer", error, { assessmentId });
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("assessment_answers")
      .update({ rating, note })
      .eq("assessment_id", assessmentId)
      .eq("item_id", itemId)
      .select("updated_at")
      .maybeSingle();
    if (updateError) {
      const classified = classifyAssessmentError(updateError);
      if (classified.code === "locked") return { ok: false, error: "locked" };
      if (classified.code === "not_found") return { ok: false, error: "not_found" };
      return unexpected("save-answer", updateError, { assessmentId });
    }
    // Zero rows: the policy filtered the row, which after the read above means it locked.
    if (!updated) return { ok: false, error: "locked" };
    return { ok: true, data: { savedAt: updated.updated_at } };
  } catch (error) {
    return unexpected("save-answer", error, { assessmentId });
  }
}

/**
 * Submits a draft (AC-9): moves the status to `submitted`, which the transition trigger allows
 * only once every required item is rated and stamps `submitted_at`. On `assessment_incomplete`
 * the unrated count per section is recomputed with `computeProgress` over the same rows the
 * trigger counted, so the dialog can name the sections. After the write, `assessment.submitted`
 * is captured and the ops alert sent, both best effort. Server action, expert.
 */
export async function submitAssessment(
  _previous: SubmitAssessmentResult | null,
  input: unknown,
): Promise<SubmitAssessmentResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireExpert();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(submitAssessmentSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, userId } = actor;
  const { assessmentId } = parsed.data;

  try {
    const current = await readStatus(supabase, assessmentId);
    if (!current) return { ok: false, error: "not_found" };
    if (current.status !== "draft") return { ok: false, error: "locked" };

    const { data: updated, error } = await supabase
      .from("assessments")
      .update({ status: "submitted" })
      .eq("id", assessmentId)
      .eq("status", "draft")
      .select("submitted_at")
      .maybeSingle();
    if (error) {
      const classified = classifyAssessmentError(error);
      if (classified.code === "incomplete") {
        const page = await getAssessment(supabase, assessmentId);
        if (!page) return { ok: false, error: "not_found" };
        const progress = computeProgress(page.version.sections, page.items, page.answers);
        return {
          ok: false,
          error: "incomplete",
          unrated: progress.unrated,
          sections: progress.sections
            .filter((section) => section.unrated > 0)
            .map(({ key, label, title, unrated }) => ({ key, label, title, unrated })),
        };
      }
      if (classified.code === "locked" || classified.code === "invalid_transition") {
        return { ok: false, error: "locked" };
      }
      if (classified.code === "not_found") return { ok: false, error: "not_found" };
      return unexpected("submit-assessment", error, { assessmentId });
    }
    // Zero rows: another tab submitted in between, or the assignment ended.
    if (!updated?.submitted_at) return { ok: false, error: "locked" };
    const submittedAt = updated.submitted_at;

    // Everything from here on is reporting on a write that has landed; nothing may undo it.
    const page = await getAssessment(supabase, assessmentId);
    const score = page
      ? computeScore(page.version.sections, page.items, page.answers).overall
      : null;
    log.info("assessment submitted", {
      assessmentId,
      organizationId: current.organizationId,
      score,
    });

    if (page) {
      await captureServerEvent({
        distinctId: userId,
        event: "assessment.submitted",
        properties: {
          organizationId: page.assessment.organization_id,
          locale: LOCALE_CODE[locale],
          assessmentId,
          questionnaireKey: page.assessment.questionnaire_key,
          orderId: page.assessment.order_id,
        },
      });
      await sendSubmittedAlert(supabase, page.assessment.expert_id, {
        assessmentId,
        companyName: page.companyName,
        questionnaireTitle: page.version.title.en,
        score,
      });
    }

    return { ok: true, data: { submittedAt, score } };
  } catch (error) {
    return unexpected("submit-assessment", error, { assessmentId });
  }
}

/** The `assessment.submitted` alert (AC-12), best effort: a failure is logged and never reaches the caller. */
async function sendSubmittedAlert(
  supabase: Client,
  expertId: string,
  detail: {
    readonly assessmentId: string;
    readonly companyName: string | null;
    readonly questionnaireTitle: string;
    readonly score: number | null;
  },
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", expertId)
      .maybeSingle();
    await sendOpsAlert({
      kind: "assessment.submitted",
      fields: {
        companyName: detail.companyName ?? "Unknown company",
        questionnaireTitle: detail.questionnaireTitle,
        expertName: profile?.full_name ?? "Unnamed expert",
        scorePercent: detail.score,
      },
      link: "/admin/orders",
      idempotencyKey: `assessment/submitted/${detail.assessmentId}`,
    });
  } catch (error) {
    log.warn("assessment submitted alert not sent", {
      assessmentId: detail.assessmentId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function unexpected(
  action: string,
  error: unknown,
  extra: Record<string, string>,
): { ok: false; error: "unexpected" } {
  const detail = error as { message?: string; code?: string } | null;
  log.error(`${action} failed`, { ...extra, code: detail?.code, reason: detail?.message });
  Sentry.captureException(error, { tags: { source: action }, extra });
  return { ok: false, error: "unexpected" };
}
