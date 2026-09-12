import { CoinsIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getDirectoryOpsSummary,
  getDirectoryTotals,
  getLatestImport,
} from "@/features/directory/queries";
import { RemoveContactForm } from "@/features/directory/ui/remove-contact-form";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("directory.admin");
  return { title: t("title") };
}

/**
 * The ops view of the contact directory (spec 0018, AC-15): the latest import run with its
 * counts, the totals, every expert with a balance or an unlock, and the removal form. Ops only,
 * through the proxy, the ops policies and the definer function's own role check.
 */
export default async function AdminDirectoryPage() {
  const [t, format, supabase, messages] = await Promise.all([
    getTranslations("directory.admin"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const [latestImport, totals, experts] = await Promise.all([
    getLatestImport(supabase),
    getDirectoryTotals(supabase),
    getDirectoryOpsSummary(supabase),
  ]);
  const countries = Object.entries((latestImport?.countries ?? {}) as Record<string, number>).sort(
    (a, b) => b[1] - a[1],
  );
  const number = (value: number) => format.number(value, "integer");

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("lead")} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("import.heading")}</CardTitle>
            {latestImport ? (
              <CardDescription>
                <time dateTime={latestImport.started_at}>
                  {format.dateTime(new Date(latestImport.started_at), "dateTime")}
                </time>
                {latestImport.dry_run ? (
                  <Badge variant="outline" className="ml-2">
                    {t("import.dryRun")}
                  </Badge>
                ) : null}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {latestImport ? (
              <div className="flex flex-col gap-6">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-muted-foreground text-xs">{t("import.batch")}</dt>
                    <dd className="font-medium">{latestImport.source_batch}</dd>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-muted-foreground text-xs">{t("import.file")}</dt>
                    <dd className="font-mono text-xs">{latestImport.file_name}</dd>
                  </div>
                  {(
                    [
                      ["read", latestImport.rows_read],
                      ["loaded", latestImport.rows_loaded],
                      ["updated", latestImport.rows_updated],
                      ["skippedInvalid", latestImport.rows_skipped_invalid],
                      ["skippedCountry", latestImport.rows_skipped_country],
                      ["skippedNoCountry", latestImport.rows_skipped_no_country],
                      ["skippedSuppressed", latestImport.rows_skipped_suppressed],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground text-xs">{t(`import.${key}`)}</dt>
                      <dd className="tabular-nums">{number(value)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-muted-foreground text-xs">{t("import.excluded")}</dt>
                    <dd className="font-mono text-xs">
                      {latestImport.excluded_countries.length > 0
                        ? latestImport.excluded_countries.join(", ")
                        : t("import.noneExcluded")}
                    </dd>
                  </div>
                </dl>
                {countries.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-muted-foreground text-xs">{t("import.countries")}</h3>
                    <ul className="flex flex-wrap gap-1">
                      {countries.map(([code, count]) => (
                        <li key={code}>
                          <Badge variant="secondary" className="font-mono tabular-nums">
                            {code} {number(count)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="max-w-prose text-muted-foreground text-sm">{t("import.none")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("totals.heading")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-4">
              {(
                [
                  ["companies", totals.companies],
                  ["contacts", totals.contacts],
                  ["suppressed", totals.suppressed],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground text-sm">{t(`totals.${key}`)}</dt>
                  <dd className="font-semibold text-2xl tabular-nums tracking-headline">
                    {number(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="directory-experts-heading">
        <h2 id="directory-experts-heading" className="font-semibold text-lg">
          {t("experts.heading")}
        </h2>
        {experts.length === 0 ? (
          <EmptyState
            icon={CoinsIcon}
            title={t("experts.empty.title")}
            description={t("experts.empty.description")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("experts.columns.name")}</TableHead>
                  <TableHead>{t("experts.columns.email")}</TableHead>
                  <TableHead className="text-right">{t("experts.columns.balance")}</TableHead>
                  <TableHead className="text-right">{t("experts.columns.bought")}</TableHead>
                  <TableHead className="text-right">{t("experts.columns.unlocks")}</TableHead>
                  <TableHead>{t("experts.columns.lastUnlock")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {experts.map((row) => (
                  <TableRow key={row.expertId}>
                    <TableCell className="font-medium">
                      {row.fullName ?? t("experts.unnamed")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.email}</TableCell>
                    <TableCell className="text-right tabular-nums">{number(row.balance)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(row.creditsBought)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{number(row.unlocks)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lastUnlockAt ? (
                        <time dateTime={row.lastUnlockAt}>
                          {format.dateTime(new Date(row.lastUnlockAt), "dateTime")}
                        </time>
                      ) : (
                        t("experts.never")
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("remove.heading")}</CardTitle>
          <CardDescription>{t("remove.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <NextIntlClientProvider messages={clientMessages(messages, ["directory"])}>
            <RemoveContactForm />
          </NextIntlClientProvider>
        </CardContent>
      </Card>
    </PageStack>
  );
}
