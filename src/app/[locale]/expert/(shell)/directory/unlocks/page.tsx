import { ArrowLeftIcon, DownloadIcon, UnlockIcon } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listUnlockedContacts } from "@/features/directory/queries";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("directory.unlocks");
  return { title: t("title") };
}

/**
 * The expert's unlocked contacts (spec 0018, AC-13): every row they paid for, newest first, with
 * the raw values, keyset paged, and the CSV export of the whole list. The export is a plain link
 * to the route handler, which streams the file under the caller's own session. Server component,
 * expert only through the shell gate and the definer function's own role check.
 */
export default async function DirectoryUnlocksPage({ searchParams }: Props) {
  const params = await searchParams;
  const cursor = typeof params.after === "string" ? params.after : null;
  const [t, locale, format, supabase] = await Promise.all([
    getTranslations("directory.unlocks"),
    getLocale(),
    getFormatter(),
    createServerSupabaseClient(),
  ]);
  const page = await listUnlockedContacts(supabase, cursor);
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });
  const countryLabel = (code: string | null) => {
    if (!code) return null;
    try {
      return regionNames.of(code) ?? code;
    } catch {
      return code;
    }
  };

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("lead")}
        breadcrumb={[{ label: t("breadcrumb"), href: "/expert/directory" }, { label: t("title") }]}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/expert/directory">
                <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
                {t("back")}
              </Link>
            </Button>
            {page.rows.length > 0 ? (
              <Button asChild>
                <a href="/api/directory/unlocks/export">
                  <DownloadIcon aria-hidden="true" data-icon="inline-start" />
                  {t("export")}
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      {page.rows.length === 0 ? (
        <EmptyState
          icon={UnlockIcon}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            page.first ? (
              <Button asChild variant="outline">
                <Link href="/expert/directory">{t("empty.action")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section className="flex flex-col gap-4" aria-labelledby="unlocks-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="unlocks-heading" className="font-semibold text-lg">
              {t("heading")}
            </h2>
            <p className="text-muted-foreground text-sm tabular-nums">
              {t("caption", { count: page.rows.length })}
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.company")}</TableHead>
                  <TableHead>{t("columns.contact")}</TableHead>
                  <TableHead>{t("columns.email")}</TableHead>
                  <TableHead>{t("columns.phone")}</TableHead>
                  <TableHead>{t("columns.unlockedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => {
                  const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
                  const place = [
                    row.city ?? row.companyCity,
                    countryLabel(row.country ?? row.companyCountry),
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <TableRow key={row.unlockId}>
                      <TableCell>
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">{row.companyName}</span>
                          {place ? (
                            <span className="text-muted-foreground text-xs">{place}</span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-col gap-0.5">
                          <span className={name ? "font-medium" : "text-muted-foreground"}>
                            {name || t("unnamed")}
                          </span>
                          {row.title ? (
                            <span className="text-muted-foreground text-xs">{row.title}</span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs" translate="no">
                        {row.email}
                      </TableCell>
                      <TableCell className="font-mono text-xs" translate="no">
                        <span className="flex flex-col gap-0.5">
                          <span>{row.phone ?? row.mobile ?? t("none")}</span>
                          {row.phone && row.mobile ? (
                            <span className="text-muted-foreground">{row.mobile}</span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={row.unlockedAt}>
                          {format.dateTime(new Date(row.unlockedAt), "dateTime")}
                        </time>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {page.nextCursor ? (
            <div>
              <Button asChild variant="outline">
                <Link
                  href={{
                    pathname: "/expert/directory/unlocks",
                    query: { after: page.nextCursor },
                  }}
                >
                  {t("more")}
                </Link>
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </PageStack>
  );
}
