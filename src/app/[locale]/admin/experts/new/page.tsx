import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent } from "@/components/ui/card";
import { ExpertInviteForm } from "@/features/experts/ui/invite-form";
import { clientMessages } from "@/i18n/client-messages";

export async function generateMetadata() {
  const t = await getTranslations("experts.invite");
  return { title: t("title") };
}

/**
 * The ops invite page (spec 0013, AC-2, AC-7). A page of its own rather than a dialog on the list,
 * because inviting sends a real email to a real person and deserves a URL ops can return to and a
 * breadcrumb back to the list. Ops only, through the proxy; the action re checks the role.
 */
export default async function NewExpertPage() {
  const [t, messages] = await Promise.all([getTranslations("experts.invite"), getMessages()]);

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("lead")}
        breadcrumb={[{ label: t("breadcrumb"), href: "/admin/experts" }, { label: t("title") }]}
      />
      <Card className="max-w-2xl">
        <CardContent>
          <NextIntlClientProvider messages={clientMessages(messages, ["experts"])}>
            <ExpertInviteForm />
          </NextIntlClientProvider>
        </CardContent>
      </Card>
    </PageStack>
  );
}
