import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
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
import { rappenToChf } from "@/features/checkout/money";
import { getCompanyDetail } from "@/features/ops-admin/queries";
import { ConfidenceBadge, RunStatusBadge } from "@/features/research/ui/badges";
import { localizedText } from "@/features/research/ui/kpi-table";
import { LOCALE_CODE } from "@/i18n/routing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly params: Promise<{ readonly companyId: string }>;
};

export async function generateMetadata() {
  const t = await getTranslations("adminCompanies");
  return { title: t("detailTitle") };
}

/** The badge variant per order status; every badge carries its label, so colour is never alone. */
const ORDER_STATUS_VARIANT: Record<
  string,
  "warning" | "success" | "secondary" | "outline" | "info"
> = {
  pending: "warning",
  paid: "success",
  cancelled: "secondary",
  refunded: "secondary",
  expired: "outline",
  scheduled: "info",
  in_progress: "info",
  delivered: "success",
};

/**
 * One company as ops see it (spec 0014, AC-2): its facts, its client and their people, every
 * research run, the effective figures, the newest benchmark snapshot and every order that client
 * has placed. Read only: nothing on this page writes, so the scheduling controls stay on
 * `/admin/orders` where the order is worked.
 *
 * The snapshot arrives already parsed by the schema its stored `model_version` names, so a row
 * written by an older model version still reads and a version this build does not know is simply
 * absent rather than a crash (docs/benchmark.md).
 * Ops only, through the proxy and the ops policy; an unknown id renders the not found page.
 */
export default async function AdminCompanyDetailPage({ params }: Props) {
  const { companyId } = await params;
  const [t, nav, orderStatus, format, locale, supabase] = await Promise.all([
    getTranslations("adminCompanies"),
    getTranslations("nav.admin"),
    getTranslations("orders.status"),
    getFormatter(),
    getLocale(),
    createServerSupabaseClient(),
  ]);
  const detail = await getCompanyDetail(supabase, companyId);
  if (!detail) notFound();

  const { company, organization, members, runs, kpis, snapshot, orders, kpiCatalogue } = detail;
  // The catalogue names a figure in the reader's language; a key the catalogue no longer holds
  // falls back to the key itself, so a retired KPI still reads rather than rendering blank.
  const kpiName = new Map(
    kpiCatalogue.map((definition) => [
      definition.key,
      localizedText(definition.name, LOCALE_CODE[locale]) || definition.key,
    ]),
  );
  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), "dateTime") : t("none");
  const day = (value: string | null) =>
    value ? format.dateTime(new Date(value), "dateShort") : t("none");
  const text = (value: string | null) => value ?? t("none");

  const facts: ReadonlyArray<readonly [label: string, value: React.ReactNode, mono?: boolean]> = [
    [t("facts.name"), company.name],
    [t("facts.legalName"), text(company.legal_name)],
    [t("facts.uid"), text(company.uid), true],
    [
      t("facts.website"),
      company.website ? (
        <a
          key="website"
          href={company.website}
          rel="noreferrer noopener"
          target="_blank"
          className="underline underline-offset-4"
        >
          {company.website}
        </a>
      ) : (
        t("none")
      ),
    ],
    [t("facts.industry"), text(company.industry_code), true],
    [
      t("facts.employees"),
      company.employees_count === null
        ? t("none")
        : format.number(company.employees_count, "integer"),
    ],
    [t("facts.canton"), text(company.canton)],
    [t("facts.country"), company.country],
    [t("facts.created"), when(company.created_at)],
    [t("facts.updated"), when(company.updated_at)],
    [t("facts.archived"), when(company.archived_at)],
    [t("facts.id"), company.id, true],
  ];

  const clientFacts: ReadonlyArray<
    readonly [label: string, value: React.ReactNode, mono?: boolean]
  > = organization
    ? [
        [t("organization.name"), organization.name],
        [t("organization.language"), organization.locale],
        [t("organization.created"), when(organization.created_at)],
        [t("organization.archived"), when(organization.archived_at)],
        [t("organization.id"), organization.id, true],
      ]
    : [];

  return (
    <PageStack>
      <PageHeader
        title={company.name}
        description={organization?.name ?? t("detailTitle")}
        breadcrumb={[
          { label: nav("overview"), href: "/admin" },
          { label: nav("companies"), href: "/admin/companies" },
          { label: company.name },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="facts-heading" className="flex flex-col gap-3">
          <h2 id="facts-heading" className="font-semibold text-lg">
            {t("sections.facts")}
          </h2>
          <Card>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
                {facts.map(([label, value, mono]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground text-xs sm:pt-0.5">{label}</dt>
                    <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="client-heading" className="flex flex-col gap-3">
          <h2 id="client-heading" className="font-semibold text-lg">
            {t("sections.organization")}
          </h2>
          <Card>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
                {clientFacts.map(([label, value, mono]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground text-xs sm:pt-0.5">{label}</dt>
                    <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("sections.members")}</CardTitle>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("members.empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table density="compact">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("members.name")}</TableHead>
                        <TableHead>{t("members.role")}</TableHead>
                        <TableHead>{t("members.language")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.userId}>
                          <TableCell>{member.fullName ?? t("unnamed")}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {member.role === "owner" || member.role === "member"
                              ? t(`roles.${member.role}`)
                              : member.role}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {text(member.locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <section aria-labelledby="research-heading" className="flex flex-col gap-3">
        <h2 id="research-heading" className="font-semibold text-lg">
          {t("sections.research")}
        </h2>
        <Card>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("research.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("research.status")}</TableHead>
                      <TableHead>{t("research.started")}</TableHead>
                      <TableHead>{t("research.finished")}</TableHead>
                      <TableHead>{t("research.providerRunId")}</TableHead>
                      <TableHead>{t("research.error")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {when(run.started_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {when(run.finished_at)}
                        </TableCell>
                        <TableCell className="break-all font-mono text-xs">
                          {text(run.provider_run_id)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {text(run.error_code)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="kpis-heading" className="flex flex-col gap-3">
        <h2 id="kpis-heading" className="font-semibold text-lg">
          {t("sections.kpis")}
        </h2>
        <Card>
          <CardHeader>
            <CardDescription>{t("kpis.note")}</CardDescription>
          </CardHeader>
          <CardContent>
            {kpis.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("kpis.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kpis.key")}</TableHead>
                      <TableHead className="text-right">{t("kpis.year")}</TableHead>
                      <TableHead className="text-right">{t("kpis.value")}</TableHead>
                      <TableHead>{t("kpis.source")}</TableHead>
                      <TableHead>{t("kpis.confidence")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpis.map((row) => (
                      <TableRow key={row.id ?? `${row.kpi_key}-${row.period_year}`}>
                        <TableCell>
                          {row.kpi_key ? (kpiName.get(row.kpi_key) ?? row.kpi_key) : t("none")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.period_year ?? t("none")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.value === null ? t("none") : Number(row.value)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.source === "research" || row.source === "client"
                            ? t(`sources.${row.source}`)
                            : text(row.source)}
                        </TableCell>
                        <TableCell>
                          {row.confidence === null ? (
                            <span className="text-muted-foreground">{t("none")}</span>
                          ) : (
                            <ConfidenceBadge confidence={Number(row.confidence)} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="benchmark-heading" className="flex flex-col gap-3">
        <h2 id="benchmark-heading" className="font-semibold text-lg">
          {t("sections.benchmark")}
        </h2>
        <Card>
          <CardContent>
            {snapshot === null ? (
              <p className="text-muted-foreground text-sm">{t("benchmark.empty")}</p>
            ) : (
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
                {(
                  [
                    [t("benchmark.computed"), when(snapshot.createdAt)],
                    [t("benchmark.modelVersion"), snapshot.modelVersion, true],
                    [t("benchmark.trigger"), t(`triggers.${snapshot.triggerKind as "research"}`)],
                    [t("benchmark.kpisCompared"), snapshot.kpisCompared],
                    [
                      t("benchmark.provisional"),
                      snapshot.peerProvisional ? t("benchmark.yes") : t("benchmark.no"),
                    ],
                    [
                      t("benchmark.cost"),
                      snapshot.costChf === null
                        ? t("none")
                        : format.number(snapshot.costChf, "chfWhole"),
                    ],
                    [
                      t("benchmark.savingMedian"),
                      snapshot.savingMedianChf === null
                        ? t("none")
                        : format.number(snapshot.savingMedianChf, "chfWhole"),
                    ],
                    [
                      t("benchmark.savingTop"),
                      snapshot.savingTopChf === null
                        ? t("none")
                        : format.number(snapshot.savingTopChf, "chfWhole"),
                    ],
                  ] as ReadonlyArray<readonly [string, React.ReactNode, boolean?]>
                ).map(([label, value, mono]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground text-xs sm:pt-0.5">{label}</dt>
                    <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="orders-heading" className="flex flex-col gap-3">
        <h2 id="orders-heading" className="font-semibold text-lg">
          {t("sections.orders")}
        </h2>
        <Card>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("orders.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("orders.reference")}</TableHead>
                      <TableHead>{t("orders.package")}</TableHead>
                      <TableHead className="text-right">{t("orders.amount")}</TableHead>
                      <TableHead>{t("orders.status")}</TableHead>
                      <TableHead>{t("orders.scheduled")}</TableHead>
                      <TableHead>{t("orders.created")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-xs">{order.reference}</TableCell>
                        <TableCell>{order.packageName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {format.number(rappenToChf(order.grossRappen), "chf")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? "secondary"}>
                            {order.status in ORDER_STATUS_VARIANT
                              ? orderStatus(order.status as "paid")
                              : order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.scheduledAt ? (
                            <time dateTime={order.scheduledAt}>{when(order.scheduledAt)}</time>
                          ) : (
                            t("orders.notScheduled")
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <time dateTime={order.createdAt}>{day(order.createdAt)}</time>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </PageStack>
  );
}
