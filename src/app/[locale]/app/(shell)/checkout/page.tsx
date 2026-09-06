import { BuildingIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Button } from "@/components/ui/button";
import { listCompanies, listPurchasablePackages } from "@/features/checkout/queries";
import { CheckoutForm } from "@/features/checkout/ui/checkout-form";
import { clientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("checkout");
  return { title: t("title") };
}

/**
 * The checkout (spec 0011, AC-1, AC-11, AC-16): the package choice preselected from the pricing
 * page link, the billing address and the summary. A client with no company is routed to company
 * setup first, because an order must name the company the assessment is for.
 */
export default async function CheckoutPage({ searchParams }: Props) {
  const params = await searchParams;
  const chosen = typeof params.package === "string" ? params.package : undefined;
  const [t, locale, supabase, messages] = await Promise.all([
    getTranslations("checkout"),
    getLocale(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const [companies, packages, packageNames] = await Promise.all([
    listCompanies(supabase),
    listPurchasablePackages(supabase),
    getTranslations({ locale, namespace: "marketing.packages" }),
  ]);

  if (companies.length === 0) {
    return (
      <PageStack>
        <PageHeader title={t("title")} description={t("description")} />
        <EmptyState
          icon={BuildingIcon}
          title={t("noCompanyTitle")}
          description={t("noCompanyBody")}
          action={
            <Button asChild>
              <Link href="/app">{t("noCompanyAction")}</Link>
            </Button>
          }
        />
      </PageStack>
    );
  }

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("description")} />
      <NextIntlClientProvider messages={clientMessages(messages, ["checkout"])}>
        <div className="max-w-2xl">
          <CheckoutForm
            companies={companies.map((entry) => ({
              id: entry.id,
              name: entry.name,
              uid: entry.uid,
            }))}
            packages={packages.map((entry) => ({
              key: entry.key,
              name: packageNames(`${entry.key}.name` as never),
              priceRappen: Number(entry.price_rappen),
              vatRate: Number(entry.vat_rate),
            }))}
            initialPackageKey={chosen}
          />
        </div>
      </NextIntlClientProvider>
    </PageStack>
  );
}
