import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The division and headcount shown in the still. Illustrative, never a customer. */
const EXAMPLE_DIVISION = "07";
const EXAMPLE_HEADCOUNT = "27000";

/**
 * A still of the dashboard's "correct the facts" card, drawn from that screen's own `Card`,
 * `Field`, `Input` and `Button` and its own `benchmark.facts.*` strings, so the page shows the
 * product rather than describing it.
 *
 * It is a picture of `FactsForm`, not that component: the real one is a client component carrying
 * react-hook-form, a server action and a `Select` of every NOGA division, none of which belongs on
 * a static marketing page that is measured against a first load budget. The trigger is therefore a
 * plain bordered row with the chevron the `SelectTrigger` draws, which is what the closed control
 * looks like -- and what a still ever shows of it.
 *
 * Like `LookupCard` it is the picture only, and neither hides itself from assistive tech nor
 * leaves the tab order: both belong to whatever frames it, because only the caller knows what the
 * whole picture is of.
 */
export function FactsCard({ className }: { readonly className?: string }) {
  const t = useTranslations("benchmark.facts");
  const noga = useTranslations("benchmark.noga");

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel>{t("industry")}</FieldLabel>
              {/*
                The closed `SelectTrigger`'s own shape, spelled out rather than rendered: the real
                trigger is a Radix button that owns a listbox, and a still has no business
                mounting one. Same height, border, padding and chevron, so the picture matches the
                control it pictures.
              */}
              <div className="flex h-8 w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm dark:bg-input/30">
                <span className="line-clamp-1">
                  {EXAMPLE_DIVISION} · {noga(`divisions.${EXAMPLE_DIVISION as "01"}`)}
                </span>
                <ChevronDownIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <FieldDescription>{t("industryHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("employees")}</FieldLabel>
              {/* `readOnly` and not `disabled`: the still should show the field at its resting
                  contrast, the way the real one looks before it is touched. */}
              <Input readOnly tabIndex={-1} value={EXAMPLE_HEADCOUNT} />
              <FieldDescription>{t("employeesHint")}</FieldDescription>
            </Field>
          </FieldGroup>
          <div>
            <Button tabIndex={-1}>{t("submit")}</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
