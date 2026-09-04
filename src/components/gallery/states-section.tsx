"use client";

import { InboxIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Example } from "@/components/gallery/gallery-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton, empty, error and toasts side by side (AC-6, AC-7, AC-8). Runs in the browser. */
export function StatesSection() {
  const t = useTranslations("gallery.states");
  const empty = useTranslations("areas.app.empty");
  const error = useTranslations("states.error");

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-8 lg:grid-cols-3">
        <Example label={t("skeleton")}>
          <div className="flex w-full flex-col gap-3 rounded-lg border p-6" aria-busy="true">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </Example>
        <Example label={t("empty")}>
          <EmptyState
            className="w-full"
            icon={InboxIcon}
            title={empty("title")}
            description={empty("description")}
            action={
              <Button size="sm">
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                {t("emptyAction")}
              </Button>
            }
          />
        </Example>
        <Example label={t("error")}>
          <ErrorState
            className="w-full"
            title={error("title")}
            description={error("description")}
            eventId="4f2a9c1d"
            onRetry={() => toast.info(t("retried"))}
          />
        </Example>
      </div>
      <Example label={t("toasts")}>
        <Button variant="outline" onClick={() => toast.success(t("toast.success"))}>
          {t("toast.successButton")}
        </Button>
        <Button variant="outline" onClick={() => toast.info(t("toast.info"))}>
          {t("toast.infoButton")}
        </Button>
        <Button variant="outline" onClick={() => toast.error(t("toast.error"))}>
          {t("toast.errorButton")}
        </Button>
      </Example>
    </div>
  );
}
