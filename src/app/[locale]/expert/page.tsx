import { BriefcaseIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";

export default async function ExpertPage() {
  const t = await getTranslations("areas.expert");
  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("body")} />
      <EmptyState
        icon={BriefcaseIcon}
        title={t("empty.title")}
        description={t("empty.description")}
      />
    </PageStack>
  );
}
