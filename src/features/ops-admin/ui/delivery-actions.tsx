"use client";

import { AlertCircleIcon, CalendarXIcon, CheckCheckIcon, PencilIcon, PlayIcon } from "lucide-react";
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
import {
  type OrderDeliveryStateResult,
  type RescheduleOrderResult,
  rescheduleOrder,
  setOrderDeliveryState,
  type UnscheduleOrderResult,
  unscheduleOrder,
} from "../actions";
import { formatZurichWallClock } from "../schema";

export type DeliveryActionsProps = {
  readonly orderId: string;
  readonly reference: string;
  /** `scheduled`, `in_progress` or `delivered`; nothing is rendered for any other status. */
  readonly status: string;
  /** The order's current date as a `datetime-local` wall clock time, seeding the correction form. */
  readonly scheduledAt: string | null;
  readonly assignedExpertId: string | null;
  /** The active experts ops may book, from `listAssignableExperts`. */
  readonly experts: readonly AssignableExpert[];
};

/**
 * The ops delivery controls on a booked order row (spec 0014, AC-6, AC-7, AC-7a): move it forward
 * a state, correct its date or assessor, and release it back to `paid`.
 *
 * Only the controls the row's own state allows are rendered, so the two forward edges are never
 * offered out of order; the database refuses everything else regardless, and a refusal it raises
 * lands in the same inline alert the dialogs use. Browser.
 */
export function DeliveryActions({
  orderId,
  reference,
  status,
  scheduledAt,
  assignedExpertId,
  experts,
}: DeliveryActionsProps) {
  const t = useTranslations("adminOrders.delivery");
  const router = useRouter();

  const advance = useFormAction<
    OrderDeliveryStateResult,
    { orderId: string; next: "in_progress" | "delivered" }
  >(setOrderDeliveryState);
  const release = useFormAction<UnscheduleOrderResult, { orderId: string }>(unscheduleOrder);

  const [releaseOpen, setReleaseOpen] = useState(false);

  // Every successful write refreshes the row rather than patching it locally: the status, the date
  // and the assessor all come from the server, and a stale row here would offer the wrong edge.
  // The work hangs off the click, not off an effect watching the result: `useActionState` keeps
  // its last value, so an effect would fire again on every later render — several toasts and
  // refreshes for one write, and a release dialog that shut itself the next time ops opened it.
  async function moveOn(next: "in_progress" | "delivered") {
    const outcome = await advance.submit({ orderId, next });
    if (!outcome.ok) return;
    toast.success(t("advanced"));
    router.refresh();
  }

  async function releaseOrder() {
    const outcome = await release.submit({ orderId });
    if (!outcome.ok) return;
    toast.success(t("released"));
    setReleaseOpen(false);
    router.refresh();
  }

  if (status !== "scheduled" && status !== "in_progress" && status !== "delivered") return null;

  const advanceFailure = advance.result?.ok === false ? advance.result.error : null;
  const releaseFailure = release.result?.ok === false ? release.result.error : null;
  const next =
    status === "scheduled" ? "in_progress" : status === "in_progress" ? "delivered" : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {next ? (
        <Button type="button" size="sm" disabled={advance.pending} onClick={() => moveOn(next)}>
          {next === "in_progress" ? (
            <PlayIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <CheckCheckIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {advance.pending ? t("advancing") : t(`advance.${next}`)}
        </Button>
      ) : null}

      <RescheduleDialog
        orderId={orderId}
        reference={reference}
        scheduledAt={scheduledAt}
        assignedExpertId={assignedExpertId}
        experts={experts}
        futureOnly={status === "scheduled"}
      />

      {status === "scheduled" ? (
        <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              <CalendarXIcon data-icon="inline-start" aria-hidden="true" />
              {t("release.open")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("release.title")}</DialogTitle>
              <DialogDescription>{t("release.description", { reference })}</DialogDescription>
            </DialogHeader>
            {releaseFailure ? (
              <Alert variant="destructive">
                <AlertCircleIcon aria-hidden="true" />
                <AlertTitle>{t(`errors.${releaseFailure}`)}</AlertTitle>
              </Alert>
            ) : null}
            <p className="text-muted-foreground text-sm">{t("release.note")}</p>
            <DialogFooter>
              <Button
                type="button"
                variant="destructive"
                disabled={release.pending}
                onClick={() => releaseOrder()}
              >
                {release.pending ? t("release.releasing") : t("release.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {advanceFailure ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${advanceFailure}`)}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}

type RescheduleDialogProps = {
  readonly orderId: string;
  readonly reference: string;
  readonly scheduledAt: string | null;
  readonly assignedExpertId: string | null;
  readonly experts: readonly AssignableExpert[];
  /** True on a `scheduled` order, where a past date is still refused by the form's own `min`. */
  readonly futureOnly: boolean;
};

/**
 * The correction dialog (AC-7a): the same two fields as scheduling, seeded with what the order
 * already carries, and no status change.
 *
 * The `min` attribute is set only on a `scheduled` order. On an `in_progress` or `delivered` one a
 * past date is the point, because ops are recording a visit that already happened, which is why
 * the database drops its future check off this path too. Browser.
 */
function RescheduleDialog({
  orderId,
  reference,
  scheduledAt,
  assignedExpertId,
  experts,
  futureOnly,
}: RescheduleDialogProps) {
  const t = useTranslations("adminOrders.delivery");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(scheduledAt ?? "");
  const [expertId, setExpertId] = useState<string | null>(assignedExpertId);
  const [minimum, setMinimum] = useState<string | undefined>(undefined);

  const correct = useFormAction<
    RescheduleOrderResult,
    { orderId: string; scheduledAt: string; expertId: string }
  >(rescheduleOrder);

  // Deferred to mount: the earliest bookable moment reads the browser clock, which the server
  // cannot know, and rendering it during SSR would be a hydration mismatch.
  useEffect(() => setMinimum(formatZurichWallClock(new Date())), []);

  // Same reason as the two above: the toast and the close belong to the click, not to a result
  // that stays `{ ok: true }` for the life of the row.
  async function save(expert: string) {
    const outcome = await correct.submit({ orderId, scheduledAt: when, expertId: expert });
    if (!outcome.ok) return;
    toast.success(t("corrected"));
    setOpen(false);
    router.refresh();
  }

  const failure = correct.result?.ok === false ? correct.result.error : null;
  const complete = when !== "" && expertId !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <PencilIcon data-icon="inline-start" aria-hidden="true" />
          {t("correct.open")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("correct.title")}</DialogTitle>
          <DialogDescription>{t("correct.description", { reference })}</DialogDescription>
        </DialogHeader>

        {failure ? (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden="true" />
            <AlertTitle>{t(`errors.${failure}`)}</AlertTitle>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={`correct-at-${orderId}`}>{t("correct.date")}</FieldLabel>
            <Input
              id={`correct-at-${orderId}`}
              type="datetime-local"
              value={when}
              min={futureOnly ? minimum : undefined}
              aria-describedby={`correct-at-hint-${orderId}`}
              onChange={(event) => setWhen(event.target.value)}
            />
            <FieldDescription id={`correct-at-hint-${orderId}`}>
              {futureOnly ? t("correct.dateHintFuture") : t("correct.dateHintPast")}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`correct-expert-${orderId}`}>{t("correct.expert")}</FieldLabel>
            <Combobox
              id={`correct-expert-${orderId}`}
              options={experts.map((expert) => ({
                value: expert.expertId,
                label: expert.fullName ?? t("correct.unnamed"),
                description: expert.headline,
              }))}
              value={expertId}
              onValueChange={setExpertId}
              placeholder={t("correct.expertPlaceholder")}
              searchPlaceholder={t("correct.expertSearch")}
              emptyLabel={t("correct.noExperts")}
              describedBy={`correct-expert-hint-${orderId}`}
            />
            <FieldDescription id={`correct-expert-hint-${orderId}`}>
              {t("correct.expertHint")}
            </FieldDescription>
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={!complete || correct.pending}
            onClick={() => expertId && save(expertId)}
          >
            {correct.pending ? t("correct.saving") : t("correct.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
