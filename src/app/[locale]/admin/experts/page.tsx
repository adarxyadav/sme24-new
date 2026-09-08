import { UsersIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listExperts } from "@/features/experts/queries";
import { expertFiltersSchema } from "@/features/experts/schema";
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

/**
 * The ops list of experts (spec 0013, AC-7): who is in the network, what state their account is
 * in and how many clients they hold. The invite form and the status filter are milestone 3; this
 * is the list milestone 2 needs so ops can reach an expert and assign them.
 */
export default async function AdminExpertsPage({ searchParams }: Props) {
  const [t, format, supabase, filters] = await Promise.all([
    getTranslations("experts.admin"),
    getFormatter(),
    createServerSupabaseClient(),
    searchParams.then((params) => expertFiltersSchema.parse(params)),
  ]);
  const { rows } = await listExperts(supabase, filters);

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("description")} />
      {rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.email")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="text-right">{t("columns.clients")}</TableHead>
              <TableHead>{t("columns.invited")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.expert_id}>
                <TableCell>
                  <Link
                    href={{
                      pathname: "/admin/experts/[expertId]",
                      params: { expertId: row.expert_id },
                    }}
                    className="font-medium underline underline-offset-4"
                  >
                    {row.fullName ?? t("unnamed")}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.email}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>
                    {t(`status.${row.status as "invited"}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.activeAssignments}</TableCell>
                <TableCell className="text-muted-foreground">
                  {format.dateTime(new Date(row.invited_at), "dateShort")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PageStack>
  );
}
