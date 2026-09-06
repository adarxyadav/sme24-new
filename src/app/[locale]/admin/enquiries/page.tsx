import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { listEnquiries } from "@/features/enquiries/queries";
import { enquiryFiltersSchema } from "@/features/enquiries/schema";
import { EnquiriesTable } from "@/features/enquiries/ui/enquiries-table";
import { EnquiryFilterForm } from "@/features/enquiries/ui/enquiry-filters";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("enquiries");
  return { title: t("title") };
}

/** The ops list of enquiries (spec 0009, AC-12): the status filter (new by default), the table and the cursor. Ops only through the proxy and RLS. */
export default async function AdminEnquiriesPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = enquiryFiltersSchema.parse({
    status: single(params.status),
    cursor: single(params.cursor),
  });
  const [t, nav, supabase, messages] = await Promise.all([
    getTranslations("enquiries"),
    getTranslations("nav.admin"),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const page = await listEnquiries(supabase, filters);

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumb={[{ label: nav("overview"), href: "/admin" }, { label: nav("enquiries") }]}
      />
      <NextIntlClientProvider messages={clientMessages(messages, ["enquiries"])}>
        <EnquiryFilterForm filters={filters} />
      </NextIntlClientProvider>
      <EnquiriesTable rows={page.rows} nextCursor={page.nextCursor} filters={filters} />
    </PageStack>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
