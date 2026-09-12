import type { SectionOutline } from "@/features/assessments/model";
import type { LocaleCode } from "@/i18n/routing";
import { SectionExclusion } from "./section-exclusion";

export type SectionHeadingProps = {
  readonly assessmentId: string;
  readonly section: SectionOutline;
  readonly locale: LocaleCode;
  /** From the catalogue entry of the questionnaire: the Not applicable control renders only when true. */
  readonly allowsExclusion: boolean;
  readonly excluded: boolean;
  readonly exclusionNote: string | null;
  readonly readOnly: boolean;
};

/**
 * The head of the open section (spec 0019, AC-8): its label and title, and for a questionnaire
 * whose catalogue entry allows it the Not applicable control. ISO 45001 gets the heading alone.
 * Server.
 */
export function SectionHeading({
  assessmentId,
  section,
  locale,
  allowsExclusion,
  excluded,
  exclusionNote,
  readOnly,
}: SectionHeadingProps) {
  return (
    <div
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-xs"
      data-section-heading={section.key}
    >
      <h2 className="flex items-baseline gap-3 font-semibold text-lg leading-snug">
        <span className="font-mono text-muted-foreground text-sm tabular-nums" translate="no">
          {section.label}
        </span>
        <span>{section.title[locale]}</span>
      </h2>
      {allowsExclusion ? (
        <SectionExclusion
          key={section.key}
          assessmentId={assessmentId}
          sectionKey={section.key}
          excluded={excluded}
          note={exclusionNote}
          readOnly={readOnly}
        />
      ) : null}
    </div>
  );
}
