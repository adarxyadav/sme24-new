import { PlusIcon, UsersIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listExperts } from "@/features/experts/queries";
import { ALL_STATUSES, expertFiltersSchema } from "@/features/experts/schema";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
import { ExpertFilterForm } from "@/features/experts/ui/expert-filters";
import { clientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("experts.admin");
  return { title: t("title") };
}

/** The badge variant per status; every badge carries its label, so colour is never alone. */
const STATUS_VARIANT: Record<string, "warning" | "success" | "secondary"> = {
  invited: "warning",
  active: "success",
  inactive: "secondary",
};

/** The first value of a query parameter that a browser may repeat. */
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The ops list of experts (spec 0013, AC-7): who is in the network, what they cover, whether they
 * are taking work and how many clients they hold, with a status filter and 50 rows a page.
 *
 * The filter is in the URL rather than in state, so a reload or a shared link shows the same list;
 * the "Show more" link carries the filter with the cursor, because a cursor taken under one filter
 * means nothing under another. Ops only, through the proxy and RLS.
 */
export default async function AdminExpertsPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = expertFiltersSchema.parse({
    status: single(params.status),
    cursor: single(params.cursor),
  });
  const [t, catalogue, format, supabase, messages] = await Promise.all([
    getTranslations("experts.admin"),
    getTranslations("experts.catalogue"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const page = await listExperts(supabase, filters);

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild>
            <Link href="/admin/experts/new">
              <PlusIcon aria-hidden="true" />
              {t("invite")}
            </Link>
          </Button>
        }
      />

      <NextIntlClientProvider messages={clientMessages(messages, ["experts"])}>
        <ExpertFilterForm filters={filters} />
      </NextIntlClientProvider>

      {page.rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <section className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.email")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.competencies")}</TableHead>
                  <TableHead>{t("columns.availability")}</TableHead>
                  <TableHead className="text-right">{t("columns.clients")}</TableHead>
                  <TableHead>{t("columns.invited")}</TableHead>
                  <TableHead>{t("columns.onboarded")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <TableRow key={row.expert_id}>
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <ExpertAvatar
                          fullName={row.fullName}
                          photoUrl={row.photoUrl}
                          className="size-8 shrink-0"
                        />
                        <Link
                          href={{
                            pathname: "/admin/experts/[expertId]",
                            params: { expertId: row.expert_id },
                          }}
                          className="font-medium underline underline-offset-4"
                        >
                          {row.fullName ?? t("unnamed")}
                        </Link>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.email}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>
                        {t(`status.${row.status as "invited"}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.competencies.length === 0 ? (
                        <span className="text-muted-foreground">{t("none")}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {row.competencies.map((code) => (
                            <Badge key={code} variant="secondary">
                              {catalogue(`competencies.${code as "compliance"}`)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {catalogue(`availability.${row.availability as "available"}`)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.activeAssignments}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={row.invited_at}>
                        {format.dateTime(new Date(row.invited_at), "dateShort")}
                      </time>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.onboarded_at ? (
                        <time dateTime={row.onboarded_at}>
                          {format.dateTime(new Date(row.onboarded_at), "dateShort")}
                        </time>
                      ) : (
                        t("none")
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {page.nextCursor ? (
            <div>
              <Button asChild variant="outline">
                <Link
                  href={{
                    pathname: "/admin/experts",
                    // The filter travels with the cursor: a keyset taken under one status means
                    // nothing under another, so dropping it here would page into the wrong list.
                    query: {
                      ...(filters.status === ALL_STATUSES ? {} : { status: filters.status }),
                      cursor: page.nextCursor,
                    },
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
