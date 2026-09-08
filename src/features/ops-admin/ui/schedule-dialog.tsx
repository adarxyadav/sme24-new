"use client";

import { AlertCircleIcon, CalendarPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AssignableExpert } from "@/features/ops-admin/queries";
import { useFormAction } from "@/hooks/use-form-action";
import { type ScheduleOrderResult, scheduleOrder } from "../actions";
import { formatZurichWallClock } from "../schema";

export type ScheduleDialogProps = {
  readonly orderId: string;
  readonly reference: string;
  /** The active experts ops may book, from `listAssignableExperts`. */
  readonly experts: readonly AssignableExpert[];
};

/**
 * The ops scheduling dialog on an order row (spec 0014, AC-3): the agreed visit date and time, and
 * the assessor going. Offered only on a `paid` order, which is the only state the `paid ->
 * scheduled` edge starts from.
 *
 * The date field is a `datetime-local`, so its value is a wall clock time with no zone; the schema
 * reads it as Europe/Zurich, because ops book Swiss site visits and an ops user in another zone
 * must not book an hour out. Its `min` is now, but the refusal that counts comes from the database
 * (AC-5), so a stale open dialog is caught rather than trusted. Browser.
 */
export function ScheduleDialog({ orderId, reference, experts }: ScheduleDialogProps) {
  const t = useTranslations("adminOrders.schedule");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [expertId, setExpertId] = useState<string | null>(null);
  const [minimum, setMinimum] = useState<string | undefined>(undefined);

  const schedule = useFormAction<
    ScheduleOrderResult,
    { orderId: string; scheduledAt: string; expertId: string }
  >(scheduleOrder);

  // Deferred to mount: the earliest bookable moment reads the browser clock, which the server
  // cannot know, and rendering it during SSR would be a hydration mismatch.
  useEffect(() => setMinimum(formatZurichWallClock(new Date())), []);

  useEffect(() => {
    if (!schedule.result?.ok) return;
    toast.success(t("scheduled"));
    setOpen(false);
    setScheduledAt("");
    setExpertId(null);
    router.refresh();
  }, [schedule.result, router, t]);

  const failure = schedule.result?.ok === false ? schedule.result.error : null;
  const complete = scheduledAt !== "" && expertId !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <CalendarPlusIcon data-icon="inline-start" aria-hidden="true" />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { reference })}</DialogDescription>
        </DialogHeader>

        {failure ? (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden="true" />
            <AlertTitle>{t(`errors.${failure}`)}</AlertTitle>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={`schedule-at-${orderId}`}>{t("date")}</FieldLabel>
            <Input
              id={`schedule-at-${orderId}`}
              type="datetime-local"
              value={scheduledAt}
              min={minimum}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
            <FieldDescription>{t("dateHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`schedule-expert-${orderId}`}>{t("expert")}</FieldLabel>
            <Combobox
              id={`schedule-expert-${orderId}`}
              options={experts.map((expert) => ({
                value: expert.expertId,
                label: expert.fullName ?? t("unnamed"),
                description: expert.headline,
              }))}
              value={expertId}
              onValueChange={setExpertId}
              placeholder={t("expertPlaceholder")}
              searchPlaceholder={t("expertSearch")}
              emptyLabel={t("noExperts")}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={!complete || schedule.pending}
            onClick={() => expertId && schedule.submit({ orderId, scheduledAt, expertId })}
          >
            {schedule.pending ? t("scheduling") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
