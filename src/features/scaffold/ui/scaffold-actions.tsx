"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  runScaffoldTask,
  type ScaffoldResult,
  sendPostHogTestEvent,
  sendSentryTestError,
} from "@/features/scaffold/actions";

function ResultLine({ result }: { result: ScaffoldResult | null }) {
  const t = useTranslations("scaffold.result");
  if (!result) return null;
  const text =
    result.key === "taskQueued" ? t("taskQueued", { runId: result.runId }) : t(result.key);
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {text}
    </p>
  );
}

export function ScaffoldActions() {
  const t = useTranslations("scaffold");
  const [taskResult, runTask, taskPending] = useActionState(runScaffoldTask, null);
  const [sentryResult, sendSentry, sentryPending] = useActionState(sendSentryTestError, null);
  const [posthogResult, sendPostHog, posthogPending] = useActionState(sendPostHogTestEvent, null);

  return (
    <section
      aria-labelledby="scaffold-heading"
      className="flex flex-col gap-4 rounded-lg border p-6"
    >
      <div>
        <h2 id="scaffold-heading" className="text-lg font-semibold">
          {t("heading")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <form action={runTask}>
          <Button type="submit" disabled={taskPending}>
            {t("runTask")}
          </Button>
        </form>
        <form action={runTask}>
          <input type="hidden" name="shouldFail" value="true" />
          <Button type="submit" variant="outline" disabled={taskPending}>
            {t("runFailingTask")}
          </Button>
        </form>
        <form action={sendSentry}>
          <Button type="submit" variant="outline" disabled={sentryPending}>
            {t("sentryError")}
          </Button>
        </form>
        <form action={sendPostHog}>
          <Button type="submit" variant="outline" disabled={posthogPending}>
            {t("posthogEvent")}
          </Button>
        </form>
      </div>
      <ResultLine result={taskResult} />
      <ResultLine result={sentryResult} />
      <ResultLine result={posthogResult} />
    </section>
  );
}
