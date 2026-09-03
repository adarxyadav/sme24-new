import { getTranslations } from "next-intl/server";
import { listScaffoldChecks } from "@/features/scaffold/queries";
import { ScaffoldActions } from "@/features/scaffold/ui/scaffold-actions";
import { ScaffoldChecksLive } from "@/features/scaffold/ui/scaffold-checks-live";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const t = await getTranslations("areas.admin");
  const supabase = await createServerSupabaseClient();
  const checks = await listScaffoldChecks(supabase);

  return (
    <>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("body")}</p>
      </section>
      <ScaffoldActions />
      <ScaffoldChecksLive initialRows={checks} />
    </>
  );
}
