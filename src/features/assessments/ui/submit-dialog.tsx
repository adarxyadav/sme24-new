"use client";

import { LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  type IncompleteSection,
  type SubmitAssessmentResult,
  submitAssessment,
} from "@/features/assessments/actions";
import { useFormAction } from "@/hooks/use-form-action";
import type { LocaleCode } from "@/i18n/routing";

export type SubmitDialogProps = {
  readonly assessmentId: string;
  /** How many required items are still unrated, per section, from `computeProgress` on the server. */
  readonly unrated: number;
  readonly sections: readonly IncompleteSection[];
  readonly locale: LocaleCode;
};

/**
 * The submit confirmation (spec 0019, AC-9): names what locks and, while items are unrated, how
 * many and in which sections, with the confirm button disabled until the count is zero. The
 * database decides again on confirmation: an `incomplete` answer replaces the list with the
 * server's count, a `locked` one means another tab got there first. Success work hangs off the
 * click, never off an effect. Browser.
 */
export function SubmitDialog({ assessmentId, unrated, sections, locale }: SubmitDialogProps) {
  const t = useTranslations("assessments.submit");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState({ unrated, sections });
  const submit = useFormAction<SubmitAssessmentResult, { assessmentId: string }>(submitAssessment);

  // The server's numbers win whenever the page re-renders with fresh ones.
  const shown =
    missing.unrated === unrated && missing.sections === sections ? { unrated, sections } : missing;

  async function confirm() {
    const outcome = await submit.submit({ assessmentId });
    if (outcome.ok) {
      toast.success(t("done"));
      setOpen(false);
      router.refresh();
      return;
    }
    if (outcome.error === "incomplete") {
      setMissing({ unrated: outcome.unrated, sections: outcome.sections });
      return;
    }
    toast.error(t(`errors.${outcome.error}`));
    if (outcome.error === "locked") {
      setOpen(false);
      router.refresh();
    }
  }

  const complete = shown.unrated === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMissing({ unrated, sections });
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <LockIcon data-icon="inline-start" aria-hidden="true" />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {complete ? (
          <p className="text-sm">{t("ready")}</p>
        ) : (
          <div className="flex flex-col gap-2" data-submit-missing>
            <p className="text-sm">{t("missing", { count: shown.unrated })}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {shown.sections.map((section) => (
                <li key={section.key} className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="font-mono text-muted-foreground text-xs" translate="no">
                      {section.label}
                    </span>{" "}
                    {section.title[locale]}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {t("sectionMissing", { count: section.unrated })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={!complete || submit.pending} onClick={confirm}>
            {submit.pending ? t("submitting") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
