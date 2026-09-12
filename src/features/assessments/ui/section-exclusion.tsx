"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type SetSectionExclusionResult,
  setSectionExclusion,
} from "@/features/assessments/actions";
import { cn } from "@/lib/utils";
import { SaveIndicator, type SaveState } from "./save-indicator";

export type SectionExclusionProps = {
  readonly assessmentId: string;
  readonly sectionKey: string;
  /** The stored state: an exclusion row exists for this section. */
  readonly excluded: boolean;
  readonly note: string | null;
  /** True once the assessment is submitted: the switch shows its state and nothing saves. */
  readonly readOnly: boolean;
};

/** The reason saves this long after the last keystroke, the note debounce of the items. */
const NOTE_DEBOUNCE_MS = 800;
/** Automatic retries on a network or unexpected failure, with 1 s, 2 s and 4 s between them. */
const MAX_RETRIES = 3;

/** The failures no retry can fix: the page tells the expert and keeps the local value. */
const TERMINAL: ReadonlySet<string> = new Set([
  "not_allowed",
  "not_found",
  "invalid",
  "validation",
  "forbidden",
]);

type Queue = {
  timer: number | null;
  inFlight: boolean;
  dirty: boolean;
  attempt: number;
};

/**
 * The Not applicable control of one standard (spec 0019, AC-8): a labelled switch and, while the
 * standard is excluded, an optional reason. Rendered for the Compliance questionnaire only; the
 * ISO 45001 page shows no such control because its catalogue entry allows no exclusion, and the
 * action refuses it anyway. The switch saves at once, the reason 800 ms after the last keystroke
 * or on blur, through the same one in flight queue the items use, and every landed save refreshes
 * the server rendered page so the navigator, the progress and the items pick the state up. A
 * `locked` answer tells the expert once and turns the page read only. Browser.
 */
export function SectionExclusion({
  assessmentId,
  sectionKey,
  excluded: storedExcluded,
  note: storedNote,
  readOnly,
}: SectionExclusionProps) {
  const t = useTranslations("assessments.exclusion");
  const router = useRouter();
  const switchId = useId();
  const leadId = `${switchId}-lead`;
  const noteId = `${switchId}-note`;
  const hintId = `${noteId}-hint`;
  const [excluded, setExcluded] = useState(storedExcluded);
  const [note, setNote] = useState(storedNote ?? "");
  const [save, setSave] = useState<SaveState>("idle");
  const [locked, setLocked] = useState(false);
  const values = useRef({ excluded: storedExcluded, note: storedNote ?? "" });
  const queue = useRef<Queue>({ timer: null, inFlight: false, dirty: false, attempt: 0 });
  const frozen = readOnly || locked;

  const lock = useCallback(() => {
    setLocked((already) => {
      if (!already) {
        toast.error(t("errors.locked"));
        router.refresh();
      }
      return true;
    });
  }, [router, t]);

  const sendRef = useRef<() => void>(() => {});
  const send = useCallback(async () => {
    const current = queue.current;
    if (current.timer !== null) {
      window.clearTimeout(current.timer);
      current.timer = null;
    }
    if (current.inFlight) {
      current.dirty = true;
      return;
    }
    current.inFlight = true;
    current.dirty = false;
    setSave("saving");
    const value = values.current;

    let result: SetSectionExclusionResult | null = null;
    try {
      result = await setSectionExclusion(null, {
        assessmentId,
        sectionKey,
        excluded: value.excluded,
        note: value.note,
      });
    } catch {
      result = null;
    }
    current.inFlight = false;

    if (result?.ok) {
      current.attempt = 0;
      setSave(current.dirty ? "pending" : "saved");
      router.refresh();
      if (current.dirty) sendRef.current();
      return;
    }
    if (result && result.error === "locked") {
      setSave("failed");
      lock();
      return;
    }
    if (result && TERMINAL.has(result.error)) {
      setSave("failed");
      toast.error(t(`errors.${result.error as "invalid"}`));
      return;
    }
    if (current.attempt < MAX_RETRIES) {
      current.attempt += 1;
      current.timer = window.setTimeout(() => sendRef.current(), 1000 * 2 ** (current.attempt - 1));
      return;
    }
    current.attempt = 0;
    setSave("failed");
  }, [assessmentId, lock, router, sectionKey, t]);
  sendRef.current = send;

  const schedule = useCallback((delay: number) => {
    const current = queue.current;
    setSave("pending");
    if (current.timer !== null) window.clearTimeout(current.timer);
    current.timer = null;
    if (current.inFlight) {
      current.dirty = true;
      return;
    }
    if (delay === 0) {
      sendRef.current();
      return;
    }
    current.timer = window.setTimeout(() => sendRef.current(), delay);
  }, []);

  // Leaving the section sends a reason still waiting on its debounce rather than dropping it.
  useEffect(() => {
    const current = queue.current;
    return () => {
      if (current.timer !== null) {
        window.clearTimeout(current.timer);
        current.timer = null;
        sendRef.current();
      }
    };
  }, []);

  const toggle = (next: boolean) => {
    if (frozen) return;
    values.current = { ...values.current, excluded: next };
    setExcluded(next);
    schedule(0);
  };

  return (
    <div
      className={cn("flex flex-col gap-3", excluded && "rounded-lg bg-muted/60 p-3")}
      data-section-exclusion={sectionKey}
      data-excluded={excluded ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <Switch
            id={switchId}
            checked={excluded}
            onCheckedChange={toggle}
            disabled={frozen}
            aria-describedby={leadId}
          />
          <Label htmlFor={switchId}>{t("label")}</Label>
        </div>
        {frozen ? null : <SaveIndicator state={save} savedAt={null} onRetry={() => schedule(0)} />}
      </div>
      <p id={leadId} className="max-w-prose text-muted-foreground text-xs">
        {excluded ? t("excludedHint") : t("lead")}
      </p>

      {excluded ? (
        frozen ? (
          note ? (
            <p className="whitespace-pre-wrap text-sm">{note}</p>
          ) : null
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="font-medium text-sm">
              {t("note")}
            </label>
            <Textarea
              id={noteId}
              value={note}
              placeholder={t("notePlaceholder")}
              maxLength={4000}
              rows={2}
              aria-describedby={hintId}
              onChange={(event) => {
                values.current = { ...values.current, note: event.target.value };
                setNote(event.target.value);
                schedule(NOTE_DEBOUNCE_MS);
              }}
              onBlur={() => {
                if (queue.current.timer !== null) sendRef.current();
              }}
            />
            <p id={hintId} className="text-muted-foreground text-xs">
              {t("noteHint")}
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
