import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { listDeliveries } from "@/features/emails/queries";
import { deliveryFiltersSchema } from "@/features/emails/schema";
import { DeliveriesLive } from "@/features/emails/ui/deliveries-live";
import { DeliveryFilterForm } from "@/features/emails/ui/delivery-filters";
import { TestButtons } from "@/features/emails/ui/test-buttons";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("emails");
  return { title: t("title") };
}

/** The ops outbox (spec 0006, AC-9, AC-10): filters, the live list, paging and the two test buttons. Ops only through the proxy and RLS. */
export default async function AdminEmailsPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = deliveryFiltersSchema.parse({
    status: single(params.status),
    template: single(params.template),
    q: single(params.q),
    cursor: single(params.cursor),
  });
  const [t, nav, supabase, messages] = await Promise.all([
    getTranslations("emails"),
    getTranslations("nav.admin"),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const page = await listDeliveries(supabase, filters);

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumb={[{ label: nav("overview"), href: "/admin" }, { label: nav("emails") }]}
      />
      <NextIntlClientProvider messages={clientMessages(messages, ["emails"])}>
        <TestButtons />
        <DeliveryFilterForm filters={filters} />
        <DeliveriesLive initialRows={page.rows} nextCursor={page.nextCursor} filters={filters} />
      </NextIntlClientProvider>
    </PageStack>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
