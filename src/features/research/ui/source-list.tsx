import { getFormatter, getTranslations } from "next-intl/server";
import type { SummarySource } from "@/features/research/summary";

/** The run's source list under the table (AC-7): where the research looked, deduplicated. Server component. */
export async function SourceList({ sources }: { readonly sources: readonly SummarySource[] }) {
  const t = await getTranslations("research.sources");
  const format = await getFormatter();
  return (
    <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="sources-heading" className="font-semibold text-lg">
          {t("heading")}
        </h2>
        <p className="max-w-prose text-muted-foreground text-sm">{t("description")}</p>
      </div>
      {sources.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border text-sm">
          {sources.map((source) => (
            <li key={source.url} className="flex flex-col gap-0.5 px-4 py-3">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-4"
              >
                {source.title || source.url}
              </a>
              <span className="truncate text-muted-foreground text-xs" title={source.url}>
                {source.url}
              </span>
              <span className="text-muted-foreground text-xs">
                {t("retrieved", {
                  time: format.dateTime(new Date(source.retrievedAt), "dateShort"),
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
