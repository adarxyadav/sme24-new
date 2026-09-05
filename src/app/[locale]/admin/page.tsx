import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { listScaffoldChecks } from "@/features/scaffold/queries";
import { ScaffoldActions } from "@/features/scaffold/ui/scaffold-actions";
import { ScaffoldChecksLive } from "@/features/scaffold/ui/scaffold-checks-live";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const t = await getTranslations("areas.admin");
  const supabase = await createServerSupabaseClient();
  const checks = await listScaffoldChecks(supabase);
  const messages = clientMessages(await getMessages(), ["scaffold"]);

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("body")} />
      <NextIntlClientProvider messages={messages}>
        <ScaffoldActions />
        <ScaffoldChecksLive initialRows={checks} />
      </NextIntlClientProvider>
    </PageStack>
  );
}
