import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listAssessmentStates } from "@/features/assessments/queries";
import { listAssignedExperts } from "@/features/experts/queries";
import { AssignedExperts } from "@/features/experts/ui/assigned-experts";
import { listScheduledAssessments } from "@/features/ops-admin/queries";
import { ScheduledAssessments } from "@/features/ops-admin/ui/scheduled-assessments";
import { getCompanyDashboard } from "@/features/research/queries";
import { CompanyDashboardView } from "@/features/research/ui/company-dashboard";
import { organizationIdFromClaims } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = { readonly params: Promise<{ companyId: string }> };

export async function generateMetadata({ params }: Props) {
  const [{ companyId }, supabase] = await Promise.all([params, createServerSupabaseClient()]);
  const { data } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  return data ? { title: data.name } : {};
}

/**
 * One of the organization's companies: the same research and benchmark body `/app` renders, for
 * the company the URL names. A company of another organization is a 404, never a 403, which would
 * confirm the row exists; RLS hides the row and the query filters the organization again besides.
 * Client member.
 */
export default async function ClientCompanyPage({ params }: Props) {
  const [{ companyId }, t, supabase] = await Promise.all([
    params,
    getTranslations("clientCompanies"),
    createServerSupabaseClient(),
  ]);
  const { data } = await supabase.auth.getClaims();
  const organizationId = organizationIdFromClaims(data?.claims);
  if (!organizationId) notFound();

  const [dashboard, assignedExperts, assessments] = await Promise.all([
    getCompanyDashboard(supabase, organizationId, new Date(), companyId),
    listAssignedExperts(supabase, organizationId),
    listScheduledAssessments(supabase),
  ]);
  const { company } = dashboard;
  if (!company) notFound();

  // Spec 0019, AC-10: the state of each booking's assessments, read from `assessments` alone under
  // the member policy; this route never queries an answer row.
  const assessmentStates = await listAssessmentStates(
    supabase,
    assessments.map((assessment) => assessment.orderId),
  );

  return (
    <CompanyDashboardView
      supabase={supabase}
      organizationId={organizationId}
      dashboard={{ ...dashboard, company }}
      breadcrumb={[{ label: t("title"), href: "/app/companies" }, { label: company.name }]}
      beforeResearch={
        <>
          <ScheduledAssessments
            assessments={assessments}
            experts={assignedExperts}
            states={assessmentStates}
          />
          <AssignedExperts experts={assignedExperts} />
        </>
      }
    />
  );
}
