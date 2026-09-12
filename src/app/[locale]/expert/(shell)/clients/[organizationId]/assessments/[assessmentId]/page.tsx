import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { PageStack } from "@/components/page-stack";
import { QUESTIONNAIRES, type QuestionnaireKey } from "@/features/assessments/catalogue";
import { computeProgress, computeScore, exclusionsOf, gapList } from "@/features/assessments/model";
import { getAssessment } from "@/features/assessments/queries";
import { AssessmentHeader } from "@/features/assessments/ui/assessment-header";
import { ScoreSummary } from "@/features/assessments/ui/score-summary";
import { SectionHeading } from "@/features/assessments/ui/section-heading";
import { SectionItems } from "@/features/assessments/ui/section-items";
import { SectionNav } from "@/features/assessments/ui/section-nav";
import { clientMessages } from "@/i18n/client-messages";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = {
  readonly params: Promise<{ readonly organizationId: string; readonly assessmentId: string }>;
  readonly searchParams: Promise<{ readonly section?: string | string[] }>;
};

export async function generateMetadata() {
  const t = await getTranslations("assessments.page");
  return { title: t("title") };
}

/**
 * One assessment (spec 0019, AC-6, AC-7, AC-9): the header with progress and running score, the
 * section navigator keyed on `?section=`, and the items of the open section with autosave while
 * the draft is open; the locked score summary on top once submitted. Every read runs under the
 * caller's policies, so a foreign or unknown id is a plain 404, and the page never sees an
 * organization id it did not read from the row itself.
 */
export default async function AssessmentPage({ params, searchParams }: Props) {
  const [{ organizationId, assessmentId }, { section }, supabase, messages, locale] =
    await Promise.all([
      params,
      searchParams,
      createServerSupabaseClient(),
      getMessages(),
      getLocale(),
    ]);

  const page = await getAssessment(supabase, assessmentId);
  if (!page || page.assessment.organization_id !== organizationId) notFound();

  const localeCode = LOCALE_CODE[resolveLocale(locale)];
  const { version, items, answers } = page;
  const score = computeScore(version.sections, items, answers);
  const progress = computeProgress(version.sections, items, answers);
  const requested = Array.isArray(section) ? section[0] : section;
  const openSection =
    version.sections.find((candidate) => candidate.key === requested) ?? version.sections[0];
  const openKey = openSection?.key ?? "";
  const openItems = items.filter((item) => item.sectionKey === openKey);
  const openIds = new Set(openItems.map((item) => item.id));
  const openAnswers = answers.filter(
    (answer) => answer.itemId !== null && openIds.has(answer.itemId),
  );
  const submitted = page.status === "submitted";
  // AC-8: whether a standard may be marked not applicable comes from the catalogue entry of the
  // row's own questionnaire key; the exclusion itself is the answer row without an item.
  const allowsExclusion =
    QUESTIONNAIRES[page.assessment.questionnaire_key as QuestionnaireKey]?.allowsSectionExclusion ??
    false;
  const exclusions = exclusionsOf(answers);
  const excluded = exclusions.has(openKey);

  return (
    <NextIntlClientProvider messages={clientMessages(messages, ["assessments"])}>
      <PageStack>
        <AssessmentHeader page={page} score={score} progress={progress} locale={localeCode} />

        {submitted ? (
          <ScoreSummary
            score={score}
            gaps={gapList(version.sections, items, answers)}
            locale={localeCode}
          />
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
          <div className="lg:sticky lg:top-20">
            <SectionNav
              organizationId={organizationId}
              assessmentId={assessmentId}
              progress={progress}
              openKey={openKey}
              locale={localeCode}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            {openSection ? (
              <SectionHeading
                assessmentId={assessmentId}
                section={openSection}
                locale={localeCode}
                allowsExclusion={allowsExclusion}
                excluded={excluded}
                exclusionNote={exclusions.get(openKey) ?? null}
                readOnly={submitted}
              />
            ) : null}
            <SectionItems
              // Remount per section: the local answer state and the autosave queue belong to one
              // section, and leaving it flushes what is still waiting.
              key={openKey}
              assessmentId={assessmentId}
              items={openItems}
              groups={openSection?.groups ?? []}
              answers={openAnswers}
              locale={localeCode}
              readOnly={submitted}
              excluded={excluded}
            />
          </div>
        </div>
      </PageStack>
    </NextIntlClientProvider>
  );
}
