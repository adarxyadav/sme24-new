import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { listDataRequests } from "@/features/legal/queries";
import { dataRequestFiltersSchema } from "@/features/legal/schema";
import { DataRequestFilterForm } from "@/features/legal/ui/data-request-filters";
import { DataRequestsTable } from "@/features/legal/ui/data-requests-table";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("adminDataRequests");
  return { title: t("title") };
}

/**
 * The ops queue of data requests (spec 0015, AC-13): the status filter (the open queue by
 * default), the table ordered by the thirty day answer deadline, and the cursor. Ops only through
 * the proxy and RLS.
 */
export default async function AdminDataRequestsPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = dataRequestFiltersSchema.parse({
    status: single(params.status),
    cursor: single(params.cursor),
  });
  const [t, nav, supabase, messages] = await Promise.all([
    getTranslations("adminDataRequests"),
    getTranslations("nav.admin"),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const page = await listDataRequests(supabase, filters);

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumb={[{ label: nav("overview"), href: "/admin" }, { label: nav("dataRequests") }]}
      />
      <NextIntlClientProvider messages={clientMessages(messages, ["adminDataRequests"])}>
        <DataRequestFilterForm filters={filters} />
      </NextIntlClientProvider>
      {/* One clock for the whole table, read here: "overdue" must not differ between two rows of
          the same render, and the browser's clock never decides it. */}
      <DataRequestsTable
        rows={page.rows}
        nextCursor={page.nextCursor}
        filters={filters}
        now={new Date()}
      />
    </PageStack>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
