"use client";

import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * What replaces the enquiry form after a successful submit (spec 0009, AC-8): the thank you,
 * the reply time (one working day) and a link back to the landing page. Announced as a status,
 * so a screen reader hears the outcome. Browser (rendered by the client form).
 */
export function EnquiryConfirmation() {
  const t = useTranslations("marketing.contact.success");
  return (
    <div
      role="status"
      data-slot="enquiry-confirmation"
      className="flex flex-col items-start gap-4 rounded-lg border p-6"
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-md bg-success-subtle text-success"
      >
        <CheckIcon className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-1">
        <h2 className="font-semibold text-lg">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("body")}</p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">{t("back")}</Link>
      </Button>
    </div>
  );
}
