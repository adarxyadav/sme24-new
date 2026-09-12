import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import type { QuestionnaireKey, RatingCode } from "./catalogue";
import {
  type ContentSection,
  contentSectionSchema,
  type LocalizedText,
  localizedTextSchema,
} from "./content-schema";
import { type AssessmentAnswer, type AssessmentItem, computeScore } from "./model";

/**
 * The reads of the assessment feature (spec 0019). Queries throw on a database error, per the
 * project's one error handling rule; the typed result shape belongs to the actions. RLS is what
 * limits every read to the rows the caller may see (a client member reads assessments and never
 * an answer, an expert reads the answers of their own assessments), so each runs with the
 * caller's own client and none takes a role as an argument.
 */

type Client = SupabaseClient<Database>;

export type AssessmentRow = Tables<"assessments">;
export type AssessmentStatus = "draft" | "submitted";

/** One `questionnaire_versions` row with its jsonb columns typed. */
export type QuestionnaireVersion = {
  readonly key: string;
  readonly questionnaireKey: string;
  readonly version: number;
  readonly title: LocalizedText;
  readonly sections: readonly ContentSection[];
};

/** Everything the assessment page renders: the row, who it is for, the pinned version and the answers. */
export type AssessmentPage = {
  readonly assessment: AssessmentRow;
  readonly status: AssessmentStatus;
  readonly companyName: string | null;
  readonly organizationName: string | null;
  readonly version: QuestionnaireVersion;
  readonly items: readonly AssessmentItem[];
  readonly answers: readonly AssessmentAnswer[];
};

/** One row of the Assessments section on the expert's client page (AC-5). */
export type AssessmentListRow = {
  readonly id: string;
  readonly companyId: string;
  readonly expertId: string;
  readonly questionnaireKey: string;
  readonly questionnaireTitle: LocalizedText;
  readonly status: AssessmentStatus;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  /** The locked whole percent of a submitted assessment whose answers the caller may read; null otherwise. */
  readonly score: number | null;
};

/** One row of the `expert_bookings` view: what an expert may know about an order. */
export type ExpertBooking = {
  readonly id: string;
  readonly organizationId: string;
  readonly companyId: string;
  readonly reference: string;
  readonly packageKey: string;
  readonly packageName: string;
  readonly status: string;
  readonly scheduledAt: string | null;
  readonly deliveredAt: string | null;
};

function toStatus(status: string): AssessmentStatus {
  return status === "submitted" ? "submitted" : "draft";
}

function toVersion(row: Tables<"questionnaire_versions">): QuestionnaireVersion {
  return {
    key: row.key,
    questionnaireKey: row.questionnaire_key,
    version: row.version,
    title: localizedTextSchema.parse(row.title),
    sections: contentSectionSchema.array().parse(row.sections),
  };
}

/** A `questionnaire_items` row with its jsonb columns parsed into the model's shape. Throws on a malformed row. */
export function toAssessmentItem(row: Tables<"questionnaire_items">): AssessmentItem {
  return {
    id: row.id,
    position: row.position,
    parentId: row.parent_id,
    sectionKey: row.section_key,
    groupKey: row.group_key,
    label: row.label,
    rateable: row.rateable,
    title: localizedTextSchema.parse(row.title),
    requirement: row.requirement === null ? null : localizedTextSchema.parse(row.requirement),
    question: localizedTextSchema.parse(row.question),
    deReviewed: row.de_reviewed,
  };
}

function toAnswer(
  row: Pick<Tables<"assessment_answers">, "item_id" | "section_key" | "rating" | "note">,
): AssessmentAnswer {
  return {
    itemId: row.item_id,
    sectionKey: row.section_key,
    rating: (row.rating as RatingCode | null) ?? null,
    note: row.note,
  };
}

/** The items of one version, parents before children by position. Throws. */
async function listItems(
  supabase: Client,
  versionKeys: readonly string[],
): Promise<readonly AssessmentItem[]> {
  if (versionKeys.length === 0) return [];
  const { data, error } = await supabase
    .from("questionnaire_items")
    .select("*")
    .in("version_key", [...versionKeys])
    .order("position", { ascending: true });
  if (error) throw queryError(error);
  return (data ?? []).map(toAssessmentItem);
}

/**
 * Everything the assessment page shows (AC-6): the row with its company and organization names,
 * the pinned version with its outline and items, and every answer row. Null when the id is not a
 * UUID or RLS hides the row (a foreign or unknown id), which the page turns into `notFound()`;
 * throws on anything else. The company join runs under the assigned expert policy, so an expert
 * whose assignment ended still reads their submitted row but sees no company name. Server
 * component and actions.
 */
export async function getAssessment(
  supabase: Client,
  assessmentId: string,
): Promise<AssessmentPage | null> {
  if (!isUuid(assessmentId)) return null;

  const { data: row, error } = await supabase
    .from("assessments")
    .select("*, companies(name), organizations(name)")
    .eq("id", assessmentId)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!row) return null;

  const { companies, organizations, ...assessment } = row as typeof row & {
    companies: { name: string } | null;
    organizations: { name: string } | null;
  };

  const [versionResult, items, answersResult] = await Promise.all([
    supabase
      .from("questionnaire_versions")
      .select("*")
      .eq("key", assessment.questionnaire_version_key)
      .maybeSingle(),
    listItems(supabase, [assessment.questionnaire_version_key]),
    supabase
      .from("assessment_answers")
      .select("item_id, section_key, rating, note")
      .eq("assessment_id", assessmentId),
  ]);
  if (versionResult.error) throw queryError(versionResult.error);
  if (answersResult.error) throw queryError(answersResult.error);
  // The composite foreign key guarantees the version row; a missing one is a real fault.
  if (!versionResult.data) {
    throw new Error(`questionnaire version ${assessment.questionnaire_version_key} is missing`);
  }

  return {
    assessment: assessment as AssessmentRow,
    status: toStatus(assessment.status),
    companyName: companies?.name ?? null,
    organizationName: organizations?.name ?? null,
    version: toVersion(versionResult.data),
    items,
    answers: (answersResult.data ?? []).map(toAnswer),
  };
}

/**
 * The assessments of one organization, newest first (AC-5), each with its questionnaire title and,
 * once submitted, the score from `computeScore` over the answers the caller may read. RLS limits
 * the rows to what the caller holds; a submitted assessment of another expert lists with no score
 * because its answers are hidden. Throws. Server component.
 */
export async function listAssessments(
  supabase: Client,
  organizationId: string,
): Promise<readonly AssessmentListRow[]> {
  if (!isUuid(organizationId)) return [];

  const { data, error } = await supabase
    .from("assessments")
    .select(
      "id, company_id, expert_id, questionnaire_key, questionnaire_version_key, status, created_at, submitted_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw queryError(error);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const versionKeys = [...new Set(rows.map((row) => row.questionnaire_version_key))];
  const submitted = rows.filter((row) => row.status === "submitted");
  const [versionsResult, items, answersResult] = await Promise.all([
    supabase.from("questionnaire_versions").select("*").in("key", versionKeys),
    listItems(supabase, submitted.length > 0 ? versionKeys : []),
    submitted.length > 0
      ? supabase
          .from("assessment_answers")
          .select("assessment_id, item_id, section_key, rating, note")
          .in(
            "assessment_id",
            submitted.map((row) => row.id),
          )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (versionsResult.error) throw queryError(versionsResult.error);
  if (answersResult.error) throw queryError(answersResult.error);

  const versions = new Map((versionsResult.data ?? []).map((row) => [row.key, toVersion(row)]));
  const answersByAssessment = (answersResult.data ?? []).reduce((map, row) => {
    const list = map.get(row.assessment_id) ?? [];
    list.push(toAnswer(row));
    map.set(row.assessment_id, list);
    return map;
  }, new Map<string, AssessmentAnswer[]>());

  return rows.map((row) => {
    const version = versions.get(row.questionnaire_version_key);
    const answers = answersByAssessment.get(row.id) ?? [];
    const score =
      row.status === "submitted" && version && answers.length > 0
        ? computeScore(
            version.sections,
            items.filter((item) => item.id.startsWith(`${row.questionnaire_version_key}/`)),
            answers,
          ).overall
        : null;
    return {
      id: row.id,
      companyId: row.company_id,
      expertId: row.expert_id,
      questionnaireKey: row.questionnaire_key,
      questionnaireTitle: version?.title ?? {
        de: row.questionnaire_key,
        en: row.questionnaire_key,
      },
      status: toStatus(row.status),
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      score,
    };
  });
}

/**
 * The caller's bookings for one organization from the `expert_bookings` view, newest visit first
 * (AC-5). The view's own where clause is the boundary: an expert reads their bookings, ops read
 * every one. Throws. Server component and actions.
 */
export async function listExpertBookings(
  supabase: Client,
  organizationId: string,
): Promise<readonly ExpertBooking[]> {
  if (!isUuid(organizationId)) return [];
  const { data, error } = await supabase
    .from("expert_bookings")
    .select("*")
    .eq("organization_id", organizationId)
    .order("scheduled_at", { ascending: false, nullsFirst: false });
  if (error) throw queryError(error);
  return (data ?? []).flatMap((row) =>
    row.id && row.organization_id && row.company_id
      ? [
          {
            id: row.id,
            organizationId: row.organization_id,
            companyId: row.company_id,
            reference: row.reference ?? "",
            packageKey: row.package_key ?? "",
            packageName: row.package_name_snapshot ?? "",
            status: row.status ?? "",
            scheduledAt: row.scheduled_at,
            deliveredAt: row.delivered_at,
          },
        ]
      : [],
  );
}

/**
 * The newest version of one questionnaire key with its items (AC-5), or null when none is seeded.
 * `order by version desc limit 1`: there is no status column, a seeded version is live. Throws.
 * Actions.
 */
export async function getNewestVersion(
  supabase: Client,
  questionnaireKey: QuestionnaireKey,
): Promise<(QuestionnaireVersion & { readonly items: readonly AssessmentItem[] }) | null> {
  const { data, error } = await supabase
    .from("questionnaire_versions")
    .select("*")
    .eq("questionnaire_key", questionnaireKey)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!data) return null;
  const items = await listItems(supabase, [data.key]);
  return { ...toVersion(data), items };
}
