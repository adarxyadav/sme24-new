import { getTranslations } from "next-intl/server";

export default async function ExpertPage() {
  const t = await getTranslations("areas.expert");
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("body")}</p>
    </section>
  );
}
