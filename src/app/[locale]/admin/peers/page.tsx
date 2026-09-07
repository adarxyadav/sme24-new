import { TriangleAlertIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listPeers } from "@/features/peers/queries";
import { ALL, peerFiltersSchema } from "@/features/peers/schema";
import { AddPeerForm } from "@/features/peers/ui/add-peer-form";
import { PeerFilterForm } from "@/features/peers/ui/peer-filters";
import { PeersTable } from "@/features/peers/ui/peers-table";
import { ProposePeersForm } from "@/features/peers/ui/propose-peers-form";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("peers");
  return { title: t("title") };
}

/**
 * The ops peer screen (spec 0012, AC-2, AC-3, AC-4, AC-14): the flagged peers, the section, band
 * and status filter, the list with its research batch and per row actions, the model proposal
 * form and the hand added peer form. Ops only through the proxy and RLS.
 */
export default async function AdminPeersPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = peerFiltersSchema.parse({
    section: single(params.section),
    sizeBand: single(params.sizeBand),
    status: single(params.status),
  });
  const [t, nav, supabase, messages] = await Promise.all([
    getTranslations("peers"),
    getTranslations("nav.admin"),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const [rows, approved] = await Promise.all([
    listPeers(supabase, filters),
    listPeers(supabase, { section: ALL, sizeBand: ALL, status: "approved" }),
  ]);
  const flagged = approved.filter((row) => row.flagged);

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumb={[{ label: nav("overview"), href: "/admin" }, { label: nav("peers") }]}
      />
      {flagged.length > 0 ? (
        <Alert variant="warning" data-flagged-peers={flagged.length}>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("flagged.title", { count: flagged.length })}</AlertTitle>
          <AlertDescription>
            <p>{t("flagged.description")}</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {flagged.map((row) => (
                <li key={row.id}>
                  {row.company.name} · {row.industry_section} · {row.size_band}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <NextIntlClientProvider
        messages={clientMessages(messages, ["peers", "benchmark", "research"])}
      >
        <PeerFilterForm filters={filters} />
        <PeersTable rows={rows} filters={filters} />
        <div className="grid gap-8 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("propose.title")}</CardTitle>
              <CardDescription>{t("propose.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ProposePeersForm
                section={filters.section === ALL ? undefined : filters.section}
                sizeBand={filters.sizeBand === ALL ? undefined : filters.sizeBand}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("add.title")}</CardTitle>
              <CardDescription>{t("add.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <AddPeerForm
                section={filters.section === ALL ? undefined : filters.section}
                sizeBand={filters.sizeBand === ALL ? undefined : filters.sizeBand}
              />
            </CardContent>
          </Card>
        </div>
      </NextIntlClientProvider>
    </PageStack>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
