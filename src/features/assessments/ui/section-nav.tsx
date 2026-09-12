import { getTranslations } from "next-intl/server";
import type { Progress } from "@/features/assessments/model";
import { Link } from "@/i18n/navigation";
import type { LocaleCode } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export type SectionNavProps = {
  readonly organizationId: string;
  readonly assessmentId: string;
  readonly progress: Progress;
  readonly openKey: string;
  readonly locale: LocaleCode;
};

/**
 * The section navigator (spec 0019, AC-6, AC-13): a list of links carrying `?section=`, one per
 * section of the outline, each with its progress and the open one marked `aria-current`. An
 * excluded section is marked as such (the control that excludes it is milestone 4). Server.
 */
export async function SectionNav({
  organizationId,
  assessmentId,
  progress,
  openKey,
  locale,
}: SectionNavProps) {
  const t = await getTranslations("assessments.nav");

  return (
    <nav aria-label={t("label")} className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1" data-section-nav>
        {progress.sections.map((section) => {
          const open = section.key === openKey;
          const complete = !section.excluded && section.required > 0 && section.unrated === 0;
          return (
            <li key={section.key}>
              <Link
                href={{
                  pathname: "/expert/clients/[organizationId]/assessments/[assessmentId]",
                  params: { organizationId, assessmentId },
                  query: { section: section.key },
                }}
                aria-current={open ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  open && "border-border bg-muted font-medium",
                )}
              >
                <span
                  className="w-6 shrink-0 font-mono text-muted-foreground text-xs tabular-nums"
                  translate="no"
                >
                  {section.label}
                </span>
                <span className="flex-1">{section.title[locale]}</span>
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums",
                    complete ? "text-success" : "text-muted-foreground",
                  )}
                  data-numeric
                >
                  {section.excluded
                    ? t("excluded")
                    : t("progress", { rated: section.rated, required: section.required })}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
