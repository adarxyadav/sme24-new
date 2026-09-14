import { InfoIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BenchmarkState } from "@/features/benchmark/catalogue";
import type { ParsedSnapshot } from "@/features/benchmark/queries";
import type { LocaleCode } from "@/i18n/routing";
import { FactsForm, type FactsFormProps } from "./facts-form";

export type BenchmarkSegmentProps = {
  readonly snapshot: ParsedSnapshot | null;
  readonly state: BenchmarkState;
  /** The company facts the form edits (AC-11). */
  readonly company: FactsFormProps["company"];
  readonly locale: LocaleCode;
  /**
   * Hides every "correct these facts" form (spec 0013, AC-11). An assigned expert reads the same
   * benchmark the client sees, but `updateCompanyFacts` is a client action they may not call, so
   * showing them the form would offer an edit that can only ever fail.
   */
  readonly readOnly?: boolean;
  /**
   * The "Your figures" card, rendered inside the `noData` state above the facts form (spec 0010).
   * `noData` means a snapshot compared nothing, so entering a figure by hand is the remedy the
   * alert is asking for and the card belongs beside it rather than further down the page. A
   * caller that has no client KPI form to offer — the expert view, which is `readOnly` — passes
   * nothing and the state renders as it did before.
   */
  readonly figuresSlot?: React.ReactNode;
};

type Translator = Awaited<ReturnType<typeof getTranslations<"benchmark">>>;

/**
 * The benchmark segment of the dashboard (spec 0008, AC-9; spec 0022, AC-18): the waiting states,
 * the `outdated` sentence for a snapshot written by a model version this code no longer reads, and
 * the company facts card. The four `ready` sections — the peer table, the estimated loss, the
 * expert cards and the package — arrive with module 6 of the spec 0022 build plan; until then a
 * readable snapshot renders the facts card alone, and nothing from an old row is ever shown.
 * Server component.
 */
export async function BenchmarkSegment({
  state,
  company,
  readOnly = false,
  figuresSlot,
}: BenchmarkSegmentProps) {
  const t = await getTranslations("benchmark");

  return (
    <section
      aria-labelledby="benchmark-heading"
      className="flex flex-col gap-4"
      data-benchmark-state={state}
    >
      <h2 id="benchmark-heading" className="font-semibold text-lg">
        {t("heading")}
      </h2>
      {state === "calculating" ? <CalculatingState label={t("state.calculating")} /> : null}
      {state === "unavailable" ? (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.unavailable")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "outdated" ? (
        <Alert variant="info" data-outdated>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.outdated")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "noData" ? (
        <Alert variant="info">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{t("state.noData")}</AlertTitle>
        </Alert>
      ) : null}
      {state === "noData" && !readOnly ? figuresSlot : null}
      {state !== "calculating" && state !== "unavailable" && !readOnly ? (
        <FactsCard company={company} t={t} />
      ) : null}
    </section>
  );
}

/**
 * The company facts card (spec 0008, AC-11): the NOGA division, the country and the headcount form
 * under its own title. Since 2026-09-13 (owner decision) it is the only piece left of the "How this
 * is calculated" disclosure: the formula, the assumptions and the inputs used no longer render for
 * the client. Server component.
 */
function FactsCard({
  company,
  t,
}: {
  readonly company: FactsFormProps["company"];
  readonly t: Translator;
}) {
  return (
    <Card data-facts-card>
      <CardHeader>
        <CardTitle>{t("facts.title")}</CardTitle>
        <CardDescription>{t("facts.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FactsForm company={company} />
      </CardContent>
    </Card>
  );
}

function CalculatingState({ label }: { readonly label: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {label}
        </p>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-60" />
      </CardContent>
    </Card>
  );
}
