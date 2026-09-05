import { LayoutDashboardIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";

export default async function AppPage() {
  const t = await getTranslations("areas.app");
  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("body")} />
      <EmptyState
        icon={LayoutDashboardIcon}
        title={t("empty.title")}
        description={t("empty.description")}
      />
    </PageStack>
  );
}
